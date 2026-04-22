import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { dispatchNotification } from "../lib/notification-service";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { checkPayrollLock } from "../lib/payroll-lock";
import { runCarryForwardForYear, CarryForwardLockedError } from "../lib/carry-forward";
import {
  applyLeaveToAttendance,
  revertLeaveFromAttendance,
  revertLeaveDaysFromAttendance,
  listDatesInRange,
} from "../lib/leave-attendance-sync";
import {
  leaveTypesTable,
  leavePoliciesTable,
  leaveBalancesTable,
  leaveApplicationsTable,
  leaveAccrualHistoryTable,
  blackoutDatesTable,
  employeesTable,
  hrmsUsersTable,
  departmentsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNull, or, sql, desc, SQL, inArray } from "drizzle-orm";

const LEAVE_STATUSES = ["Pending", "HOD Approved", "HR Approved", "Approved", "Rejected", "Cancelled", "Cancel Requested"] as const;
type LeaveStatusValue = (typeof LEAVE_STATUSES)[number];

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function computeWorkingDays(from: string, to: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5;
  const start = new Date(from);
  const end = new Date(to);
  let days = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

async function getEmployeeForUser(userId: number): Promise<{
  id: number; departmentId: number | null; employmentType: string | null; gender: string | null;
} | null> {
  const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, userId));
  if (!user?.employeeId) return null;
  const [emp] = await db.select({
    id: employeesTable.id,
    departmentId: employeesTable.departmentId,
    employmentType: employeesTable.employmentType,
    gender: employeesTable.gender,
  }).from(employeesTable).where(eq(employeesTable.id, user.employeeId));
  return emp ?? null;
}

async function getOrCreateBalance(employeeId: number, leaveTypeId: number, year: number, allocate?: string) {
  const [existing] = await db
    .select()
    .from(leaveBalancesTable)
    .where(and(
      eq(leaveBalancesTable.employeeId, employeeId),
      eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
      eq(leaveBalancesTable.year, year),
    ));
  if (existing) return existing;
  const [created] = await db.insert(leaveBalancesTable).values({
    employeeId,
    leaveTypeId,
    year,
    allocated: allocate ?? "0",
    used: "0",
    pending: "0",
    carryForward: "0",
  }).returning();
  return created;
}

// ─── LEAVE TYPES ─────────────────────────────────────────────────────────────

router.get("/leave/types", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { isActive } = req.query as { isActive?: string };
    const conds: SQL[] = [];
    if (isActive !== undefined) conds.push(eq(leaveTypesTable.isActive, isActive === "true"));
    const types = await db.select().from(leaveTypesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(leaveTypesTable.name);
    res.json(types);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/leave/types/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [type] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, Number(req.params.id)));
    if (!type) { res.status(404).json({ error: "Not found" }); return; }
    res.json(type);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/types", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as {
      name: string; code: string; description?: string; annualQuota: string;
      carryForwardEnabled?: boolean; carryForwardMax?: string; encashmentEnabled?: boolean;
      applicableEmploymentTypes?: string[]; minConsecutiveDays?: string; maxConsecutiveDays?: string;
      advanceNoticeDays?: number; requiresHrApproval?: boolean; requiresHodApproval?: boolean;
      allowHalfDay?: boolean; lopByDefault?: boolean; isActive?: boolean;
    };
    const [type] = await db.insert(leaveTypesTable).values({
      name: body.name,
      code: body.code.toUpperCase(),
      description: body.description,
      annualQuota: body.annualQuota,
      carryForwardEnabled: body.carryForwardEnabled ?? false,
      carryForwardMax: body.carryForwardMax,
      encashmentEnabled: body.encashmentEnabled ?? false,
      applicableEmploymentTypes: body.applicableEmploymentTypes,
      minConsecutiveDays: body.minConsecutiveDays,
      maxConsecutiveDays: body.maxConsecutiveDays,
      advanceNoticeDays: body.advanceNoticeDays ?? 0,
      requiresHrApproval: body.requiresHrApproval ?? true,
      requiresHodApproval: body.requiresHodApproval ?? true,
      allowHalfDay: body.allowHalfDay ?? true,
      lopByDefault: body.lopByDefault ?? false,
      isActive: body.isActive ?? true,
    }).returning();
    // Auto-create a corresponding leave_policies record (1:1) seeded from the type's initial policy values
    await db.insert(leavePoliciesTable).values({
      leaveTypeId: type.id,
      requiresHodApproval: body.requiresHodApproval ?? true,
      requiresHrApproval: body.requiresHrApproval ?? true,
      advanceNoticeDays: body.advanceNoticeDays ?? 0,
      minConsecutiveDays: body.minConsecutiveDays,
      maxConsecutiveDays: body.maxConsecutiveDays,
      allowHalfDay: body.allowHalfDay ?? true,
      lopByDefault: body.lopByDefault ?? false,
      carryForwardEnabled: body.carryForwardEnabled ?? false,
      carryForwardMax: body.carryForwardMax,
      encashmentEnabled: body.encashmentEnabled ?? false,
      applicableEmploymentTypes: body.applicableEmploymentTypes,
    }).onConflictDoNothing();
    await logAudit({ user: req.hrmsUser, action: "CREATE_LEAVE_TYPE", module: "Leave", recordId: type.id, newValue: type.name, ipAddress: req.ip });
    res.status(201).json(type);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/leave/types/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as Partial<typeof leaveTypesTable.$inferInsert>;
    const [updated] = await db.update(leaveTypesTable)
      .set({ ...body, code: body.code ? String(body.code).toUpperCase() : undefined, updatedAt: new Date() })
      .where(eq(leaveTypesTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: "UPDATE_LEAVE_TYPE", module: "Leave", recordId: updated.id, newValue: updated.name, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/leave/types/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const [updated] = await db.update(leaveTypesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(leaveTypesTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: "DEACTIVATE_LEAVE_TYPE", module: "Leave", recordId: updated.id, newValue: updated.name, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LEAVE POLICIES ──────────────────────────────────────────────────────────
// Policy is the configurable behaviour layer of each leave type.
// These endpoints expose CRUD for policy-specific fields independently of
// the leave type's base attributes (name, code, quota, active flag).

const POLICY_SHAPE = {
  id: leavePoliciesTable.id,
  leaveTypeId: leavePoliciesTable.leaveTypeId,
  leaveTypeName: leaveTypesTable.name,
  leaveTypeCode: leaveTypesTable.code,
  isActive: leaveTypesTable.isActive,
  requiresHodApproval: leavePoliciesTable.requiresHodApproval,
  requiresHrApproval: leavePoliciesTable.requiresHrApproval,
  advanceNoticeDays: leavePoliciesTable.advanceNoticeDays,
  minConsecutiveDays: leavePoliciesTable.minConsecutiveDays,
  maxConsecutiveDays: leavePoliciesTable.maxConsecutiveDays,
  allowHalfDay: leavePoliciesTable.allowHalfDay,
  lopByDefault: leavePoliciesTable.lopByDefault,
  carryForwardEnabled: leavePoliciesTable.carryForwardEnabled,
  carryForwardMax: leavePoliciesTable.carryForwardMax,
  encashmentEnabled: leavePoliciesTable.encashmentEnabled,
  applicableEmploymentTypes: leavePoliciesTable.applicableEmploymentTypes,
  createdAt: leavePoliciesTable.createdAt,
  updatedAt: leavePoliciesTable.updatedAt,
};

// Helper: upsert a policy row so the endpoint never returns 404 for seed data
async function getOrCreatePolicy(leaveTypeId: number) {
  const [existing] = await db.select().from(leavePoliciesTable).where(eq(leavePoliciesTable.leaveTypeId, leaveTypeId));
  if (existing) return existing;
  const [lt] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, leaveTypeId));
  if (!lt) return null;
  const [created] = await db.insert(leavePoliciesTable).values({
    leaveTypeId,
    requiresHodApproval: lt.requiresHodApproval,
    requiresHrApproval: lt.requiresHrApproval,
    advanceNoticeDays: lt.advanceNoticeDays,
    minConsecutiveDays: lt.minConsecutiveDays ?? undefined,
    maxConsecutiveDays: lt.maxConsecutiveDays ?? undefined,
    allowHalfDay: lt.allowHalfDay,
    lopByDefault: lt.lopByDefault,
    carryForwardEnabled: lt.carryForwardEnabled,
    carryForwardMax: lt.carryForwardMax ?? undefined,
    encashmentEnabled: lt.encashmentEnabled,
    applicableEmploymentTypes: lt.applicableEmploymentTypes ?? undefined,
  }).onConflictDoNothing().returning();
  return created ?? null;
}

router.get("/leave/policies", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    // Ensure policy records exist for all active leave types (handles pre-existing types)
    const allTypes = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.isActive, true));
    for (const lt of allTypes) {
      await getOrCreatePolicy(lt.id);
    }
    const policies = await db.select(POLICY_SHAPE)
      .from(leavePoliciesTable)
      .innerJoin(leaveTypesTable, eq(leavePoliciesTable.leaveTypeId, leaveTypesTable.id))
      .orderBy(leaveTypesTable.name);
    res.json(policies);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/leave/policies/:typeId", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const typeId = Number(req.params.typeId);
    await getOrCreatePolicy(typeId);
    const [policy] = await db.select(POLICY_SHAPE)
      .from(leavePoliciesTable)
      .innerJoin(leaveTypesTable, eq(leavePoliciesTable.leaveTypeId, leaveTypesTable.id))
      .where(eq(leavePoliciesTable.leaveTypeId, typeId));
    if (!policy) { res.status(404).json({ error: "Leave type not found" }); return; }
    res.json(policy);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/leave/policies/:typeId", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const typeId = Number(req.params.typeId);
    const body = req.body as {
      requiresHodApproval?: boolean; requiresHrApproval?: boolean; advanceNoticeDays?: number;
      minConsecutiveDays?: string | null; maxConsecutiveDays?: string | null; allowHalfDay?: boolean;
      lopByDefault?: boolean; carryForwardEnabled?: boolean; carryForwardMax?: string | null;
      encashmentEnabled?: boolean; applicableEmploymentTypes?: string[] | null;
    };
    await getOrCreatePolicy(typeId);
    const [updatedPolicy] = await db.update(leavePoliciesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(leavePoliciesTable.leaveTypeId, typeId))
      .returning();
    if (!updatedPolicy) { res.status(404).json({ error: "Leave policy not found" }); return; }
    // Sync policy changes back to leave_types to keep the tables consistent
    await db.update(leaveTypesTable).set({ ...body, updatedAt: new Date() }).where(eq(leaveTypesTable.id, typeId));
    await logAudit({ user: req.hrmsUser, action: "UPDATE_LEAVE_POLICY", module: "Leave", recordId: typeId, newValue: String(typeId), ipAddress: req.ip });
    const [result] = await db.select(POLICY_SHAPE)
      .from(leavePoliciesTable)
      .innerJoin(leaveTypesTable, eq(leavePoliciesTable.leaveTypeId, leaveTypesTable.id))
      .where(eq(leavePoliciesTable.leaveTypeId, typeId));
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LEAVE APPLICATIONS ───────────────────────────────────────────────────────

router.get("/leave/applications", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, status, fromDate, toDate, departmentId, leaveTypeId } = req.query as {
      employeeId?: string; status?: string; fromDate?: string; toDate?: string;
      departmentId?: string; leaveTypeId?: string;
    };

    const conds: SQL[] = [];

    // Role-based scoping
    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.json([]); return; }
      conds.push(eq(leaveApplicationsTable.employeeId, emp.id));
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      if (!hodEmp?.departmentId) { res.json([]); return; }
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
      conds.push(sql`${leaveApplicationsTable.employeeId} = ANY(${sql`ARRAY[${sql.join(deptEmps.map(e => sql`${e.id}`), sql`, `)}]`})`);
    } else if (employeeId) {
      conds.push(eq(leaveApplicationsTable.employeeId, Number(employeeId)));
    }

    if (status && LEAVE_STATUSES.includes(status as LeaveStatusValue)) {
      conds.push(eq(leaveApplicationsTable.status, status as LeaveStatusValue));
    }
    if (fromDate) conds.push(gte(leaveApplicationsTable.fromDate, fromDate));
    if (toDate) conds.push(lte(leaveApplicationsTable.toDate, toDate));
    if (leaveTypeId) conds.push(eq(leaveApplicationsTable.leaveTypeId, Number(leaveTypeId)));

    const apps = await db
      .select({
        id: leaveApplicationsTable.id,
        employeeId: leaveApplicationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        departmentName: departmentsTable.name,
        leaveTypeId: leaveApplicationsTable.leaveTypeId,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        fromDate: leaveApplicationsTable.fromDate,
        toDate: leaveApplicationsTable.toDate,
        totalDays: leaveApplicationsTable.totalDays,
        isHalfDay: leaveApplicationsTable.isHalfDay,
        halfDaySession: leaveApplicationsTable.halfDaySession,
        reason: leaveApplicationsTable.reason,
        documentUrl: leaveApplicationsTable.documentUrl,
        status: leaveApplicationsTable.status,
        isLop: leaveApplicationsTable.isLop,
        lopConfirmed: leaveApplicationsTable.lopConfirmed,
        hodActionedById: leaveApplicationsTable.hodActionedById,
        hodRemarks: leaveApplicationsTable.hodRemarks,
        hodActionedAt: leaveApplicationsTable.hodActionedAt,
        hrActionedById: leaveApplicationsTable.hrActionedById,
        hrRemarks: leaveApplicationsTable.hrRemarks,
        hrActionedAt: leaveApplicationsTable.hrActionedAt,
        cancelledById: leaveApplicationsTable.cancelledById,
        cancellationReason: leaveApplicationsTable.cancellationReason,
        cancelledAt: leaveApplicationsTable.cancelledAt,
        createdAt: leaveApplicationsTable.createdAt,
        updatedAt: leaveApplicationsTable.updatedAt,
      })
      .from(leaveApplicationsTable)
      .innerJoin(employeesTable, eq(leaveApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .innerJoin(leaveTypesTable, eq(leaveApplicationsTable.leaveTypeId, leaveTypesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(leaveApplicationsTable.createdAt));

    let filtered = apps;
    if (departmentId) {
      const deptId = Number(departmentId);
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, deptId), isNull(employeesTable.deletedAt)));
      const empIds = new Set(deptEmps.map(e => e.id));
      filtered = apps.filter(a => empIds.has(a.employeeId));
    }

    res.json(filtered);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/leave/applications/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [app] = await db
      .select({
        id: leaveApplicationsTable.id,
        employeeId: leaveApplicationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        departmentName: departmentsTable.name,
        leaveTypeId: leaveApplicationsTable.leaveTypeId,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        fromDate: leaveApplicationsTable.fromDate,
        toDate: leaveApplicationsTable.toDate,
        totalDays: leaveApplicationsTable.totalDays,
        isHalfDay: leaveApplicationsTable.isHalfDay,
        halfDaySession: leaveApplicationsTable.halfDaySession,
        reason: leaveApplicationsTable.reason,
        documentUrl: leaveApplicationsTable.documentUrl,
        status: leaveApplicationsTable.status,
        isLop: leaveApplicationsTable.isLop,
        lopConfirmed: leaveApplicationsTable.lopConfirmed,
        hodActionedById: leaveApplicationsTable.hodActionedById,
        hodRemarks: leaveApplicationsTable.hodRemarks,
        hodActionedAt: leaveApplicationsTable.hodActionedAt,
        hrActionedById: leaveApplicationsTable.hrActionedById,
        hrRemarks: leaveApplicationsTable.hrRemarks,
        hrActionedAt: leaveApplicationsTable.hrActionedAt,
        cancelledById: leaveApplicationsTable.cancelledById,
        cancellationReason: leaveApplicationsTable.cancellationReason,
        cancelledAt: leaveApplicationsTable.cancelledAt,
        createdAt: leaveApplicationsTable.createdAt,
        updatedAt: leaveApplicationsTable.updatedAt,
      })
      .from(leaveApplicationsTable)
      .innerJoin(employeesTable, eq(leaveApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .innerJoin(leaveTypesTable, eq(leaveApplicationsTable.leaveTypeId, leaveTypesTable.id))
      .where(eq(leaveApplicationsTable.id, Number(req.params.id)));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }

    // Scope check: employee can only read own; HOD can only read dept employees'
    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp || emp.id !== app.employeeId) { res.status(403).json({ error: "Forbidden" }); return; }
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, app.employeeId));
      if (!hodEmp?.departmentId || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }
    // payroll_admin, hr_*, super_admin: unrestricted read

    res.json(app);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// HR edits an approved leave application's date range. Diffs the old vs new
// range and: reverts the auto "On Leave" rows for days dropped from the range,
// applies "On Leave" to days added, and adjusts the leave balance by the delta.
// Days that already have HR-overridden attendance or non-auto notes are left
// untouched (handled inside the sync helpers).
router.put("/leave/applications/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const appId = Number(req.params.id);
    const { fromDate, toDate, isHalfDay, halfDaySession, reason } = req.body as {
      fromDate?: string; toDate?: string; isHalfDay?: boolean;
      halfDaySession?: string | null; reason?: string;
    };
    if (!fromDate || !toDate) {
      res.status(400).json({ error: "fromDate and toDate are required" });
      return;
    }
    if (new Date(toDate) < new Date(fromDate)) {
      res.status(400).json({ error: "toDate must be on or after fromDate" });
      return;
    }

    const [app] = await db.select().from(leaveApplicationsTable).where(eq(leaveApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }
    if (app.status !== "Approved") {
      res.status(422).json({ error: "Only approved leave applications can be edited" });
      return;
    }

    const oldFrom = app.fromDate as string;
    const oldTo = app.toDate as string;
    const oldIsHalfDay = app.isHalfDay as boolean;
    const newIsHalfDay = isHalfDay ?? oldIsHalfDay;

    // Block half-day toggles on multi-day ranges (mirrors submit-leave logic).
    if (newIsHalfDay && fromDate !== toDate) {
      res.status(400).json({ error: "Half-day leave must have fromDate === toDate" });
      return;
    }

    const oldTotalDays = parseFloat(app.totalDays as string);
    const newTotalDays = computeWorkingDays(fromDate, toDate, newIsHalfDay);
    const delta = newTotalDays - oldTotalDays;

    // Diff date ranges to know which days to revert vs apply.
    const oldDays = new Set(listDatesInRange(oldFrom, oldTo));
    const newDays = new Set(listDatesInRange(fromDate, toDate));
    const removedDays = [...oldDays].filter((d) => !newDays.has(d));
    const addedDays = [...newDays].filter((d) => !oldDays.has(d));
    // Symmetric diff: only days that actually change need lock-checked.
    const changedDays = [...removedDays, ...addedDays];

    // Reject edits that change year (either endpoint), since balance ledgers
    // are per-year. HR should cancel + re-apply for cross-year changes.
    const oldYear = new Date(oldFrom).getFullYear();
    if (
      new Date(fromDate).getFullYear() !== oldYear ||
      new Date(toDate).getFullYear() !== oldYear
    ) {
      res.status(400).json({ error: "Editing the leave year is not supported; cancel and re-apply instead" });
      return;
    }

    // Payroll-lock guard: every (year, month) touched by the symmetric diff
    // must be unlocked. Iterating over the actual changed days catches
    // intermediate months that bare endpoint comparison would miss.
    const touchedMonths = new Set<string>();
    for (const d of changedDays) {
      const dt = new Date(d);
      touchedMonths.add(`${dt.getFullYear()}-${dt.getMonth() + 1}`);
    }
    for (const ym of touchedMonths) {
      const [y, m] = ym.split("-").map(Number);
      const lockErr = await checkPayrollLock(req.hrmsUser!.id, "edit_attendance", y, m, req.hrmsUser?.email ?? undefined);
      if (lockErr) {
        res.status(422).json({ error: `Payroll for ${y}-${String(m).padStart(2, "0")} is locked; cannot edit leave dates that affect it` });
        return;
      }
    }

    // Overlap guard: the new range must not collide with any other active
    // leave application for the same employee (mirrors submit-leave logic).
    if (addedDays.length > 0) {
      const overlap = await db
        .select({ id: leaveApplicationsTable.id })
        .from(leaveApplicationsTable)
        .where(
          and(
            eq(leaveApplicationsTable.employeeId, app.employeeId),
            inArray(leaveApplicationsTable.status, ["Pending", "HOD Approved", "HR Approved", "Approved", "Cancel Requested"]),
            lte(leaveApplicationsTable.fromDate, toDate),
            gte(leaveApplicationsTable.toDate, fromDate),
          ),
        );
      const collision = overlap.find((o) => o.id !== appId);
      if (collision) {
        res.status(422).json({ error: `Edited range overlaps with leave application #${collision.id}` });
        return;
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(leaveApplicationsTable)
        .set({
          fromDate,
          toDate,
          isHalfDay: newIsHalfDay,
          halfDaySession: newIsHalfDay ? (halfDaySession ?? app.halfDaySession ?? "Forenoon") : null,
          reason: reason ?? app.reason,
          totalDays: String(newTotalDays),
          updatedAt: new Date(),
        })
        .where(eq(leaveApplicationsTable.id, appId))
        .returning();

      if (delta !== 0) {
        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(
            eq(leaveBalancesTable.employeeId, app.employeeId),
            eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId),
            eq(leaveBalancesTable.year, oldYear),
          ),
        );
        if (bal) {
          // Floor at 0 so a downward delta on inconsistent historical data
          // can never push `used` negative (corrupting the ledger).
          await tx.update(leaveBalancesTable)
            .set({ used: sql`GREATEST(0, ${leaveBalancesTable.used} + ${delta})`, updatedAt: new Date() })
            .where(eq(leaveBalancesTable.id, bal.id));
        }
      }

      // Revert dropped days, then apply the new full range (idempotent for
      // days already correctly marked).
      await revertLeaveDaysFromAttendance(tx, app.id, app.employeeId, removedDays);
      await applyLeaveToAttendance(tx, app.id, app.employeeId, fromDate, toDate);

      return row;
    });

    await logAudit({
      user: req.hrmsUser,
      action: "EDIT_LEAVE_DATES",
      module: "Leave",
      recordId: appId,
      previousValue: `${oldFrom}~${oldTo} (${oldTotalDays}d)`,
      newValue: `${fromDate}~${toDate} (${newTotalDays}d)`,
      ipAddress: req.ip,
    });

    // Notify the applicant + the approver chain (HOD + HR) that recorded the
    // original approval. Variables include before/after dates so recipients
    // can see exactly what changed.
    try {
      const [leaveTypeRow] = await db.select({ name: leaveTypesTable.name })
        .from(leaveTypesTable).where(eq(leaveTypesTable.id, app.leaveTypeId));
      const recipientUserIds = new Set<number>();
      const [empUser] = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name })
        .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, app.employeeId));
      if (app.hodActionedById) recipientUserIds.add(app.hodActionedById);
      if (app.hrActionedById) recipientUserIds.add(app.hrActionedById);
      const approvers = recipientUserIds.size > 0
        ? await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
            .from(hrmsUsersTable).where(inArray(hrmsUsersTable.id, [...recipientUserIds]))
        : [];
      const sharedVars = {
        leaveType: leaveTypeRow?.name ?? "leave",
        oldFromDate: String(oldFrom), oldToDate: String(oldTo), oldDays: String(oldTotalDays),
        newFromDate: String(fromDate), newToDate: String(toDate), newDays: String(newTotalDays),
        editedBy: req.hrmsUser?.name ?? req.hrmsUser?.email ?? "HR",
        editReason: reason ?? "",
      };
      if (empUser?.email) {
        dispatchNotification({
          eventType: "leave_dates_edited", module: "leave",
          recipientEmail: empUser.email, recipientName: empUser.name ?? undefined,
          recipientEmployeeDbId: app.employeeId,
          variables: { ...sharedVars, recipientName: empUser.name ?? "Team Member" },
          entityType: "leave_application", entityId: appId,
        }).catch(() => {});
      }
      for (const ap of approvers) {
        if (!ap.email) continue;
        dispatchNotification({
          eventType: "leave_dates_edited", module: "leave",
          recipientEmail: ap.email, recipientName: ap.name ?? undefined,
          recipientEmployeeDbId: ap.employeeId ?? null,
          variables: { ...sharedVars, recipientName: ap.name ?? "Team Member" },
          entityType: "leave_application", entityId: appId,
        }).catch(() => {});
      }
    } catch (e) { console.error("[leave] edit-dates notification dispatch failed:", e); }

    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// One-time backfill: walk every Approved leave application and run the same
// attendance sync used by the live approval path. Idempotent — re-running it
// is safe because applyLeaveToAttendance only upgrades "Absent" /
// "Regularization Pending" rows and inserts missing days; HR-overridden rows
// and other statuses are left untouched. Restricted to super_admin.
// Stable lock key for the backfill operation (chosen arbitrarily; just needs
// to be unique across the application's advisory-lock namespace).
const BACKFILL_LOCK_KEY = 729103948;

router.post("/leave/backfill-attendance", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const { dryRun } = req.body as { dryRun?: boolean } ?? {};

    // Serialize concurrent backfill runs with a transaction-scoped advisory
    // lock. pg_try_advisory_xact_lock binds the lock to the current
    // transaction so it is guaranteed released on commit/rollback even with
    // a pooled connection (no risk of leaking the lock across pg clients).
    let lockBusy = false;
    const summary = await db.transaction(async (tx) => {
      const lockRes = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${BACKFILL_LOCK_KEY}) AS locked`,
      );
      if (!lockRes.rows[0]?.locked) { lockBusy = true; return null; }
      return await runBackfillTx(tx, dryRun ?? false);
    });
    if (lockBusy || !summary) {
      res.status(409).json({ error: "A backfill run is already in progress" });
      return;
    }

    await logAudit({
      user: req.hrmsUser,
      action: dryRun ? "BACKFILL_LEAVE_ATTENDANCE_DRYRUN" : "BACKFILL_LEAVE_ATTENDANCE",
      module: "Leave",
      newValue: `apps=${summary.applicationsProcessed} inserted=${summary.rowsInserted} updated=${summary.rowsUpdated} failed=${summary.failures.length}`,
      ipAddress: req.ip,
    });

    res.json(summary);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

type BackfillTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function runBackfillTx(tx: BackfillTx, dryRun: boolean) {
  const approved = await tx
    .select({
      id: leaveApplicationsTable.id,
      employeeId: leaveApplicationsTable.employeeId,
      fromDate: leaveApplicationsTable.fromDate,
      toDate: leaveApplicationsTable.toDate,
    })
    .from(leaveApplicationsTable)
    .where(eq(leaveApplicationsTable.status, "Approved"));

  let totalInserted = 0;
  let totalUpdated = 0;
  const failures: { id: number; error: string }[] = [];

  for (const app of approved) {
    try {
      if (dryRun) continue;
      // Per-app savepoint so a single bad application aborts only its own
      // changes, not the entire backfill batch.
      const counts = await tx.transaction(async (sp) =>
        applyLeaveToAttendance(
          sp,
          app.id,
          app.employeeId,
          app.fromDate as string,
          app.toDate as string,
        ),
      );
      totalInserted += counts.inserted;
      totalUpdated += counts.updated;
    } catch (e) {
      failures.push({ id: app.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    applicationsProcessed: approved.length,
    rowsInserted: totalInserted,
    rowsUpdated: totalUpdated,
    failures,
    dryRun,
  };
}

router.post("/leave/applications", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { leaveTypeId, fromDate, toDate, isHalfDay, halfDaySession, reason, documentUrl, lopConfirmed } = req.body as {
      leaveTypeId: number; fromDate: string; toDate: string; isHalfDay?: boolean;
      halfDaySession?: string; reason?: string; documentUrl?: string; lopConfirmed?: boolean;
    };

    // Resolve employee — must have a linked employee profile; no fallback allowed
    const emp = await getEmployeeForUser(req.hrmsUser.id);
    if (!emp) { res.status(422).json({ error: "No employee profile linked to your account. Cannot submit leave." }); return; }
    const employeeId = emp.id;

    const [leaveType] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, leaveTypeId));
    if (!leaveType || !leaveType.isActive) { res.status(422).json({ error: "Invalid or inactive leave type" }); return; }

    // Check advance notice
    if (leaveType.advanceNoticeDays > 0) {
      const today = new Date();
      const from = new Date(fromDate);
      const diffDays = Math.floor((from.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.advanceNoticeDays) {
        res.status(422).json({ error: `This leave type requires ${leaveType.advanceNoticeDays} day(s) advance notice` });
        return;
      }
    }

    // Check blackout dates
    const blackouts = await db.select().from(blackoutDatesTable).where(
      or(
        isNull(blackoutDatesTable.departmentId),
        emp?.departmentId ? eq(blackoutDatesTable.departmentId, emp.departmentId) : isNull(blackoutDatesTable.departmentId),
      )
    );
    for (const bo of blackouts) {
      const boFrom = new Date(bo.fromDate as string);
      const boTo = new Date(bo.toDate as string);
      const reqFrom = new Date(fromDate);
      const reqTo = new Date(toDate);
      if (reqFrom <= boTo && reqTo >= boFrom) {
        res.status(422).json({ error: `Leave dates overlap with blackout period: ${bo.name}` });
        return;
      }
    }

    // ── Policy enforcement ──────────────────────────────────────────────────────
    // Half-day eligibility
    if (isHalfDay && !leaveType.allowHalfDay) {
      res.status(422).json({ error: "This leave type does not allow half-day requests" }); return;
    }

    // Employment type applicability
    if (leaveType.applicableEmploymentTypes && leaveType.applicableEmploymentTypes.length > 0 && emp.employmentType) {
      if (!leaveType.applicableEmploymentTypes.includes(emp.employmentType)) {
        res.status(422).json({ error: `This leave type is not applicable for your employment type (${emp.employmentType})` }); return;
      }
    }

    // Compute total days for min/max checks
    const totalDaysForPolicy = computeWorkingDays(fromDate, toDate, isHalfDay ?? false);

    // Min consecutive days
    const minDays = leaveType.minConsecutiveDays ? parseFloat(leaveType.minConsecutiveDays as string) : 0.5;
    if (totalDaysForPolicy < minDays) {
      res.status(422).json({ error: `This leave type requires a minimum of ${minDays} day(s) per request` }); return;
    }

    // Max consecutive days
    if (leaveType.maxConsecutiveDays) {
      const maxDays = parseFloat(leaveType.maxConsecutiveDays as string);
      if (totalDaysForPolicy > maxDays) {
        res.status(422).json({ error: `This leave type allows a maximum of ${maxDays} consecutive day(s) per request` }); return;
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Check overlapping applications
    const overlapping = await db.select().from(leaveApplicationsTable).where(
      and(
        eq(leaveApplicationsTable.employeeId, employeeId),
        sql`${leaveApplicationsTable.status} NOT IN ('Rejected', 'Cancelled')`,
        lte(leaveApplicationsTable.fromDate, toDate),
        gte(leaveApplicationsTable.toDate, fromDate),
      )
    );
    if (overlapping.length > 0) {
      res.status(422).json({ error: "You already have a leave application overlapping these dates" });
      return;
    }

    const totalDays = computeWorkingDays(fromDate, toDate, isHalfDay ?? false);
    const year = new Date(fromDate).getFullYear();

    // Check balance
    const balance = await getOrCreateBalance(employeeId, leaveTypeId, year, leaveType.annualQuota);
    const available = parseFloat(balance.allocated as string) + parseFloat(balance.carryForward as string) - parseFloat(balance.used as string) - parseFloat(balance.pending as string);
    const isLop = available < totalDays;

    if (isLop && !lopConfirmed && !leaveType.lopByDefault) {
      res.status(422).json({ error: "Insufficient leave balance. Submit with lopConfirmed=true to proceed as Loss of Pay.", isLopWarning: true, available, requested: totalDays });
      return;
    }

    // Determine initial status
    let initialStatus: "Pending" = "Pending";

    const [app] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(leaveApplicationsTable).values({
        employeeId,
        leaveTypeId,
        fromDate,
        toDate,
        totalDays: String(totalDays),
        isHalfDay: isHalfDay ?? false,
        halfDaySession: halfDaySession,
        reason: reason ?? "",
        documentUrl,
        status: initialStatus,
        isLop,
        lopConfirmed: lopConfirmed ?? false,
      }).returning();
      // Debit from pending balance
      await tx.update(leaveBalancesTable)
        .set({ pending: sql`${leaveBalancesTable.pending} + ${totalDays}`, updatedAt: new Date() })
        .where(eq(leaveBalancesTable.id, balance.id));
      return [created];
    });

    await logAudit({ user: req.hrmsUser, action: "SUBMIT_LEAVE", module: "Leave", recordId: app.id, newValue: `${leaveType.code} ${fromDate}~${toDate}`, ipAddress: req.ip });
    // Notify HOD/HR about new leave application
    const empInfo = await db.select({ name: employeesTable.firstName, lastName: employeesTable.lastName })
      .from(employeesTable).where(eq(employeesTable.id, app.employeeId)).then(r => r[0]);
    const [hodUser] = await db.select({ email: hrmsUsersTable.email }).from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.role, "hod")).limit(1);
    if (hodUser?.email) {
      dispatchNotification({
        eventType: "leave_submitted", module: "leave",
        recipientEmail: hodUser.email,
        variables: {
          employeeName: empInfo ? `${empInfo.name} ${empInfo.lastName}` : "An employee",
          fromDate: String(fromDate), toDate: String(toDate),
          days: String(totalDays), leaveType: leaveType.name,
        },
        entityType: "leave_application", entityId: app.id,
      }).catch(() => {});
    }
    res.status(201).json(app);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/applications/:id/hod-action", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const appId = Number(req.params.id);

    const [app] = await db.select().from(leaveApplicationsTable).where(eq(leaveApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }
    if (app.status !== "Pending") { res.status(422).json({ error: "Application is not in Pending state" }); return; }

    // Check leave type requires HOD approval
    const [leaveType] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, app.leaveTypeId));
    if (!leaveType?.requiresHodApproval && req.hrmsUser.role === "hod") {
      res.status(403).json({ error: "This leave type does not require HOD approval" }); return;
    }

    // HOD scope check
    if (req.hrmsUser.role === "hod" && req.hrmsUser.employeeId) {
      const [hodEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, req.hrmsUser.employeeId));
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, app.employeeId));
      if (hodEmp?.departmentId == null || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only action leave requests from employees in your department" });
        return;
      }
    }
    const year = new Date(app.fromDate as string).getFullYear();
    const totalDays = parseFloat(app.totalDays as string);

    const updated = await db.transaction(async (tx) => {
      let newStatus: typeof app.status;
      if (action === "Approved") {
        newStatus = leaveType?.requiresHrApproval ? "HOD Approved" : "Approved";
      } else {
        newStatus = "Rejected";
      }
      const [row] = await tx.update(leaveApplicationsTable)
        .set({ status: newStatus, hodActionedById: req.hrmsUser!.id, hodRemarks: remarks ?? null, hodActionedAt: new Date(), updatedAt: new Date() })
        .where(eq(leaveApplicationsTable.id, appId))
        .returning();

      if (action === "Approved" && newStatus === "Approved") {
        // No HR approval needed — finalize balance
        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
        );
        if (bal) {
          await tx.update(leaveBalancesTable)
            .set({ used: sql`${leaveBalancesTable.used} + ${totalDays}`, pending: sql`${leaveBalancesTable.pending} - ${totalDays}`, updatedAt: new Date() })
            .where(eq(leaveBalancesTable.id, bal.id));
        }
        await applyLeaveToAttendance(tx, app.id, app.employeeId, app.fromDate as string, app.toDate as string);
      } else if (action === "Rejected") {
        // Restore pending balance
        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
        );
        if (bal) {
          await tx.update(leaveBalancesTable)
            .set({ pending: sql`${leaveBalancesTable.pending} - ${totalDays}`, updatedAt: new Date() })
            .where(eq(leaveBalancesTable.id, bal.id));
        }
      }
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: `HOD_${action.toUpperCase()}_LEAVE`, module: "Leave", recordId: appId, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/applications/:id/hr-action", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const appId = Number(req.params.id);

    const [app] = await db.select().from(leaveApplicationsTable).where(eq(leaveApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }

    // Enforce HOD approval sequence:
    // - "HOD Approved" is always valid (handles both required and skip-HOD cases)
    // - "Pending" is valid only if the leave type does NOT require HOD approval
    const [leaveTypeForCheck] = await db.select({ requiresHodApproval: leaveTypesTable.requiresHodApproval })
      .from(leaveTypesTable).where(eq(leaveTypesTable.id, app.leaveTypeId));
    const requiresHod = leaveTypeForCheck?.requiresHodApproval ?? true;
    const validPrecondition = app.status === "HOD Approved" || (!requiresHod && app.status === "Pending");
    if (!validPrecondition) {
      res.status(422).json({
        error: requiresHod
          ? "Application must be HOD Approved before HR can action it"
          : "Application must be in Pending or HOD Approved state"
      });
      return;
    }

    const year = new Date(app.fromDate as string).getFullYear();
    const totalDays = parseFloat(app.totalDays as string);

    const updated = await db.transaction(async (tx) => {
      const newStatus = action === "Approved" ? "Approved" : "Rejected";
      const [row] = await tx.update(leaveApplicationsTable)
        .set({ status: newStatus, hrActionedById: req.hrmsUser!.id, hrRemarks: remarks ?? null, hrActionedAt: new Date(), updatedAt: new Date() })
        .where(eq(leaveApplicationsTable.id, appId))
        .returning();

      const [bal] = await tx.select().from(leaveBalancesTable).where(
        and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
      );
      if (bal) {
        if (action === "Approved") {
          await tx.update(leaveBalancesTable)
            .set({ used: sql`${leaveBalancesTable.used} + ${totalDays}`, pending: sql`${leaveBalancesTable.pending} - ${totalDays}`, updatedAt: new Date() })
            .where(eq(leaveBalancesTable.id, bal.id));
        } else {
          await tx.update(leaveBalancesTable)
            .set({ pending: sql`${leaveBalancesTable.pending} - ${totalDays}`, updatedAt: new Date() })
            .where(eq(leaveBalancesTable.id, bal.id));
        }
      }
      if (action === "Approved") {
        await applyLeaveToAttendance(tx, app.id, app.employeeId, app.fromDate as string, app.toDate as string);
      }
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: `HR_${action.toUpperCase()}_LEAVE`, module: "Leave", recordId: appId, newValue: action, ipAddress: req.ip });
    // Notify employee about leave decision
    const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
      .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, app.employeeId));
    if (empUser?.email) {
      dispatchNotification({
        eventType: action === "Approved" ? "leave_approved" : "leave_rejected",
        module: "leave",
        recipientEmail: empUser.email,
        recipientName: empUser.name ?? undefined,
        recipientEmployeeDbId: app.employeeId,
        variables: {
          fromDate: String(app.fromDate), toDate: String(app.toDate),
          leaveType: String(app.leaveTypeId), reason: remarks ?? "",
          recipientName: empUser.name ?? "Team Member",
        },
        entityType: "leave_application", entityId: appId,
      }).catch(() => {});
    }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/applications/:id/cancel", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    const appId = Number(req.params.id);

    const [app] = await db.select().from(leaveApplicationsTable).where(eq(leaveApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }
    if (["Rejected", "Cancelled", "Cancel Requested"].includes(app.status)) {
      res.status(422).json({ error: "Application is already cancelled, rejected, or has a pending cancel request" });
      return;
    }

    const isHrRole = ["super_admin", "hr_manager", "hr_executive"].includes(req.hrmsUser.role);

    // Ownership / scope check for non-HR roles
    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp || emp.id !== app.employeeId) { res.status(403).json({ error: "You can only cancel your own leave applications" }); return; }
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, app.employeeId));
      if (!hodEmp?.departmentId || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only cancel leave applications from employees in your department" }); return;
      }
    } else if (req.hrmsUser.role === "payroll_admin") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp || emp.id !== app.employeeId) { res.status(403).json({ error: "Payroll admin can only cancel their own leave" }); return; }
    }
    // hr_manager, hr_executive, super_admin: unrestricted

    const totalDays = parseFloat(app.totalDays as string);
    const year = new Date(app.fromDate as string).getFullYear();

    // HR: direct immediate cancel. Non-HR: pending leave can be cancelled immediately;
    // approved/HOD-approved leave needs HOD/HR approval ("Cancel Requested")
    const needsApproval = !isHrRole && ["Approved", "HOD Approved"].includes(app.status);

    const updated = await db.transaction(async (tx) => {
      if (needsApproval) {
        // Move to "Cancel Requested" — balance stays as-is until approval
        const [row] = await tx.update(leaveApplicationsTable)
          .set({
            status: "Cancel Requested",
            cancelledById: req.hrmsUser!.id,
            cancellationReason: reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(leaveApplicationsTable.id, appId))
          .returning();
        return row;
      } else {
        // Immediate cancel (HR or Pending status)
        const [row] = await tx.update(leaveApplicationsTable)
          .set({ status: "Cancelled", cancelledById: req.hrmsUser!.id, cancellationReason: reason ?? null, cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(leaveApplicationsTable.id, appId))
          .returning();

        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
        );
        if (bal) {
          if (app.status === "Approved") {
            await tx.update(leaveBalancesTable)
              .set({ used: sql`GREATEST(0, ${leaveBalancesTable.used} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          } else {
            await tx.update(leaveBalancesTable)
              .set({ pending: sql`GREATEST(0, ${leaveBalancesTable.pending} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          }
        }
        if (app.status === "Approved") {
          await revertLeaveFromAttendance(tx, app.id, app.employeeId, app.fromDate as string, app.toDate as string);
        }
        return row;
      }
    });

    const auditAction = needsApproval ? "REQUEST_CANCEL_LEAVE" : "CANCEL_LEAVE";
    await logAudit({ user: req.hrmsUser, action: auditAction, module: "Leave", recordId: appId, newValue: updated.status, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// HOD/HR approves or rejects a "Cancel Requested" leave application
router.post("/leave/applications/:id/cancel-action", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const appId = Number(req.params.id);

    const [app] = await db.select().from(leaveApplicationsTable).where(eq(leaveApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "Not found" }); return; }
    if (app.status !== "Cancel Requested") { res.status(422).json({ error: "Application is not in Cancel Requested state" }); return; }

    // HOD scope check
    if (req.hrmsUser.role === "hod" && req.hrmsUser.employeeId) {
      const [hodEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, req.hrmsUser.employeeId));
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, app.employeeId));
      if (hodEmp?.departmentId == null || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only action cancel requests from employees in your department" }); return;
      }
    }

    const totalDays = parseFloat(app.totalDays as string);
    const year = new Date(app.fromDate as string).getFullYear();

    const updated = await db.transaction(async (tx) => {
      if (action === "Approved") {
        const [row] = await tx.update(leaveApplicationsTable)
          .set({ status: "Cancelled", cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(leaveApplicationsTable.id, appId))
          .returning();
        // Restore balance: determine which bucket holds the days
        // - balance moves to `used` only when HR fully approves, OR when HOD approves
        //   directly to "Approved" (requiresHrApproval=false).
        // - "HOD Approved" (waiting for HR) still has balance in `pending`.
        const [lt] = await tx.select({ requiresHrApproval: leaveTypesTable.requiresHrApproval })
          .from(leaveTypesTable).where(eq(leaveTypesTable.id, app.leaveTypeId));
        const balanceInUsed =
          !!app.hrActionedAt ||                                    // HR granted final approval
          (!!app.hodActionedAt && lt?.requiresHrApproval === false); // HOD-only path → "Approved"

        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
        );
        if (bal) {
          if (balanceInUsed) {
            await tx.update(leaveBalancesTable)
              .set({ used: sql`GREATEST(0, ${leaveBalancesTable.used} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          } else {
            await tx.update(leaveBalancesTable)
              .set({ pending: sql`GREATEST(0, ${leaveBalancesTable.pending} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          }
        }
        // If the leave was previously fully approved, the auto-attendance entries
        // have already been written — revert them now that the cancel is approved.
        if (balanceInUsed) {
          await revertLeaveFromAttendance(tx, app.id, app.employeeId, app.fromDate as string, app.toDate as string);
        }
        return row;
      } else {
        // Rejected: restore to previous state
        // Infer previous status from approval timestamps
        let restoreStatus: LeaveStatusValue;
        if (app.hrActionedAt) {
          restoreStatus = "Approved";
        } else if (app.hodActionedAt) {
          restoreStatus = "HOD Approved";
        } else {
          restoreStatus = "Pending";
        }
        const [row] = await tx.update(leaveApplicationsTable)
          .set({ status: restoreStatus, cancelledById: null, cancellationReason: remarks ? `Cancel rejected: ${remarks}` : "Cancel request rejected", cancelledAt: null, updatedAt: new Date() })
          .where(eq(leaveApplicationsTable.id, appId))
          .returning();
        return row;
      }
    });

    await logAudit({ user: req.hrmsUser, action: `${action.toUpperCase()}_CANCEL_LEAVE`, module: "Leave", recordId: appId, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LEAVE BALANCES ───────────────────────────────────────────────────────────

router.get("/leave/balances", requireHrmsUser, requireRole(...HR_READ_ROLES, "employee"), async (req, res) => {
  try {
    let { employeeId, year } = req.query as { employeeId?: string; year?: string };
    const targetYear = year ? Number(year) : new Date().getFullYear();
    const conds: SQL[] = [];
    if (year) conds.push(eq(leaveBalancesTable.year, targetYear));

    if (req.hrmsUser.role === "employee") {
      // Always scope employees to the resolved year so lazy-init below
      // matches what we return.
      if (!year) conds.push(eq(leaveBalancesTable.year, targetYear));
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.json([]); return; }
      // Lazy-init: ensure this employee has a balance row for every applicable
      // active leave type for the requested year so the ESS UI always shows
      // balance cards even before HR runs the bulk initializer.
      const activeTypes = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.isActive, true));
      for (const lt of activeTypes) {
        if (lt.applicableEmploymentTypes && lt.applicableEmploymentTypes.length > 0 && emp.employmentType) {
          if (!lt.applicableEmploymentTypes.includes(emp.employmentType)) continue;
        }
        await getOrCreateBalance(emp.id, lt.id, targetYear, lt.annualQuota);
      }
      conds.push(eq(leaveBalancesTable.employeeId, emp.id));
    } else if (req.hrmsUser.role === "hod") {
      // HOD may only see balances of employees in their department
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      if (!hodEmp?.departmentId) { res.json([]); return; }
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
      if (deptEmps.length === 0) { res.json([]); return; }
      const deptEmpIds = deptEmps.map(e => e.id);
      if (employeeId) {
        const empId = Number(employeeId);
        if (!deptEmpIds.includes(empId)) { res.status(403).json({ error: "Employee is not in your department" }); return; }
        conds.push(eq(leaveBalancesTable.employeeId, empId));
      } else {
        conds.push(inArray(leaveBalancesTable.employeeId, deptEmpIds));
      }
    } else if (employeeId) {
      conds.push(eq(leaveBalancesTable.employeeId, Number(employeeId)));
    }

    const balances = await db
      .select({
        id: leaveBalancesTable.id,
        employeeId: leaveBalancesTable.employeeId,
        leaveTypeId: leaveBalancesTable.leaveTypeId,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        year: leaveBalancesTable.year,
        allocated: leaveBalancesTable.allocated,
        used: leaveBalancesTable.used,
        pending: leaveBalancesTable.pending,
        carryForward: leaveBalancesTable.carryForward,
        available: sql<string>`(${leaveBalancesTable.allocated}::numeric + ${leaveBalancesTable.carryForward}::numeric - ${leaveBalancesTable.used}::numeric - ${leaveBalancesTable.pending}::numeric)::text`,
        createdAt: leaveBalancesTable.createdAt,
        updatedAt: leaveBalancesTable.updatedAt,
      })
      .from(leaveBalancesTable)
      .innerJoin(leaveTypesTable, eq(leaveBalancesTable.leaveTypeId, leaveTypesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(leaveTypesTable.name);

    res.json(balances);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/balances/initialize", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { year, employeeId } = req.body as { year: number; employeeId?: number };
    // Check lock for current month in the target year (initialization affects the year's allocations)
    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_leave_balance", year, new Date().getMonth() + 1);
    if (lockError) { res.status(422).json({ error: lockError }); return; }
    const leaveTypes = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.isActive, true));
    const emps = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(isNull(employeesTable.deletedAt), employeeId ? eq(employeesTable.id, employeeId) : undefined));

    let count = 0;
    for (const emp of emps) {
      for (const lt of leaveTypes) {
        const existing = await db.select({ id: leaveBalancesTable.id }).from(leaveBalancesTable)
          .where(and(eq(leaveBalancesTable.employeeId, emp.id), eq(leaveBalancesTable.leaveTypeId, lt.id), eq(leaveBalancesTable.year, year)));
        if (existing.length === 0) {
          await db.insert(leaveBalancesTable).values({
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
            allocated: lt.annualQuota,
            used: "0",
            pending: "0",
            carryForward: "0",
          });
          await db.insert(leaveAccrualHistoryTable).values({
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
            accrualType: "Annual Allocation",
            days: lt.annualQuota,
            notes: `Annual allocation for ${year}`,
            processedById: req.hrmsUser.id,
          });
          count++;
        }
      }
    }
    await logAudit({ user: req.hrmsUser, action: "INITIALIZE_LEAVE_BALANCES", module: "Leave", newValue: `Year ${year}, Count ${count}`, ipAddress: req.ip });
    res.json({ count });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/balances/carry-forward", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { year, employeeId } = req.body as { year: number; employeeId?: number };
    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: "Valid year is required" }); return;
    }

    // Lock check on both source and target year (current month boundary)
    const lockSrc = await checkPayrollLock(req.hrmsUser!.id, "edit_leave_balance", year, 12);
    if (lockSrc) { res.status(422).json({ error: lockSrc }); return; }
    const lockDst = await checkPayrollLock(req.hrmsUser!.id, "edit_leave_balance", year + 1, 1);
    if (lockDst) { res.status(422).json({ error: lockDst }); return; }

    const summary = await runCarryForwardForYear(year, {
      employeeId,
      processedById: req.hrmsUser!.id,
    });

    await logAudit({
      user: req.hrmsUser, action: "CARRY_FORWARD_LEAVE_BALANCES", module: "Leave",
      newValue: `${summary.fromYear}->${summary.toYear}: processed=${summary.processed}, carried=${summary.carriedForwardCount}, days=${summary.totalDaysCarried.toFixed(1)}`,
      ipAddress: req.ip,
    });
    res.json({
      processed: summary.processed,
      carriedForwardCount: summary.carriedForwardCount,
      totalDaysCarried: summary.totalDaysCarried.toFixed(1),
      fromYear: summary.fromYear,
      toYear: summary.toYear,
      message: `Processed ${summary.processed} balance(s); carried forward ${summary.totalDaysCarried.toFixed(1)} day(s) for ${summary.carriedForwardCount} record(s) from ${summary.fromYear} to ${summary.toYear}`,
    });
  } catch (err) {
    if (err instanceof CarryForwardLockedError) {
      res.status(409).json({ error: "A carry-forward run is already in progress. Please retry shortly." });
      return;
    }
    console.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/leave/accrual-history", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, year } = req.query as { employeeId?: string; year?: string };
    const yearNum = year ? Number(year) : undefined;
    if (year !== undefined && (!Number.isInteger(yearNum) || yearNum! < 2000 || yearNum! > 2100)) {
      res.status(400).json({ error: "Invalid year" }); return;
    }
    const requestedEmpId = employeeId !== undefined && employeeId !== "" ? Number(employeeId) : undefined;
    if (requestedEmpId !== undefined && !Number.isInteger(requestedEmpId)) {
      res.status(400).json({ error: "Invalid employeeId" }); return;
    }

    // Authz scoping — produce a definitive employeeId filter (or 403).
    let scopedEmpId: number | undefined;
    let scopedDeptEmpIds: number[] | undefined;
    if (req.hrmsUser!.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser!.id);
      if (!emp) { res.json([]); return; }
      if (requestedEmpId !== undefined && requestedEmpId !== emp.id) {
        res.status(403).json({ error: "Employees may only view their own accrual history" }); return;
      }
      scopedEmpId = emp.id;
    } else if (req.hrmsUser!.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser!.id);
      if (!hodEmp?.departmentId) { res.json([]); return; }
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
      const deptEmpIds = deptEmps.map(e => e.id);
      if (deptEmpIds.length === 0) { res.json([]); return; }
      if (requestedEmpId !== undefined) {
        if (!deptEmpIds.includes(requestedEmpId)) {
          res.status(403).json({ error: "Employee is not in your department" }); return;
        }
        scopedEmpId = requestedEmpId;
      } else {
        scopedDeptEmpIds = deptEmpIds;
      }
    } else {
      // HR roles — unrestricted; if no employeeId given, return across all.
      if (requestedEmpId !== undefined) scopedEmpId = requestedEmpId;
    }

    const conds = [] as ReturnType<typeof eq>[];
    if (scopedEmpId !== undefined) conds.push(eq(leaveAccrualHistoryTable.employeeId, scopedEmpId));
    else if (scopedDeptEmpIds) conds.push(inArray(leaveAccrualHistoryTable.employeeId, scopedDeptEmpIds));
    if (yearNum !== undefined) conds.push(eq(leaveAccrualHistoryTable.year, yearNum));

    const rows = await db
      .select({
        id: leaveAccrualHistoryTable.id,
        employeeId: leaveAccrualHistoryTable.employeeId,
        leaveTypeId: leaveAccrualHistoryTable.leaveTypeId,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        year: leaveAccrualHistoryTable.year,
        month: leaveAccrualHistoryTable.month,
        accrualType: leaveAccrualHistoryTable.accrualType,
        days: leaveAccrualHistoryTable.days,
        notes: leaveAccrualHistoryTable.notes,
        processedById: leaveAccrualHistoryTable.processedById,
        processedByName: hrmsUsersTable.name,
        createdAt: leaveAccrualHistoryTable.createdAt,
      })
      .from(leaveAccrualHistoryTable)
      .innerJoin(leaveTypesTable, eq(leaveAccrualHistoryTable.leaveTypeId, leaveTypesTable.id))
      .leftJoin(hrmsUsersTable, eq(leaveAccrualHistoryTable.processedById, hrmsUsersTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(leaveAccrualHistoryTable.createdAt));

    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/leave/usage-trend", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, years } = req.query as { employeeId?: string; years?: string };
    const yearsBack = Math.min(Math.max(Number(years ?? 3) || 3, 1), 10);
    const requestedEmpId = employeeId !== undefined && employeeId !== "" ? Number(employeeId) : undefined;
    if (requestedEmpId !== undefined && !Number.isInteger(requestedEmpId)) {
      res.status(400).json({ error: "Invalid employeeId" }); return;
    }

    // Authz: same scoping as /leave/accrual-history.
    let scopedEmpId: number | undefined;
    if (req.hrmsUser!.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser!.id);
      if (!emp) { res.json({ years: [], byLeaveType: [] }); return; }
      if (requestedEmpId !== undefined && requestedEmpId !== emp.id) {
        res.status(403).json({ error: "Employees may only view their own usage trend" }); return;
      }
      scopedEmpId = emp.id;
    } else if (req.hrmsUser!.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser!.id);
      if (!hodEmp?.departmentId) { res.json({ years: [], byLeaveType: [] }); return; }
      if (requestedEmpId === undefined) {
        res.status(400).json({ error: "employeeId is required for HOD" }); return;
      }
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId })
        .from(employeesTable).where(eq(employeesTable.id, requestedEmpId));
      if (!reqEmp || reqEmp.departmentId !== hodEmp.departmentId) {
        res.status(403).json({ error: "Employee is not in your department" }); return;
      }
      scopedEmpId = requestedEmpId;
    } else {
      // HR roles must specify employeeId for a per-person trend.
      if (requestedEmpId === undefined) {
        res.status(400).json({ error: "employeeId is required" }); return;
      }
      scopedEmpId = requestedEmpId;
    }

    const currentYear = new Date().getFullYear();
    const fromYear = currentYear - yearsBack + 1;

    const rows = await db
      .select({
        year: leaveBalancesTable.year,
        leaveTypeId: leaveBalancesTable.leaveTypeId,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        used: leaveBalancesTable.used,
      })
      .from(leaveBalancesTable)
      .innerJoin(leaveTypesTable, eq(leaveBalancesTable.leaveTypeId, leaveTypesTable.id))
      .where(and(
        eq(leaveBalancesTable.employeeId, scopedEmpId!),
        gte(leaveBalancesTable.year, fromYear),
        lte(leaveBalancesTable.year, currentYear),
      ))
      .orderBy(leaveBalancesTable.year, leaveTypesTable.name);

    const yearList: number[] = [];
    for (let y = fromYear; y <= currentYear; y++) yearList.push(y);

    // Pivot: one row per leave type with usage per year.
    const typeMap = new Map<number, { leaveTypeId: number; leaveTypeName: string; leaveTypeCode: string; usageByYear: Record<string, number> }>();
    for (const r of rows) {
      let bucket = typeMap.get(r.leaveTypeId);
      if (!bucket) {
        bucket = {
          leaveTypeId: r.leaveTypeId,
          leaveTypeName: r.leaveTypeName ?? r.leaveTypeCode ?? `Type ${r.leaveTypeId}`,
          leaveTypeCode: r.leaveTypeCode ?? "",
          usageByYear: {},
        };
        for (const y of yearList) bucket.usageByYear[String(y)] = 0;
        typeMap.set(r.leaveTypeId, bucket);
      }
      bucket.usageByYear[String(r.year)] = parseFloat(r.used as string);
    }

    res.json({ years: yearList, byLeaveType: Array.from(typeMap.values()) });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/balances/accrue", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { year, month, employeeId } = req.body as { year: number; month: number; employeeId?: number };
    // Check lock against the specific period being accrued
    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_leave_balance", year, month);
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    if (!year || !month || month < 1 || month > 12) {
      res.status(400).json({ error: "Valid year and month (1–12) are required" }); return;
    }

    const leaveTypes = await db.select().from(leaveTypesTable).where(
      and(eq(leaveTypesTable.isActive, true), sql`${leaveTypesTable.annualQuota} > 0`)
    );
    const emps = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(isNull(employeesTable.deletedAt), employeeId ? eq(employeesTable.id, employeeId) : undefined));

    let accrued = 0;
    let skipped = 0;

    for (const emp of emps) {
      for (const lt of leaveTypes) {
        // Check if already accrued this month
        const already = await db.select({ id: leaveAccrualHistoryTable.id }).from(leaveAccrualHistoryTable).where(
          and(
            eq(leaveAccrualHistoryTable.employeeId, emp.id),
            eq(leaveAccrualHistoryTable.leaveTypeId, lt.id),
            eq(leaveAccrualHistoryTable.year, year),
            eq(leaveAccrualHistoryTable.month, month),
            sql`${leaveAccrualHistoryTable.accrualType} = 'Monthly Accrual'`,
          )
        );
        if (already.length > 0) { skipped++; continue; }

        const monthlyDays = (parseFloat(lt.annualQuota as string) / 12).toFixed(1);

        await db.transaction(async (tx) => {
          const [bal] = await tx.select().from(leaveBalancesTable).where(
            and(eq(leaveBalancesTable.employeeId, emp.id), eq(leaveBalancesTable.leaveTypeId, lt.id), eq(leaveBalancesTable.year, year))
          );
          if (bal) {
            await tx.update(leaveBalancesTable)
              .set({ allocated: sql`${leaveBalancesTable.allocated} + ${monthlyDays}`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          } else {
            await tx.insert(leaveBalancesTable).values({
              employeeId: emp.id, leaveTypeId: lt.id, year,
              allocated: monthlyDays, used: "0", pending: "0", carryForward: "0",
            });
          }
          await tx.insert(leaveAccrualHistoryTable).values({
            employeeId: emp.id, leaveTypeId: lt.id, year, month,
            accrualType: "Monthly Accrual",
            days: monthlyDays,
            notes: `Monthly accrual ${year}-${String(month).padStart(2, "0")} (${monthlyDays} of ${lt.annualQuota} annual)`,
            processedById: req.hrmsUser.id,
          });
        });
        accrued++;
      }
    }

    await logAudit({ user: req.hrmsUser, action: "ACCRUE_LEAVE", module: "Leave", newValue: `${year}-${month}: accrued=${accrued}, skipped=${skipped}`, ipAddress: req.ip });
    res.json({ accrued, skipped, message: `Processed ${accrued} accrual(s), skipped ${skipped} already-run accrual(s)` });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LEAVE CALENDAR ───────────────────────────────────────────────────────────

router.get("/leave/calendar", requireHrmsUser, requireRole(...HR_READ_ROLES, "employee"), async (req, res) => {
  try {
    const { month, departmentId } = req.query as { month?: string; departmentId?: string };
    const conds: SQL[] = [sql`${leaveApplicationsTable.status} NOT IN ('Rejected', 'Cancelled')`];

    if (month) {
      const [y, m] = month.split("-");
      const from = `${y}-${m}-01`;
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const to = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
      conds.push(lte(leaveApplicationsTable.fromDate, to));
      conds.push(gte(leaveApplicationsTable.toDate, from));
    }

    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.json([]); return; }
      conds.push(eq(leaveApplicationsTable.employeeId, emp.id));
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      if (!hodEmp?.departmentId) { res.json([]); return; }
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
      if (deptEmps.length === 0) { res.json([]); return; }
      conds.push(sql`${leaveApplicationsTable.employeeId} = ANY(ARRAY[${sql.join(deptEmps.map(e => sql`${e.id}`), sql`, `)}]::int[])`);
    } else if (departmentId) {
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, Number(departmentId)), isNull(employeesTable.deletedAt)));
      if (deptEmps.length > 0) {
        conds.push(sql`${leaveApplicationsTable.employeeId} = ANY(ARRAY[${sql.join(deptEmps.map(e => sql`${e.id}`), sql`, `)}]::int[])`);
      }
    }

    const entries = await db
      .select({
        id: leaveApplicationsTable.id,
        employeeId: leaveApplicationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        departmentName: departmentsTable.name,
        leaveTypeName: leaveTypesTable.name,
        leaveTypeCode: leaveTypesTable.code,
        fromDate: leaveApplicationsTable.fromDate,
        toDate: leaveApplicationsTable.toDate,
        totalDays: leaveApplicationsTable.totalDays,
        isHalfDay: leaveApplicationsTable.isHalfDay,
        status: leaveApplicationsTable.status,
      })
      .from(leaveApplicationsTable)
      .innerJoin(employeesTable, eq(leaveApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .innerJoin(leaveTypesTable, eq(leaveApplicationsTable.leaveTypeId, leaveTypesTable.id))
      .where(and(...conds))
      .orderBy(leaveApplicationsTable.fromDate);

    res.json(entries);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── BLACKOUT DATES ───────────────────────────────────────────────────────────

router.get("/leave/blackout-dates", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { departmentId } = req.query as { departmentId?: string };
    const conds: SQL[] = [];
    if (departmentId) {
      conds.push(or(isNull(blackoutDatesTable.departmentId), eq(blackoutDatesTable.departmentId, Number(departmentId)))!);
    }
    const dates = await db.select().from(blackoutDatesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(blackoutDatesTable.fromDate);
    res.json(dates);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/leave/blackout-dates", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { name, fromDate, toDate, departmentId, reason } = req.body as {
      name: string; fromDate: string; toDate: string; departmentId?: number; reason?: string;
    };
    const [created] = await db.insert(blackoutDatesTable).values({
      name, fromDate, toDate, departmentId, reason, createdById: req.hrmsUser.id,
    }).returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE_BLACKOUT_DATE", module: "Leave", recordId: created.id, newValue: name, ipAddress: req.ip });
    res.status(201).json(created);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/leave/blackout-dates/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const [deleted] = await db.delete(blackoutDatesTable).where(eq(blackoutDatesTable.id, Number(req.params.id))).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: "DELETE_BLACKOUT_DATE", module: "Leave", recordId: deleted.id, newValue: deleted.name, ipAddress: req.ip });
    res.json(deleted);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
