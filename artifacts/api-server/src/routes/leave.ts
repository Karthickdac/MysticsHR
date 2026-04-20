import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  leaveTypesTable,
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

async function getEmployeeForUser(userId: number): Promise<{ id: number; departmentId: number | null } | null> {
  const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, userId));
  if (!user?.employeeId) return null;
  const [emp] = await db.select({ id: employeesTable.id, departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, user.employeeId));
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
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: `HR_${action.toUpperCase()}_LEAVE`, module: "Leave", recordId: appId, newValue: action, ipAddress: req.ip });
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
        // Restore balance: infer previous status from approval trail
        const [bal] = await tx.select().from(leaveBalancesTable).where(
          and(eq(leaveBalancesTable.employeeId, app.employeeId), eq(leaveBalancesTable.leaveTypeId, app.leaveTypeId), eq(leaveBalancesTable.year, year))
        );
        if (bal) {
          const wasApproved = !!app.hrActionedAt || (!!app.hodActionedAt && !app.hodRemarks?.startsWith("Reject"));
          if (wasApproved) {
            await tx.update(leaveBalancesTable)
              .set({ used: sql`GREATEST(0, ${leaveBalancesTable.used} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          } else {
            await tx.update(leaveBalancesTable)
              .set({ pending: sql`GREATEST(0, ${leaveBalancesTable.pending} - ${totalDays})`, updatedAt: new Date() })
              .where(eq(leaveBalancesTable.id, bal.id));
          }
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
    const conds: SQL[] = [];
    if (year) conds.push(eq(leaveBalancesTable.year, Number(year)));

    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.json([]); return; }
      conds.push(eq(leaveBalancesTable.employeeId, emp.id));
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
      if (emp) conds.push(eq(leaveApplicationsTable.employeeId, emp.id));
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      if (hodEmp?.departmentId) {
        const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
          .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
        if (deptEmps.length > 0) {
          conds.push(sql`${leaveApplicationsTable.employeeId} = ANY(ARRAY[${sql.join(deptEmps.map(e => sql`${e.id}`), sql`, `)}]::int[])`);
        }
      }
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
