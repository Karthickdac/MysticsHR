import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  shiftTemplatesTable,
  shiftAssignmentsTable,
  shiftSwapsTable,
  attendanceRecordsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, isNull, gte, lte, or, SQL } from "drizzle-orm";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

type ShiftSwapStatus = "Pending" | "Approved" | "Rejected";

// --- SHIFT TEMPLATES ---

router.get("/shifts/templates", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { isActive, departmentId } = req.query;
    const where: SQL<unknown>[] = [];
    if (isActive !== undefined) where.push(eq(shiftTemplatesTable.isActive, isActive === "true"));
    if (departmentId) where.push(eq(shiftTemplatesTable.departmentId, Number(departmentId)));
    const templates = await db
      .select()
      .from(shiftTemplatesTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(shiftTemplatesTable.name);
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shifts/templates", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body;
    const [created] = await db.insert(shiftTemplatesTable).values({
      name: body.name,
      shiftType: body.shiftType ?? "Fixed",
      startTime: body.startTime,
      endTime: body.endTime,
      gracePeriodMinutes: body.gracePeriodMinutes ?? 0,
      breakDurationMinutes: body.breakDurationMinutes ?? 0,
      minWorkingHoursMinutes: body.minWorkingHoursMinutes ?? 480,
      weeklyOff: body.weeklyOff ?? null,
      departmentId: body.departmentId ?? null,
      shiftRatePerHour: body.shiftRatePerHour ?? null,
      nightDifferentialRate: body.nightDifferentialRate ?? null,
      overtimeThresholdMinutes: body.overtimeThresholdMinutes ?? 30,
      isActive: body.isActive !== false,
      notes: body.notes ?? null,
    }).returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "ShiftTemplates", recordId: created.id, newValue: created.name, ipAddress: req.ip });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/shifts/templates/:id", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const [template] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, Number(req.params.id)));
    if (!template) { res.status(404).json({ error: "Not found" }); return; }
    res.json(template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/shifts/templates/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body;
    const templateId = Number(req.params.id);

    const [before] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, templateId));
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(shiftTemplatesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(shiftTemplatesTable.id, templateId))
      .returning();

    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "ShiftTemplates", recordId: updated.id, newValue: JSON.stringify(body), ipAddress: req.ip });

    // Payroll impact notification: if shift rate changed, return affected employees
    const oldRate = before.shiftRatePerHour;
    const newRate = updated.shiftRatePerHour;
    let payrollImpact: { affectedCount: number; affectedEmployees: { id: number; firstName: string; lastName: string; employeeId: string }[] } | null = null;

    if (oldRate !== newRate) {
      const affectedAssignments = await db
        .select({
          id: employeesTable.id,
          firstName: employeesTable.firstName,
          lastName: employeesTable.lastName,
          employeeId: employeesTable.employeeId,
        })
        .from(shiftAssignmentsTable)
        .innerJoin(employeesTable, eq(shiftAssignmentsTable.employeeId, employeesTable.id))
        .where(
          and(
            eq(shiftAssignmentsTable.shiftTemplateId, templateId),
            or(isNull(shiftAssignmentsTable.effectiveTo), gte(shiftAssignmentsTable.effectiveTo, new Date().toISOString().slice(0, 10))),
          )
        );

      payrollImpact = {
        affectedCount: affectedAssignments.length,
        affectedEmployees: affectedAssignments,
      };
    }

    res.json({ template: updated, payrollImpact });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/shifts/templates/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const [deleted] = await db.delete(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, Number(req.params.id))).returning({ id: shiftTemplatesTable.id });
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "ShiftTemplates", recordId: deleted.id, ipAddress: req.ip });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SHIFT ASSIGNMENTS ---

router.get("/employees/:id/shift-assignments", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const empId = Number(req.params.id);
    const assignments = await db
      .select({
        id: shiftAssignmentsTable.id,
        employeeId: shiftAssignmentsTable.employeeId,
        shiftTemplateId: shiftAssignmentsTable.shiftTemplateId,
        shiftTemplateName: shiftTemplatesTable.name,
        effectiveFrom: shiftAssignmentsTable.effectiveFrom,
        effectiveTo: shiftAssignmentsTable.effectiveTo,
        assignedById: shiftAssignmentsTable.assignedById,
        notes: shiftAssignmentsTable.notes,
        createdAt: shiftAssignmentsTable.createdAt,
        updatedAt: shiftAssignmentsTable.updatedAt,
      })
      .from(shiftAssignmentsTable)
      .leftJoin(shiftTemplatesTable, eq(shiftAssignmentsTable.shiftTemplateId, shiftTemplatesTable.id))
      .where(eq(shiftAssignmentsTable.employeeId, empId))
      .orderBy(shiftAssignmentsTable.effectiveFrom);
    res.json(assignments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/shift-assignments", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const empId = Number(req.params.id);
    const body = req.body;
    const [created] = await db.insert(shiftAssignmentsTable).values({
      employeeId: empId,
      shiftTemplateId: body.shiftTemplateId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      assignedById: req.hrmsUser.id,
      notes: body.notes ?? null,
    }).returning();
    const [withName] = await db.select({
      id: shiftAssignmentsTable.id,
      employeeId: shiftAssignmentsTable.employeeId,
      shiftTemplateId: shiftAssignmentsTable.shiftTemplateId,
      shiftTemplateName: shiftTemplatesTable.name,
      effectiveFrom: shiftAssignmentsTable.effectiveFrom,
      effectiveTo: shiftAssignmentsTable.effectiveTo,
      assignedById: shiftAssignmentsTable.assignedById,
      notes: shiftAssignmentsTable.notes,
      createdAt: shiftAssignmentsTable.createdAt,
      updatedAt: shiftAssignmentsTable.updatedAt,
    }).from(shiftAssignmentsTable)
      .leftJoin(shiftTemplatesTable, eq(shiftAssignmentsTable.shiftTemplateId, shiftTemplatesTable.id))
      .where(eq(shiftAssignmentsTable.id, created.id));
    await logAudit({ user: req.hrmsUser, action: "SHIFT_ASSIGN", module: "ShiftAssignments", recordId: created.id, newValue: `Employee ${empId} → template ${body.shiftTemplateId}`, ipAddress: req.ip });
    res.status(201).json(withName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/shift-assignments/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const [deleted] = await db.delete(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, Number(req.params.id))).returning({ id: shiftAssignmentsTable.id });
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SHIFT CALENDAR ---

router.get("/shifts/calendar", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { month, departmentId, employeeId } = req.query;
    if (!month || typeof month !== "string") { res.status(400).json({ error: "month is required (YYYY-MM)" }); return; }
    const [year, mon] = month.split("-").map(Number);
    const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${year}-${String(mon).padStart(2, "0")}-${lastDay}`;

    const calendarWhere: SQL<unknown>[] = [
      lte(shiftAssignmentsTable.effectiveFrom, endDate),
      or(isNull(shiftAssignmentsTable.effectiveTo), gte(shiftAssignmentsTable.effectiveTo, startDate)),
    ];
    if (employeeId) calendarWhere.push(eq(shiftAssignmentsTable.employeeId, Number(employeeId)));
    if (departmentId) calendarWhere.push(eq(employeesTable.departmentId, Number(departmentId)));

    const assignments = await db
      .select({
        employeeId: shiftAssignmentsTable.employeeId,
        shiftTemplateId: shiftAssignmentsTable.shiftTemplateId,
        shiftName: shiftTemplatesTable.name,
        startTime: shiftTemplatesTable.startTime,
        endTime: shiftTemplatesTable.endTime,
        effectiveFrom: shiftAssignmentsTable.effectiveFrom,
        effectiveTo: shiftAssignmentsTable.effectiveTo,
        empFirstName: employeesTable.firstName,
        empLastName: employeesTable.lastName,
        empCode: employeesTable.employeeId,
        deptId: employeesTable.departmentId,
      })
      .from(shiftAssignmentsTable)
      .leftJoin(shiftTemplatesTable, eq(shiftAssignmentsTable.shiftTemplateId, shiftTemplatesTable.id))
      .leftJoin(employeesTable, eq(shiftAssignmentsTable.employeeId, employeesTable.id))
      .where(and(...calendarWhere));

    const attRecords = await db
      .select({ employeeId: attendanceRecordsTable.employeeId, attendanceDate: attendanceRecordsTable.attendanceDate, status: attendanceRecordsTable.status })
      .from(attendanceRecordsTable)
      .where(and(
        gte(attendanceRecordsTable.attendanceDate, startDate),
        lte(attendanceRecordsTable.attendanceDate, endDate),
      ));

    const attMap = new Map<string, string>();
    for (const r of attRecords) {
      attMap.set(`${r.employeeId}:${r.attendanceDate}`, r.status);
    }

    const calendarEntries: {
      employeeId: number | null;
      employeeName: string;
      employeeCode: string;
      date: string;
      shiftTemplateId: number | null;
      shiftName: string | null;
      startTime: string | null;
      endTime: string | null;
      attendanceStatus: string | null;
    }[] = [];

    for (let d = 1; d <= lastDay; d++) {
      const dayStr = `${year}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      for (const a of assignments) {
        if (dayStr >= a.effectiveFrom && (a.effectiveTo === null || dayStr <= a.effectiveTo)) {
          calendarEntries.push({
            employeeId: a.employeeId,
            employeeName: `${a.empFirstName ?? ""} ${a.empLastName ?? ""}`.trim(),
            employeeCode: a.empCode ?? "",
            date: dayStr,
            shiftTemplateId: a.shiftTemplateId,
            shiftName: a.shiftName ?? null,
            startTime: a.startTime ?? null,
            endTime: a.endTime ?? null,
            attendanceStatus: attMap.get(`${a.employeeId}:${dayStr}`) ?? null,
          });
        }
      }
    }
    res.json(calendarEntries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SHIFT SWAPS ---

router.get("/shift-swaps", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { status, employeeId } = req.query;
    const user = req.hrmsUser;
    const where: SQL<unknown>[] = [];

    if (status) {
      const validStatuses: ShiftSwapStatus[] = ["Pending", "Approved", "Rejected"];
      if (validStatuses.includes(status as ShiftSwapStatus)) {
        where.push(eq(shiftSwapsTable.hodStatus, status as ShiftSwapStatus));
      }
    }

    // Employees can only view their own swap requests
    if (user.role === "employee") {
      const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, user.id));
      if (!userRow?.employeeId) { res.status(400).json({ error: "Employee record not found" }); return; }
      where.push(
        or(
          eq(shiftSwapsTable.requesterEmployeeId, userRow.employeeId),
          eq(shiftSwapsTable.swapWithEmployeeId, userRow.employeeId),
        )
      );
    } else if (employeeId) {
      where.push(eq(shiftSwapsTable.requesterEmployeeId, Number(employeeId)));
    }

    const rows = await db
      .select({
        id: shiftSwapsTable.id,
        requesterEmployeeId: shiftSwapsTable.requesterEmployeeId,
        swapWithEmployeeId: shiftSwapsTable.swapWithEmployeeId,
        swapDate: shiftSwapsTable.swapDate,
        reason: shiftSwapsTable.reason,
        hodStatus: shiftSwapsTable.hodStatus,
        hodRemarks: shiftSwapsTable.hodRemarks,
        hodActionedAt: shiftSwapsTable.hodActionedAt,
        hrStatus: shiftSwapsTable.hrStatus,
        hrRemarks: shiftSwapsTable.hrRemarks,
        hrActionedAt: shiftSwapsTable.hrActionedAt,
        createdAt: shiftSwapsTable.createdAt,
        updatedAt: shiftSwapsTable.updatedAt,
      })
      .from(shiftSwapsTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(shiftSwapsTable.createdAt);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shift-swaps", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const body = req.body;

    // Find requester employee via hrmsUser link
    const [userRow] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, req.hrmsUser.id));
    const requesterId = userRow?.employeeId ?? null;
    if (!requesterId) { res.status(400).json({ error: "Could not find employee record" }); return; }

    // Enforce same-department eligibility: both employees must be in the same department
    const [requesterEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, requesterId));
    const [swapWithEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, Number(body.swapWithEmployeeId)));

    if (!requesterEmp || !swapWithEmp) { res.status(400).json({ error: "Employee record not found" }); return; }
    if (requesterEmp.departmentId !== swapWithEmp.departmentId) {
      res.status(422).json({ error: "Shift swaps are only allowed between employees in the same department" });
      return;
    }

    const [created] = await db.insert(shiftSwapsTable).values({
      requesterEmployeeId: requesterId,
      swapWithEmployeeId: body.swapWithEmployeeId,
      swapDate: body.swapDate,
      reason: body.reason ?? null,
    }).returning();
    await logAudit({ user: req.hrmsUser, action: "SHIFT_SWAP_REQUEST", module: "ShiftSwaps", recordId: created.id, newValue: `Swap on ${body.swapDate}`, ipAddress: req.ip });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shift-swaps/:id/hod-action", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const [updated] = await db.update(shiftSwapsTable)
      .set({ hodStatus: action, hodRemarks: remarks ?? null, hodActionedById: req.hrmsUser.id, hodActionedAt: new Date(), updatedAt: new Date() })
      .where(eq(shiftSwapsTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: `HOD_${action.toUpperCase()}`, module: "ShiftSwaps", recordId: updated.id, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shift-swaps/:id/hr-action", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const [updated] = await db.update(shiftSwapsTable)
      .set({ hrStatus: action, hrRemarks: remarks ?? null, hrActionedById: req.hrmsUser.id, hrActionedAt: new Date(), updatedAt: new Date() })
      .where(eq(shiftSwapsTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: `HR_${action.toUpperCase()}`, module: "ShiftSwaps", recordId: updated.id, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
