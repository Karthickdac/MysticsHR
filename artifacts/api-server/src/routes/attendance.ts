import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  attendanceRecordsTable,
  attendanceRegularizationsTable,
  overtimeRecordsTable,
  shiftTemplatesTable,
  shiftAssignmentsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNull, sql } from "drizzle-orm";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

function computeMinutesWorked(signIn: Date | null, signOut: Date | null, breakMins: number): number | null {
  if (!signIn || !signOut) return null;
  return Math.max(0, Math.round((signOut.getTime() - signIn.getTime()) / 60000) - breakMins);
}

function computeStatus(minutesWorked: number | null, minWorkingMins: number): string {
  if (minutesWorked === null) return "Absent";
  if (minutesWorked >= minWorkingMins) return "Present";
  if (minutesWorked >= minWorkingMins / 2) return "Half-Day";
  return "Absent";
}

async function getActiveShiftTemplate(employeeId: number, date: string) {
  const [assignment] = await db
    .select({ shiftTemplateId: shiftAssignmentsTable.shiftTemplateId })
    .from(shiftAssignmentsTable)
    .where(
      and(
        eq(shiftAssignmentsTable.employeeId, employeeId),
        lte(shiftAssignmentsTable.effectiveFrom, date),
        isNull(shiftAssignmentsTable.effectiveTo),
      )
    )
    .orderBy(shiftAssignmentsTable.effectiveFrom)
    .limit(1);
  if (!assignment) return null;
  const [template] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, assignment.shiftTemplateId));
  return template ?? null;
}

// --- ATTENDANCE RECORDS ---

router.get("/attendance", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { date, month, employeeId, departmentId, status } = req.query;
    const conditions: any[] = [];
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
    if (status) conditions.push(eq(attendanceRecordsTable.status, status as any));

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
        createdAt: attendanceRecordsTable.createdAt,
        updatedAt: attendanceRecordsTable.updatedAt,
      })
      .from(attendanceRecordsTable)
      .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(attendanceRecordsTable.attendanceDate, attendanceRecordsTable.employeeId);

    // Apply departmentId filter in memory (join would require extra complexity)
    if (departmentId) {
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.departmentId, Number(departmentId)));
      const ids = new Set(deptEmps.map((e) => e.id));
      res.json(rows.filter((r) => ids.has(r.employeeId)));
      return;
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body;
    const signIn = body.signInTime ? new Date(body.signInTime) : null;
    const signOut = body.signOutTime ? new Date(body.signOutTime) : null;
    const breakMins = body.breakDurationMinutes ?? 0;
    const totalMins = computeMinutesWorked(signIn, signOut, breakMins);

    // Get shift for overtime calculation
    const template = await getActiveShiftTemplate(body.employeeId, body.attendanceDate);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
    const overtimeMins = totalMins !== null && totalMins > minWorkingMins + overtimeThreshold
      ? totalMins - minWorkingMins
      : 0;
    const computedStatus = body.status ?? computeStatus(totalMins, minWorkingMins);

    const [existing] = await db.select({ id: attendanceRecordsTable.id }).from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, body.employeeId), eq(attendanceRecordsTable.attendanceDate, body.attendanceDate)));

    let record: any;
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
        status: computedStatus as any,
        notes: body.notes ?? null,
      }).returning();
    }

    // Create overtime record if applicable
    if (overtimeMins > 0 && record) {
      const [existOt] = await db.select({ id: overtimeRecordsTable.id }).from(overtimeRecordsTable)
        .where(and(eq(overtimeRecordsTable.attendanceRecordId, record.id)));
      if (!existOt) {
        await db.insert(overtimeRecordsTable).values({
          employeeId: body.employeeId,
          attendanceDate: body.attendanceDate,
          overtimeMinutes: overtimeMins,
          ratePerHour: template?.shiftRatePerHour ?? null,
          totalAmount: template?.shiftRatePerHour ? String(Number(template.shiftRatePerHour) * overtimeMins / 60) : null,
          attendanceRecordId: record.id,
        });
      }
    }

    await logAudit({ user: req.hrmsUser, action: existing ? "UPDATE" : "CREATE", module: "Attendance", recordId: record.id, newValue: `${body.employeeId}:${body.attendanceDate}:${computedStatus}`, ipAddress: req.ip });
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

    // Aggregate per employee
    const summaryMap = new Map<number, any>();
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
    const conditions: any[] = [];
    if (status) conditions.push(eq(attendanceRegularizationsTable.status, status as any));
    if (employeeId) conditions.push(eq(attendanceRegularizationsTable.employeeId, Number(employeeId)));
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
    // Find employee record for current user via hrmsUser link
    const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
    const emp = userRow?.employeeId ? { id: userRow.employeeId } : null;
    if (!emp) { res.status(400).json({ error: "Employee record not found" }); return; }

    // Check for existing attendance record
    const [attRecord] = await db.select({ id: attendanceRecordsTable.id }).from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.attendanceDate, body.attendanceDate)));

    const [created] = await db.insert(attendanceRegularizationsTable).values({
      employeeId: emp.id,
      attendanceDate: body.attendanceDate,
      requestedSignIn: body.requestedSignIn ? new Date(body.requestedSignIn) : null,
      requestedSignOut: body.requestedSignOut ? new Date(body.requestedSignOut) : null,
      reason: body.reason,
      attendanceRecordId: attRecord?.id ?? null,
    }).returning();

    // Update attendance status to Regularization Pending
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

    const [updated] = await db.update(attendanceRegularizationsTable)
      .set({ status: action, hodActionedById: req.hrmsUser.id, hodRemarks: remarks ?? null, hodActionedAt: new Date(), updatedAt: new Date() })
      .where(eq(attendanceRegularizationsTable.id, regId))
      .returning();

    // Apply attendance override on approval
    if (action === "Approved" && reg.attendanceRecordId) {
      const signIn = reg.requestedSignIn;
      const signOut = reg.requestedSignOut;
      const breakMins = 0;
      const totalMins = computeMinutesWorked(signIn, signOut, breakMins);
      const template = await getActiveShiftTemplate(reg.employeeId, reg.attendanceDate);
      const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
      const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
      const overtimeMins = totalMins !== null && totalMins > minWorkingMins + overtimeThreshold ? totalMins - minWorkingMins : 0;
      const status = computeStatus(totalMins, minWorkingMins);
      await db.update(attendanceRecordsTable)
        .set({ signInTime: signIn, signOutTime: signOut, totalMinutesWorked: totalMins, overtimeMinutes: overtimeMins, status: status as any, isHrOverride: false, updatedAt: new Date() })
        .where(eq(attendanceRecordsTable.id, reg.attendanceRecordId));
    } else if (action === "Rejected" && reg.attendanceRecordId) {
      // Revert status from Regularization Pending
      await db.update(attendanceRecordsTable)
        .set({ status: "Absent", updatedAt: new Date() })
        .where(and(eq(attendanceRecordsTable.id, reg.attendanceRecordId), eq(attendanceRecordsTable.status, "Regularization Pending")));
    }

    await logAudit({ user: req.hrmsUser, action: `REGULARIZATION_${action.toUpperCase()}`, module: "Attendance", recordId: regId, newValue: action, ipAddress: req.ip });
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
    const id = Number(req.params.id);
    const [existing] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const signIn = body.signInTime ? new Date(body.signInTime) : existing.signInTime;
    const signOut = body.signOutTime ? new Date(body.signOutTime) : existing.signOutTime;
    const breakMins = body.breakDurationMinutes ?? existing.breakDurationMinutes ?? 0;
    const totalMins = computeMinutesWorked(signIn, signOut, breakMins);
    const template = await getActiveShiftTemplate(existing.employeeId, existing.attendanceDate);
    const minWorkingMins = template?.minWorkingHoursMinutes ?? 480;
    const overtimeThreshold = template?.overtimeThresholdMinutes ?? 30;
    const overtimeMins = totalMins !== null && totalMins > minWorkingMins + overtimeThreshold ? totalMins - minWorkingMins : 0;
    const newStatus = body.status ?? computeStatus(totalMins, minWorkingMins);

    const [updated] = await db.update(attendanceRecordsTable)
      .set({
        signInTime: signIn,
        signOutTime: signOut,
        breakDurationMinutes: breakMins,
        totalMinutesWorked: totalMins,
        overtimeMinutes: overtimeMins,
        status: newStatus as any,
        isHrOverride: true,
        overrideReason: body.overrideReason,
        overrideById: req.hrmsUser.id,
        overrideAt: new Date(),
        notes: body.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecordsTable.id, id))
      .returning();
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
    // Employees can only view their own
    if (req.hrmsUser.role === "employee") {
      const [userRow2] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
      if (!userRow2?.employeeId || userRow2.employeeId !== empId) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    const { month } = req.query;
    const conditions: any[] = [eq(attendanceRecordsTable.employeeId, empId)];
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
    const conditions: any[] = [eq(overtimeRecordsTable.employeeId, empId)];
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
