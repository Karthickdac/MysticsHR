import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { checkPayrollLock } from "../lib/payroll-lock";
import {
  attendanceRecordsTable,
  attendanceRegularizationsTable,
  overtimeRecordsTable,
  shiftTemplatesTable,
  shiftAssignmentsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNull, sql, or, SQL, desc } from "drizzle-orm";
import { evaluateSuspicion, loadAttendanceSuspicionConfig } from "../lib/attendance-suspicion";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

type AttendanceStatus = "Present" | "Absent" | "Half-Day" | "On Leave" | "On Permission" | "Holiday" | "Week Off" | "Regularization Pending";
type RegularizationStatus = "Pending" | "Approved" | "Rejected";

interface AttendanceSummaryRow {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  month: string;
  totalPresent: number;
  totalAbsent: number;
  totalHalfDay: number;
  totalOnLeave: number;
  totalWeekOff: number;
  totalHoliday: number;
  totalOvertimeMinutes: number;
  totalMinutesWorked: number;
}

function computeMinutesWorked(signIn: Date | null, signOut: Date | null, breakMins: number): number | null {
  if (!signIn || !signOut) return null;
  return Math.max(0, Math.round((signOut.getTime() - signIn.getTime()) / 60000) - breakMins);
}

function computeStatus(minutesWorked: number | null, minWorkingMins: number): AttendanceStatus {
  if (minutesWorked === null) return "Absent";
  if (minutesWorked >= minWorkingMins) return "Present";
  if (minutesWorked >= minWorkingMins / 2) return "Half-Day";
  return "Absent";
}

/**
 * Overtime occurs when the employee's sign-out time exceeds the shift end time
 * by more than the configured overtime threshold. For night shifts (where endTime
 * is numerically earlier than startTime, e.g. 22:00–06:00), the shift end is
 * assumed to fall on the next calendar day.
 *
 * @param signOut       Actual sign-out timestamp (UTC)
 * @param attendanceDate Date string "YYYY-MM-DD"
 * @param shiftStartTime Shift start "HH:MM" (used to detect overnight shifts)
 * @param shiftEndTime   Shift end   "HH:MM"
 * @param thresholdMins  Minutes beyond shift end before OT kicks in
 * @returns Overtime minutes (0 if none)
 */
function computeOvertimeMinutes(
  signOut: Date | null,
  attendanceDate: string,
  shiftStartTime: string,
  shiftEndTime: string,
  thresholdMins: number,
): number {
  if (!signOut) return 0;
  const [startH, startM] = shiftStartTime.split(":").map(Number);
  const [endH, endM] = shiftEndTime.split(":").map(Number);
  const crossesMidnight = endH * 60 + endM < startH * 60 + startM;

  const [year, month, day] = attendanceDate.split("-").map(Number);
  const shiftEnd = new Date(Date.UTC(year, month - 1, day, endH, endM, 0, 0));
  if (crossesMidnight) shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 1);

  const excessMs = signOut.getTime() - shiftEnd.getTime();
  const excessMins = Math.round(excessMs / 60000);
  return excessMins > thresholdMins ? excessMins - thresholdMins : 0;
}

/**
 * Resolves the active shift template for a given employee on a given date.
 * Considers both open-ended assignments (effectiveTo IS NULL) and date-bounded
 * assignments that overlap the target date (effectiveTo >= date).
 * Returns the most recently started assignment that covers the date.
 */
async function getActiveShiftTemplate(employeeId: number, date: string) {
  const [assignment] = await db
    .select({ shiftTemplateId: shiftAssignmentsTable.shiftTemplateId })
    .from(shiftAssignmentsTable)
    .where(
      and(
        eq(shiftAssignmentsTable.employeeId, employeeId),
        lte(shiftAssignmentsTable.effectiveFrom, date),
        or(
          isNull(shiftAssignmentsTable.effectiveTo),
          gte(shiftAssignmentsTable.effectiveTo, date),
        ),
      )
    )
    .orderBy(desc(shiftAssignmentsTable.effectiveFrom))
    .limit(1);
  if (!assignment) return null;
  const [template] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, assignment.shiftTemplateId));
  return template ?? null;
}

/** Upsert (or delete) an overtime_record row to stay consistent with the attendance record. */
async function upsertOvertimeRecord(
  attendanceRecordId: number,
  employeeId: number,
  attendanceDate: string,
  overtimeMins: number,
  ratePerHour: string | null | undefined,
) {
  if (overtimeMins > 0) {
    const totalAmount = ratePerHour ? String(Number(ratePerHour) * overtimeMins / 60) : null;
    const [existing] = await db
      .select({ id: overtimeRecordsTable.id })
      .from(overtimeRecordsTable)
      .where(eq(overtimeRecordsTable.attendanceRecordId, attendanceRecordId));
    if (existing) {
      await db.update(overtimeRecordsTable)
        .set({ overtimeMinutes: overtimeMins, totalAmount, updatedAt: new Date() })
        .where(eq(overtimeRecordsTable.id, existing.id));
    } else {
      await db.insert(overtimeRecordsTable).values({
        employeeId, attendanceDate, overtimeMinutes: overtimeMins,
        ratePerHour: ratePerHour ?? null, totalAmount, attendanceRecordId,
      });
    }
  } else {
    await db.delete(overtimeRecordsTable).where(eq(overtimeRecordsTable.attendanceRecordId, attendanceRecordId));
  }
}

// --- ATTENDANCE RECORDS ---

router.get("/attendance", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { date, month, employeeId, departmentId, status } = req.query;
    const conditions: SQL<unknown>[] = [];
    if (date) conditions.push(eq(attendanceRecordsTable.attendanceDate, date as string));
    if (month && typeof month === "string") {
      const [y, m] = month.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
      conditions.push(gte(attendanceRecordsTable.attendanceDate, start));
      conditions.push(lte(attendanceRecordsTable.attendanceDate, end));
    }
    if (employeeId) conditions.push(eq(attendanceRecordsTable.employeeId, Number(employeeId)));
    if (status) {
      const validStatuses: AttendanceStatus[] = ["Present", "Absent", "Half-Day", "On Leave", "On Permission", "Holiday", "Week Off", "Regularization Pending"];
      if (validStatuses.includes(status as AttendanceStatus)) {
        conditions.push(eq(attendanceRecordsTable.status, status as AttendanceStatus));
      }
    }

    const rows = await db
      .select({
        id: attendanceRecordsTable.id,
        employeeId: attendanceRecordsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        attendanceDate: attendanceRecordsTable.attendanceDate,
        signInTime: attendanceRecordsTable.signInTime,
        signOutTime: attendanceRecordsTable.signOutTime,
        totalMinutesWorked: attendanceRecordsTable.totalMinutesWorked,
        breakDurationMinutes: attendanceRecordsTable.breakDurationMinutes,
        overtimeMinutes: attendanceRecordsTable.overtimeMinutes,
        status: attendanceRecordsTable.status,
        isHrOverride: attendanceRecordsTable.isHrOverride,
        overrideReason: attendanceRecordsTable.overrideReason,
        notes: attendanceRecordsTable.notes,
        signInLatitude: attendanceRecordsTable.signInLatitude,
        signInLongitude: attendanceRecordsTable.signInLongitude,
        signInAccuracyMeters: attendanceRecordsTable.signInAccuracyMeters,
        signInUserAgent: attendanceRecordsTable.signInUserAgent,
        signOutLatitude: attendanceRecordsTable.signOutLatitude,
        signOutLongitude: attendanceRecordsTable.signOutLongitude,
        signOutAccuracyMeters: attendanceRecordsTable.signOutAccuracyMeters,
        signOutUserAgent: attendanceRecordsTable.signOutUserAgent,
        createdAt: attendanceRecordsTable.createdAt,
        updatedAt: attendanceRecordsTable.updatedAt,
      })
      .from(attendanceRecordsTable)
      .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(attendanceRecordsTable.attendanceDate, attendanceRecordsTable.employeeId);

    let scoped = rows;
    if (departmentId) {
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.departmentId, Number(departmentId)));
      const ids = new Set(deptEmps.map((e) => e.id));
      scoped = rows.filter((r) => ids.has(r.employeeId));
    }

    // Annotate every row with computed suspicion flags so HR can spot
    // buddy-punch / forgotten-permission patterns at a glance. Rules and
    // thresholds are configurable in system_settings.attendance_suspicion.
    const suspicionConfig = await loadAttendanceSuspicionConfig();
    const annotated = scoped.map((r) => ({
      ...r,
      suspicionFlags: evaluateSuspicion(r, suspicionConfig),
    }));

    if (req.query.suspiciousOnly === "true" || req.query.suspiciousOnly === "1") {
      res.json(annotated.filter((r) => r.suspicionFlags.length > 0));
      return;
    }
    res.json(annotated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body;
    // Determine the period year/month from the attendance date being written
    const attendancePeriod = body.attendanceDate ? new Date(body.attendanceDate) : new Date();
    const lockError = await checkPayrollLock(
      req.hrmsUser!.id, "edit_attendance",
      attendancePeriod.getFullYear(), attendancePeriod.getMonth() + 1,
    );
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const signIn = body.signInTime ? new Date(body.signInTime) : null;
    const signOut = body.signOutTime ? new Date(body.signOutTime) : null;
    const breakMins: number = body.breakDurationMinutes ?? 0;
    const totalMins = computeMinutesWorked(signIn, signOut, breakMins);

    const template = await getActiveShiftTemplate(body.employeeId, body.attendanceDate);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
    const overtimeMins = template
      ? computeOvertimeMinutes(signOut, body.attendanceDate, template.startTime, template.endTime, overtimeThreshold)
      : 0;
    const computedStatus: AttendanceStatus = body.status ?? computeStatus(totalMins, minWorkingMins);

    const [existing] = await db.select({ id: attendanceRecordsTable.id }).from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, body.employeeId), eq(attendanceRecordsTable.attendanceDate, body.attendanceDate)));

    let record: typeof attendanceRecordsTable.$inferSelect | undefined;
    if (existing) {
      [record] = await db.update(attendanceRecordsTable)
        .set({ signInTime: signIn, signOutTime: signOut, breakDurationMinutes: breakMins, totalMinutesWorked: totalMins, overtimeMinutes: overtimeMins, status: computedStatus, notes: body.notes ?? null, updatedAt: new Date() })
        .where(eq(attendanceRecordsTable.id, existing.id)).returning();
    } else {
      [record] = await db.insert(attendanceRecordsTable).values({
        employeeId: body.employeeId,
        attendanceDate: body.attendanceDate,
        signInTime: signIn,
        signOutTime: signOut,
        breakDurationMinutes: breakMins,
        totalMinutesWorked: totalMins,
        overtimeMinutes: overtimeMins,
        status: computedStatus,
        notes: body.notes ?? null,
      }).returning();
    }

    if (record) {
      await upsertOvertimeRecord(record.id, body.employeeId, body.attendanceDate, overtimeMins, template?.shiftRatePerHour);
    }

    await logAudit({ user: req.hrmsUser, action: existing ? "UPDATE" : "CREATE", module: "Attendance", recordId: record?.id ?? 0, newValue: `${body.employeeId}:${body.attendanceDate}:${computedStatus}`, ipAddress: req.ip });
    res.status(201).json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance/summary", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { month, departmentId } = req.query;
    if (!month || typeof month !== "string") { res.status(400).json({ error: "month required" }); return; }
    const [y, m] = month.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;

    const records = await db
      .select({
        employeeId: attendanceRecordsTable.employeeId,
        empFirstName: employeesTable.firstName,
        empLastName: employeesTable.lastName,
        empCode: employeesTable.employeeId,
        deptId: employeesTable.departmentId,
        status: attendanceRecordsTable.status,
        overtimeMinutes: attendanceRecordsTable.overtimeMinutes,
        totalMinutesWorked: attendanceRecordsTable.totalMinutesWorked,
      })
      .from(attendanceRecordsTable)
      .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
      .where(and(gte(attendanceRecordsTable.attendanceDate, start), lte(attendanceRecordsTable.attendanceDate, end)));

    const summaryMap = new Map<number, AttendanceSummaryRow>();
    for (const r of records) {
      if (departmentId && r.deptId !== Number(departmentId)) continue;
      if (!summaryMap.has(r.employeeId)) {
        summaryMap.set(r.employeeId, {
          employeeId: r.employeeId,
          employeeName: `${r.empFirstName ?? ""} ${r.empLastName ?? ""}`.trim(),
          employeeCode: r.empCode ?? "",
          month,
          totalPresent: 0,
          totalAbsent: 0,
          totalHalfDay: 0,
          totalOnLeave: 0,
          totalWeekOff: 0,
          totalHoliday: 0,
          totalOvertimeMinutes: 0,
          totalMinutesWorked: 0,
        });
      }
      const s = summaryMap.get(r.employeeId)!;
      if (r.status === "Present") s.totalPresent++;
      else if (r.status === "Absent") s.totalAbsent++;
      else if (r.status === "Half-Day") s.totalHalfDay++;
      else if (r.status === "On Leave" || r.status === "On Permission") s.totalOnLeave++;
      else if (r.status === "Week Off") s.totalWeekOff++;
      else if (r.status === "Holiday") s.totalHoliday++;
      s.totalOvertimeMinutes += r.overtimeMinutes ?? 0;
      s.totalMinutesWorked += r.totalMinutesWorked ?? 0;
    }
    res.json(Array.from(summaryMap.values()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance/regularizations", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { status, employeeId, month } = req.query;
    const conditions: SQL<unknown>[] = [];

    // Employees can only view their own regularization requests
    if (req.hrmsUser.role === "employee") {
      const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
      if (!userRow?.employeeId) { res.status(400).json({ error: "Employee record not found" }); return; }
      conditions.push(eq(attendanceRegularizationsTable.employeeId, userRow.employeeId));
    } else if (employeeId) {
      conditions.push(eq(attendanceRegularizationsTable.employeeId, Number(employeeId)));
    }

    if (status) {
      const validStatuses: RegularizationStatus[] = ["Pending", "Approved", "Rejected"];
      if (validStatuses.includes(status as RegularizationStatus)) {
        conditions.push(eq(attendanceRegularizationsTable.status, status as RegularizationStatus));
      }
    }
    if (month && typeof month === "string") {
      const [y, mo] = month.split("-").map(Number);
      const start = `${y}-${String(mo).padStart(2, "0")}-01`;
      const lastDay = new Date(y, mo, 0).getDate();
      const end = `${y}-${String(mo).padStart(2, "0")}-${lastDay}`;
      conditions.push(gte(attendanceRegularizationsTable.attendanceDate, start));
      conditions.push(lte(attendanceRegularizationsTable.attendanceDate, end));
    }
    const rows = await db
      .select({
        id: attendanceRegularizationsTable.id,
        employeeId: attendanceRegularizationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        attendanceDate: attendanceRegularizationsTable.attendanceDate,
        requestedSignIn: attendanceRegularizationsTable.requestedSignIn,
        requestedSignOut: attendanceRegularizationsTable.requestedSignOut,
        reason: attendanceRegularizationsTable.reason,
        status: attendanceRegularizationsTable.status,
        hodRemarks: attendanceRegularizationsTable.hodRemarks,
        hodActionedAt: attendanceRegularizationsTable.hodActionedAt,
        createdAt: attendanceRegularizationsTable.createdAt,
        updatedAt: attendanceRegularizationsTable.updatedAt,
      })
      .from(attendanceRegularizationsTable)
      .leftJoin(employeesTable, eq(attendanceRegularizationsTable.employeeId, employeesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(attendanceRegularizationsTable.createdAt);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/regularizations", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const body = req.body;
    const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
    const empId = userRow?.employeeId ?? null;
    if (!empId) { res.status(400).json({ error: "Employee record not found" }); return; }

    // Enforce payroll lock for the period of the attendance date being regularized
    if (body.attendanceDate) {
      const d = new Date(body.attendanceDate);
      const lockErr = await checkPayrollLock(req.hrmsUser.id, "edit_attendance", d.getFullYear(), d.getMonth() + 1, req.hrmsUser.email ?? undefined);
      if (lockErr) { res.status(423).json({ error: lockErr }); return; }
    }

    const [attRecord] = await db.select({ id: attendanceRecordsTable.id }).from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, empId), eq(attendanceRecordsTable.attendanceDate, body.attendanceDate)));

    const [created] = await db.insert(attendanceRegularizationsTable).values({
      employeeId: empId,
      attendanceDate: body.attendanceDate,
      requestedSignIn: body.requestedSignIn ? new Date(body.requestedSignIn) : null,
      requestedSignOut: body.requestedSignOut ? new Date(body.requestedSignOut) : null,
      reason: body.reason,
      attendanceRecordId: attRecord?.id ?? null,
    }).returning();

    if (attRecord) {
      await db.update(attendanceRecordsTable).set({ status: "Regularization Pending", updatedAt: new Date() }).where(eq(attendanceRecordsTable.id, attRecord.id));
    }

    await logAudit({ user: req.hrmsUser, action: "REGULARIZATION_REQUEST", module: "Attendance", recordId: created.id, newValue: body.attendanceDate, ipAddress: req.ip });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/regularizations/:id/action", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const regId = Number(req.params.id);

    const [reg] = await db.select().from(attendanceRegularizationsTable).where(eq(attendanceRegularizationsTable.id, regId));
    if (!reg) { res.status(404).json({ error: "Not found" }); return; }

    // State machine: only Pending requests can be actioned
    if (reg.status !== "Pending") {
      res.status(422).json({ error: "This regularization request has already been processed and cannot be re-actioned" });
      return;
    }

    // Enforce payroll lock for the period of the attendance date being modified (Approved action mutates records)
    if (action === "Approved" && reg.attendanceDate) {
      const d = new Date(reg.attendanceDate as string);
      const lockErr = await checkPayrollLock(req.hrmsUser.id, "edit_attendance", d.getFullYear(), d.getMonth() + 1, req.hrmsUser.email ?? undefined);
      if (lockErr) { res.status(423).json({ error: lockErr }); return; }
    }

    // HOD scope authorization: a HOD can only action requests from their own department
    if (req.hrmsUser.role === "hod" && req.hrmsUser.employeeId) {
      const [hodEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, req.hrmsUser.employeeId));
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, reg.employeeId as number));
      if (hodEmp?.departmentId == null || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only action regularization requests from employees in your department" });
        return;
      }
    }

    // Resolve overtime data outside transaction (read-only)
    const template = await getActiveShiftTemplate(reg.employeeId as number, reg.attendanceDate as string);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;

    // Wrap all mutations in a single transaction to prevent partial failures
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(attendanceRegularizationsTable)
        .set({ status: action, hodActionedById: req.hrmsUser!.id, hodRemarks: remarks ?? null, hodActionedAt: new Date(), updatedAt: new Date() })
        .where(eq(attendanceRegularizationsTable.id, regId))
        .returning();
      if (!row) throw new Error("Regularization not found during transaction");

      if (action === "Approved") {
        const signIn = reg.requestedSignIn;
        const signOut = reg.requestedSignOut;
        const totalMins = computeMinutesWorked(signIn, signOut, 0);
        const overtimeMins = template
          ? computeOvertimeMinutes(signOut, reg.attendanceDate as string, template.startTime, template.endTime, overtimeThreshold)
          : 0;
        const newStatus: AttendanceStatus = computeStatus(totalMins, minWorkingMins);

        if (reg.attendanceRecordId) {
          // Existing record: update with corrected times
          await tx.update(attendanceRecordsTable)
            .set({ signInTime: signIn, signOutTime: signOut, totalMinutesWorked: totalMins, overtimeMinutes: overtimeMins, status: newStatus, isHrOverride: false, updatedAt: new Date() })
            .where(eq(attendanceRecordsTable.id, reg.attendanceRecordId as number));
          // Upsert overtime record inside the transaction context (direct db calls share the pool)
          await upsertOvertimeRecord(reg.attendanceRecordId as number, reg.employeeId as number, reg.attendanceDate as string, overtimeMins, template?.shiftRatePerHour);
        } else {
          // No existing record (missed punch) — create one from regularization data
          const [newRecord] = await tx.insert(attendanceRecordsTable).values({
            employeeId: reg.employeeId as number,
            attendanceDate: reg.attendanceDate as string,
            signInTime: signIn,
            signOutTime: signOut,
            totalMinutesWorked: totalMins,
            overtimeMinutes: overtimeMins,
            breakDurationMinutes: 0,
            status: newStatus,
            isHrOverride: false,
            notes: `Created via regularization approval (reg #${regId})`,
          }).returning();
          // Link the new record back to the regularization
          await tx.update(attendanceRegularizationsTable)
            .set({ attendanceRecordId: newRecord.id })
            .where(eq(attendanceRegularizationsTable.id, regId));
          await upsertOvertimeRecord(newRecord.id as number, reg.employeeId as number, reg.attendanceDate as string, overtimeMins, template?.shiftRatePerHour);
        }
      } else if (action === "Rejected" && reg.attendanceRecordId) {
        await tx.update(attendanceRecordsTable)
          .set({ status: "Absent", updatedAt: new Date() })
          .where(and(eq(attendanceRecordsTable.id, reg.attendanceRecordId as number), eq(attendanceRecordsTable.status, "Regularization Pending")));
      }
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: `REGULARIZATION_${action.toUpperCase()}`, module: "Attendance", recordId: regId, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- EMPLOYEE SELF-SERVICE CLOCK IN/OUT ---

async function getCallerEmployeeId(hrmsUserId: number, cachedEmployeeId: number | null | undefined): Promise<number | null> {
  if (cachedEmployeeId) return cachedEmployeeId;
  const [u] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, hrmsUserId));
  return u?.employeeId ?? null;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// Validate a client-supplied calendar date (YYYY-MM-DD in the employee's
// local timezone). Returns the date if it parses cleanly and is within
// ±1 day of the server's UTC date — that window is wide enough for any
// real timezone (UTC-12 to UTC+14) but narrow enough to catch garbage
// or backdating attempts. Returns null otherwise.
function parseClientLocalDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Round-trip to reject impossible calendar dates (e.g. 2026-02-31)
  // that would otherwise silently roll over via JS Date arithmetic.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) return null;
  // Sanity check: must be within ±36 h of server UTC today (covers every
  // real timezone but rejects garbage / backdating attempts).
  const nowMs = Date.now();
  if (probe.getTime() < nowMs - 36 * 60 * 60 * 1000 || probe.getTime() > nowMs + 36 * 60 * 60 * 1000) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Resolve the "today" date for self-service attendance, preferring the
// employee's local date when supplied. Falls back to server UTC for
// pre-timezone-aware clients. Used everywhere the previous code called
// todayStr() for self-service flows.
function resolveAttendanceDate(clientValue: unknown): string {
  return parseClientLocalDate(clientValue) ?? todayStr();
}

// Validate optional client-supplied geolocation/device telemetry on
// self-service clock-in/out. Coordinates are bounded; accuracy is clamped
// to a non-negative integer; userAgent falls back to the request header
// when the client doesn't echo one in the body. Any invalid value is
// silently dropped (the punch still succeeds without telemetry).
function parseClockTelemetry(
  body: unknown,
  headerUserAgent: string | undefined,
): { latitude: string | null; longitude: string | null; accuracy: number | null; userAgent: string | null } {
  const b = (body ?? {}) as { latitude?: unknown; longitude?: unknown; accuracy?: unknown; userAgent?: unknown };
  const lat = typeof b.latitude === "number" && Number.isFinite(b.latitude) && b.latitude >= -90 && b.latitude <= 90 ? b.latitude : null;
  const lng = typeof b.longitude === "number" && Number.isFinite(b.longitude) && b.longitude >= -180 && b.longitude <= 180 ? b.longitude : null;
  const accRaw = typeof b.accuracy === "number" && Number.isFinite(b.accuracy) && b.accuracy >= 0 ? b.accuracy : null;
  const ua = typeof b.userAgent === "string" && b.userAgent.trim().length > 0
    ? b.userAgent.trim().slice(0, 500)
    : (headerUserAgent ? String(headerUserAgent).slice(0, 500) : null);
  // Persist lat/lng paired or not at all to avoid orphaned half-coords.
  const haveBoth = lat !== null && lng !== null;
  return {
    latitude: haveBoth ? lat!.toFixed(6) : null,
    longitude: haveBoth ? lng!.toFixed(6) : null,
    accuracy: accRaw !== null ? Math.round(accRaw) : null,
    userAgent: ua,
  };
}

router.get("/attendance/me/today", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const empId = await getCallerEmployeeId(req.hrmsUser!.id, req.hrmsUser!.employeeId);
    if (!empId) { res.status(400).json({ error: "Employee record not found" }); return; }
    // Prefer the employee's local date (sent as ?date=YYYY-MM-DD) so a
    // punch made just after midnight IST is credited to the right day.
    const today = resolveAttendanceDate(req.query.date);
    const [record] = await db.select().from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, empId), eq(attendanceRecordsTable.attendanceDate, today)));
    const template = await getActiveShiftTemplate(empId, today);
    let attendanceStatus: "Not Clocked In" | "Clocked In" | "Clocked Out" = "Not Clocked In";
    if (record?.signInTime && record?.signOutTime) attendanceStatus = "Clocked Out";
    else if (record?.signInTime) attendanceStatus = "Clocked In";
    res.json({
      attendanceDate: today,
      attendanceStatus,
      record: record ?? null,
      shift: template ? {
        name: template.name,
        startTime: template.startTime,
        endTime: template.endTime,
        expectedMinutes: template.minWorkingHoursMinutes ?? 480,
      } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/me/clock-in", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const empId = await getCallerEmployeeId(req.hrmsUser!.id, req.hrmsUser!.employeeId);
    if (!empId) { res.status(400).json({ error: "Employee record not found" }); return; }
    const today = resolveAttendanceDate((req.body as { clientDate?: unknown })?.clientDate);
    const period = new Date(today);
    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_attendance", period.getFullYear(), period.getMonth() + 1);
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const [existing] = await db.select().from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, empId), eq(attendanceRecordsTable.attendanceDate, today)));
    if (existing?.signInTime) { res.status(422).json({ error: "You have already clocked in for today" }); return; }

    const telemetry = parseClockTelemetry(req.body, req.get("user-agent"));
    const now = new Date();
    let record: typeof attendanceRecordsTable.$inferSelect | undefined;
    if (existing) {
      [record] = await db.update(attendanceRecordsTable)
        .set({
          signInTime: now, status: "Present", updatedAt: new Date(),
          signInLatitude: telemetry.latitude, signInLongitude: telemetry.longitude,
          signInAccuracyMeters: telemetry.accuracy, signInUserAgent: telemetry.userAgent,
        })
        .where(eq(attendanceRecordsTable.id, existing.id)).returning();
    } else {
      [record] = await db.insert(attendanceRecordsTable).values({
        employeeId: empId, attendanceDate: today, signInTime: now, breakDurationMinutes: 0, status: "Present",
        signInLatitude: telemetry.latitude, signInLongitude: telemetry.longitude,
        signInAccuracyMeters: telemetry.accuracy, signInUserAgent: telemetry.userAgent,
      }).returning();
    }
    if (record) {
      await logAudit({ user: req.hrmsUser, action: "CLOCK_IN", module: "Attendance", recordId: record.id, newValue: now.toISOString(), ipAddress: req.ip });
    }
    res.status(201).json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/me/clock-out", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const empId = await getCallerEmployeeId(req.hrmsUser!.id, req.hrmsUser!.employeeId);
    if (!empId) { res.status(400).json({ error: "Employee record not found" }); return; }
    const today = resolveAttendanceDate((req.body as { clientDate?: unknown })?.clientDate);
    const period = new Date(today);
    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_attendance", period.getFullYear(), period.getMonth() + 1);
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const [existing] = await db.select().from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, empId), eq(attendanceRecordsTable.attendanceDate, today)));
    if (!existing?.signInTime) { res.status(422).json({ error: "You haven't clocked in yet today" }); return; }
    if (existing.signOutTime) { res.status(422).json({ error: "You have already clocked out for today" }); return; }

    const signOut = new Date();
    const breakMins = existing.breakDurationMinutes ?? 0;
    const totalMins = computeMinutesWorked(existing.signInTime, signOut, breakMins);
    const template = await getActiveShiftTemplate(empId, today);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
    const overtimeMins = template
      ? computeOvertimeMinutes(signOut, today, template.startTime, template.endTime, overtimeThreshold)
      : 0;
    const newStatus: AttendanceStatus = computeStatus(totalMins, minWorkingMins);

    const telemetry = parseClockTelemetry(req.body, req.get("user-agent"));
    const [updated] = await db.update(attendanceRecordsTable)
      .set({
        signOutTime: signOut, totalMinutesWorked: totalMins, overtimeMinutes: overtimeMins, status: newStatus, updatedAt: new Date(),
        signOutLatitude: telemetry.latitude, signOutLongitude: telemetry.longitude,
        signOutAccuracyMeters: telemetry.accuracy, signOutUserAgent: telemetry.userAgent,
      })
      .where(eq(attendanceRecordsTable.id, existing.id)).returning();
    if (updated) {
      await upsertOvertimeRecord(updated.id, empId, today, overtimeMins, template?.shiftRatePerHour);
      await logAudit({ user: req.hrmsUser, action: "CLOCK_OUT", module: "Attendance", recordId: updated.id, newValue: signOut.toISOString(), ipAddress: req.ip });
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance/:id", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const [record] = await db
      .select({
        id: attendanceRecordsTable.id,
        employeeId: attendanceRecordsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        attendanceDate: attendanceRecordsTable.attendanceDate,
        signInTime: attendanceRecordsTable.signInTime,
        signOutTime: attendanceRecordsTable.signOutTime,
        totalMinutesWorked: attendanceRecordsTable.totalMinutesWorked,
        breakDurationMinutes: attendanceRecordsTable.breakDurationMinutes,
        overtimeMinutes: attendanceRecordsTable.overtimeMinutes,
        status: attendanceRecordsTable.status,
        isHrOverride: attendanceRecordsTable.isHrOverride,
        overrideReason: attendanceRecordsTable.overrideReason,
        notes: attendanceRecordsTable.notes,
        signInLatitude: attendanceRecordsTable.signInLatitude,
        signInLongitude: attendanceRecordsTable.signInLongitude,
        signInAccuracyMeters: attendanceRecordsTable.signInAccuracyMeters,
        signInUserAgent: attendanceRecordsTable.signInUserAgent,
        signOutLatitude: attendanceRecordsTable.signOutLatitude,
        signOutLongitude: attendanceRecordsTable.signOutLongitude,
        signOutAccuracyMeters: attendanceRecordsTable.signOutAccuracyMeters,
        signOutUserAgent: attendanceRecordsTable.signOutUserAgent,
        createdAt: attendanceRecordsTable.createdAt,
        updatedAt: attendanceRecordsTable.updatedAt,
      })
      .from(attendanceRecordsTable)
      .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
      .where(eq(attendanceRecordsTable.id, Number(req.params.id)));
    if (!record) { res.status(404).json({ error: "Not found" }); return; }
    res.json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/attendance/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body;
    if (!body.overrideReason) { res.status(400).json({ error: "overrideReason is required for HR override" }); return; }
    const id = Number(req.params.id);
    const [existing] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Check lock against the actual date of the attendance record being patched
    const recordPeriod = existing.attendanceDate ? new Date(existing.attendanceDate) : new Date();
    const lockError = await checkPayrollLock(
      req.hrmsUser!.id, "edit_attendance",
      recordPeriod.getFullYear(), recordPeriod.getMonth() + 1,
    );
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const signIn = body.signInTime ? new Date(body.signInTime) : existing.signInTime;
    const signOut = body.signOutTime ? new Date(body.signOutTime) : existing.signOutTime;
    const breakMins: number = body.breakDurationMinutes ?? existing.breakDurationMinutes ?? 0;
    const totalMins = computeMinutesWorked(signIn, signOut, breakMins);
    const template = await getActiveShiftTemplate(existing.employeeId, existing.attendanceDate);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
    const overtimeMins = template
      ? computeOvertimeMinutes(signOut, existing.attendanceDate, template.startTime, template.endTime, overtimeThreshold)
      : 0;
    const newStatus: AttendanceStatus = body.status ?? computeStatus(totalMins, minWorkingMins);

    const [updated] = await db.update(attendanceRecordsTable)
      .set({
        signInTime: signIn,
        signOutTime: signOut,
        breakDurationMinutes: breakMins,
        totalMinutesWorked: totalMins,
        overtimeMinutes: overtimeMins,
        status: newStatus,
        isHrOverride: true,
        overrideReason: body.overrideReason,
        overrideById: req.hrmsUser.id,
        overrideAt: new Date(),
        notes: body.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecordsTable.id, id))
      .returning();
    if (updated) {
      await upsertOvertimeRecord(updated.id, existing.employeeId, existing.attendanceDate, overtimeMins, template?.shiftRatePerHour);
    }
    await logAudit({ user: req.hrmsUser, action: "HR_OVERRIDE", module: "Attendance", recordId: id, newValue: JSON.stringify(body), ipAddress: req.ip });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/attendance", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const empId = Number(req.params.id);
    if (req.hrmsUser.role === "employee") {
      const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
      if (!userRow?.employeeId || userRow.employeeId !== empId) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    const { month } = req.query;
    const conditions: SQL<unknown>[] = [eq(attendanceRecordsTable.employeeId, empId)];
    if (month && typeof month === "string") {
      const [y, mo] = month.split("-").map(Number);
      const start = `${y}-${String(mo).padStart(2, "0")}-01`;
      const lastDay = new Date(y, mo, 0).getDate();
      const end = `${y}-${String(mo).padStart(2, "0")}-${lastDay}`;
      conditions.push(gte(attendanceRecordsTable.attendanceDate, start));
      conditions.push(lte(attendanceRecordsTable.attendanceDate, end));
    }
    const rows = await db.select().from(attendanceRecordsTable).where(and(...conditions)).orderBy(attendanceRecordsTable.attendanceDate);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/overtime", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const empId = Number(req.params.id);
    const { month } = req.query;
    const conditions: SQL<unknown>[] = [eq(overtimeRecordsTable.employeeId, empId)];
    if (month && typeof month === "string") {
      const [y, mo] = month.split("-").map(Number);
      const start = `${y}-${String(mo).padStart(2, "0")}-01`;
      const lastDay = new Date(y, mo, 0).getDate();
      const end = `${y}-${String(mo).padStart(2, "0")}-${lastDay}`;
      conditions.push(gte(overtimeRecordsTable.attendanceDate, start));
      conditions.push(lte(overtimeRecordsTable.attendanceDate, end));
    }
    const rows = await db.select().from(overtimeRecordsTable).where(and(...conditions)).orderBy(overtimeRecordsTable.attendanceDate);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
