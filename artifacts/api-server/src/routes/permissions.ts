import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  permissionApplicationsTable,
  permissionRegistersTable,
  employeesTable,
  hrmsUsersTable,
  departmentsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNull, sql, desc, SQL } from "drizzle-orm";

const PERMISSION_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
type PermissionStatusValue = (typeof PERMISSION_STATUSES)[number];

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;
const DEFAULT_LIMIT_MINUTES = 240; // 4 hours per month

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function getEmployeeForUser(userId: number) {
  const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, userId));
  if (!user?.employeeId) return null;
  const [emp] = await db.select({ id: employeesTable.id, departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, user.employeeId));
  return emp ?? null;
}

function computeDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

async function getOrCreateRegister(employeeId: number, year: number, month: number) {
  const [existing] = await db.select().from(permissionRegistersTable).where(
    and(eq(permissionRegistersTable.employeeId, employeeId), eq(permissionRegistersTable.year, year), eq(permissionRegistersTable.month, month))
  );
  if (existing) return existing;
  const [created] = await db.insert(permissionRegistersTable).values({
    employeeId, year, month, usedMinutes: 0, limitMinutes: DEFAULT_LIMIT_MINUTES,
  }).returning();
  return created;
}

// ─── PERMISSION APPLICATIONS ──────────────────────────────────────────────────

router.get("/permissions", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, status, month, departmentId } = req.query as {
      employeeId?: string; status?: string; month?: string; departmentId?: string;
    };

    const conds: SQL[] = [];

    if (req.hrmsUser.role === "employee") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.json([]); return; }
      conds.push(eq(permissionApplicationsTable.employeeId, emp.id));
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      if (!hodEmp?.departmentId) { res.json([]); return; }
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, hodEmp.departmentId), isNull(employeesTable.deletedAt)));
      if (deptEmps.length > 0) {
        conds.push(sql`${permissionApplicationsTable.employeeId} = ANY(ARRAY[${sql.join(deptEmps.map(e => sql`${e.id}`), sql`, `)}]::int[])`);
      } else {
        res.json([]); return;
      }
    } else if (employeeId) {
      conds.push(eq(permissionApplicationsTable.employeeId, Number(employeeId)));
    }

    if (status && PERMISSION_STATUSES.includes(status as PermissionStatusValue)) {
      conds.push(eq(permissionApplicationsTable.status, status as PermissionStatusValue));
    }
    if (month) {
      const [y, m] = month.split("-");
      const from = `${y}-${m}-01`;
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const to = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
      conds.push(gte(permissionApplicationsTable.permissionDate, from));
      conds.push(lte(permissionApplicationsTable.permissionDate, to));
    }

    let apps = await db
      .select({
        id: permissionApplicationsTable.id,
        employeeId: permissionApplicationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        departmentName: departmentsTable.name,
        permissionDate: permissionApplicationsTable.permissionDate,
        startTime: permissionApplicationsTable.startTime,
        endTime: permissionApplicationsTable.endTime,
        durationMinutes: permissionApplicationsTable.durationMinutes,
        reason: permissionApplicationsTable.reason,
        status: permissionApplicationsTable.status,
        hodActionedById: permissionApplicationsTable.hodActionedById,
        hodRemarks: permissionApplicationsTable.hodRemarks,
        hodActionedAt: permissionApplicationsTable.hodActionedAt,
        isOverride: permissionApplicationsTable.isOverride,
        overrideJustification: permissionApplicationsTable.overrideJustification,
        createdAt: permissionApplicationsTable.createdAt,
        updatedAt: permissionApplicationsTable.updatedAt,
      })
      .from(permissionApplicationsTable)
      .innerJoin(employeesTable, eq(permissionApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(permissionApplicationsTable.permissionDate));

    if (departmentId) {
      const deptId = Number(departmentId);
      const deptEmps = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.departmentId, deptId), isNull(employeesTable.deletedAt)));
      const empIds = new Set(deptEmps.map(e => e.id));
      apps = apps.filter(a => empIds.has(a.employeeId));
    }

    res.json(apps);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/permissions/register", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, month } = req.query as { employeeId?: string; month?: string };
    let empId: number;

    if (employeeId) {
      // HR/HOD/admin explicitly querying a specific employee — validate access
      empId = Number(employeeId);
      if (req.hrmsUser.role === "employee") {
        // Employees cannot query other employees' registers
        const emp = await getEmployeeForUser(req.hrmsUser.id);
        if (!emp || emp.id !== empId) { res.status(403).json({ error: "Forbidden" }); return; }
      } else if (req.hrmsUser.role === "hod") {
        const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
        const [targetEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, empId));
        if (!hodEmp?.departmentId || hodEmp.departmentId !== targetEmp?.departmentId) {
          res.status(403).json({ error: "You can only view registers for employees in your department" }); return;
        }
      }
      // payroll_admin/hr_*/super_admin: unrestricted
    } else {
      // No employeeId provided — resolve current user's own employee record
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp) { res.status(422).json({ error: "No employee profile linked to your account" }); return; }
      empId = emp.id;
    }

    const now = new Date();
    const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];

    const register = await getOrCreateRegister(empId, y, m);
    const applications = await db
      .select({
        id: permissionApplicationsTable.id,
        employeeId: permissionApplicationsTable.employeeId,
        permissionDate: permissionApplicationsTable.permissionDate,
        startTime: permissionApplicationsTable.startTime,
        endTime: permissionApplicationsTable.endTime,
        durationMinutes: permissionApplicationsTable.durationMinutes,
        reason: permissionApplicationsTable.reason,
        status: permissionApplicationsTable.status,
        hodActionedById: permissionApplicationsTable.hodActionedById,
        hodRemarks: permissionApplicationsTable.hodRemarks,
        hodActionedAt: permissionApplicationsTable.hodActionedAt,
        isOverride: permissionApplicationsTable.isOverride,
        overrideJustification: permissionApplicationsTable.overrideJustification,
        createdAt: permissionApplicationsTable.createdAt,
        updatedAt: permissionApplicationsTable.updatedAt,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        departmentName: departmentsTable.name,
      })
      .from(permissionApplicationsTable)
      .innerJoin(employeesTable, eq(permissionApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(
        and(
          eq(permissionApplicationsTable.employeeId, empId),
          gte(permissionApplicationsTable.permissionDate, `${y}-${String(m).padStart(2, "0")}-01`),
          lte(permissionApplicationsTable.permissionDate, `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`),
        )
      )
      .orderBy(desc(permissionApplicationsTable.permissionDate));

    res.json({
      employeeId: empId,
      year: y,
      month: m,
      usedMinutes: register.usedMinutes,
      limitMinutes: register.limitMinutes,
      remainingMinutes: register.limitMinutes - register.usedMinutes,
      applications,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/permissions/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [app] = await db
      .select({
        id: permissionApplicationsTable.id,
        employeeId: permissionApplicationsTable.employeeId,
        employeeName: sql<string>`concat(${employeesTable.firstName}, ' ', ${employeesTable.lastName})`,
        employeeCode: employeesTable.employeeId,
        departmentName: departmentsTable.name,
        permissionDate: permissionApplicationsTable.permissionDate,
        startTime: permissionApplicationsTable.startTime,
        endTime: permissionApplicationsTable.endTime,
        durationMinutes: permissionApplicationsTable.durationMinutes,
        reason: permissionApplicationsTable.reason,
        status: permissionApplicationsTable.status,
        hodActionedById: permissionApplicationsTable.hodActionedById,
        hodRemarks: permissionApplicationsTable.hodRemarks,
        hodActionedAt: permissionApplicationsTable.hodActionedAt,
        isOverride: permissionApplicationsTable.isOverride,
        overrideJustification: permissionApplicationsTable.overrideJustification,
        createdAt: permissionApplicationsTable.createdAt,
        updatedAt: permissionApplicationsTable.updatedAt,
      })
      .from(permissionApplicationsTable)
      .innerJoin(employeesTable, eq(permissionApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(eq(permissionApplicationsTable.id, Number(req.params.id)));
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

router.post("/permissions", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { permissionDate, startTime, endTime, reason, isOverride, overrideJustification } = req.body as {
      permissionDate: string; startTime: string; endTime: string; reason: string;
      isOverride?: boolean; overrideJustification?: string;
    };

    const emp = await getEmployeeForUser(req.hrmsUser.id);
    if (!emp && req.hrmsUser.role === "employee") {
      res.status(422).json({ error: "No employee profile linked" }); return;
    }
    const employeeId = emp?.id;
    if (!employeeId) { res.status(422).json({ error: "Employee not found" }); return; }

    const durationMinutes = computeDurationMinutes(startTime, endTime);
    if (durationMinutes <= 0) { res.status(400).json({ error: "End time must be after start time" }); return; }

    const permDate = new Date(permissionDate);
    const year = permDate.getFullYear();
    const month = permDate.getMonth() + 1;

    const register = await getOrCreateRegister(employeeId, year, month);
    const remaining = register.limitMinutes - register.usedMinutes;

    // Only HR roles may set isOverride=true
    const isHrRole = ["super_admin", "hr_manager", "hr_executive"].includes(req.hrmsUser.role);
    if (isOverride && !isHrRole) {
      res.status(403).json({ error: "Only HR can submit override permissions" }); return;
    }

    // If override is claimed, justification is mandatory
    if (isOverride && !overrideJustification?.trim()) {
      res.status(400).json({ error: "Override justification is required when isOverride is true" }); return;
    }

    // Block if exceeds limit — applies to ALL roles including HR; override flag + justification required to bypass
    if (durationMinutes > remaining && !isOverride) {
      res.status(422).json({
        error: `Monthly permission limit exceeded. Used: ${register.usedMinutes} min, Limit: ${register.limitMinutes} min, Remaining: ${remaining} min. HR can re-submit with isOverride=true and a justification.`,
        usedMinutes: register.usedMinutes,
        limitMinutes: register.limitMinutes,
        remainingMinutes: remaining,
      });
      return;
    }

    const [created] = await db.insert(permissionApplicationsTable).values({
      employeeId,
      permissionDate,
      startTime,
      endTime,
      durationMinutes,
      reason,
      isOverride: isOverride ?? false,
      overrideJustification: isOverride ? overrideJustification : null,
    }).returning();

    await logAudit({ user: req.hrmsUser, action: "SUBMIT_PERMISSION", module: "Permissions", recordId: created.id, newValue: `${permissionDate} ${startTime}-${endTime}`, ipAddress: req.ip });
    res.status(201).json(created);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/permissions/:id/action", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (req, res) => {
  try {
    const { action, remarks } = req.body as { action: "Approved" | "Rejected"; remarks?: string };
    const permId = Number(req.params.id);

    const [perm] = await db.select().from(permissionApplicationsTable).where(eq(permissionApplicationsTable.id, permId));
    if (!perm) { res.status(404).json({ error: "Not found" }); return; }
    if (perm.status !== "Pending") { res.status(422).json({ error: "Permission is not in Pending state" }); return; }

    // HOD scope check
    if (req.hrmsUser.role === "hod" && req.hrmsUser.employeeId) {
      const [hodEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, req.hrmsUser.employeeId));
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, perm.employeeId));
      if (hodEmp?.departmentId == null || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only action permission requests from employees in your department" });
        return;
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(permissionApplicationsTable)
        .set({ status: action, hodActionedById: req.hrmsUser!.id, hodRemarks: remarks ?? null, hodActionedAt: new Date(), updatedAt: new Date() })
        .where(eq(permissionApplicationsTable.id, permId))
        .returning();

      if (action === "Approved") {
        const permDate = new Date(perm.permissionDate as string);
        const year = permDate.getFullYear();
        const month = permDate.getMonth() + 1;
        const register = await getOrCreateRegister(perm.employeeId, year, month);
        await tx.update(permissionRegistersTable)
          .set({ usedMinutes: register.usedMinutes + perm.durationMinutes, updatedAt: new Date() })
          .where(eq(permissionRegistersTable.id, register.id));
      }
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: `${action.toUpperCase()}_PERMISSION`, module: "Permissions", recordId: permId, newValue: action, ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/permissions/:id/cancel", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const permId = Number(req.params.id);
    const [perm] = await db.select().from(permissionApplicationsTable).where(eq(permissionApplicationsTable.id, permId));
    if (!perm) { res.status(404).json({ error: "Not found" }); return; }
    if (["Rejected", "Cancelled"].includes(perm.status)) {
      res.status(422).json({ error: "Cannot cancel an already rejected or cancelled permission" }); return;
    }

    // Ownership / scope check
    if (req.hrmsUser.role === "employee" || req.hrmsUser.role === "payroll_admin") {
      const emp = await getEmployeeForUser(req.hrmsUser.id);
      if (!emp || emp.id !== perm.employeeId) { res.status(403).json({ error: "You can only cancel your own permission requests" }); return; }
    } else if (req.hrmsUser.role === "hod") {
      const hodEmp = await getEmployeeForUser(req.hrmsUser.id);
      const [reqEmp] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, perm.employeeId));
      if (!hodEmp?.departmentId || hodEmp.departmentId !== reqEmp?.departmentId) {
        res.status(403).json({ error: "You can only cancel permission requests from employees in your department" }); return;
      }
    }
    // hr_*, super_admin: unrestricted cancel

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(permissionApplicationsTable)
        .set({ status: "Cancelled", updatedAt: new Date() })
        .where(eq(permissionApplicationsTable.id, permId))
        .returning();

      if (perm.status === "Approved") {
        const permDate = new Date(perm.permissionDate as string);
        const [reg] = await tx.select().from(permissionRegistersTable).where(
          and(eq(permissionRegistersTable.employeeId, perm.employeeId), eq(permissionRegistersTable.year, permDate.getFullYear()), eq(permissionRegistersTable.month, permDate.getMonth() + 1))
        );
        if (reg) {
          await tx.update(permissionRegistersTable)
            .set({ usedMinutes: Math.max(0, reg.usedMinutes - perm.durationMinutes), updatedAt: new Date() })
            .where(eq(permissionRegistersTable.id, reg.id));
        }
      }
      return row;
    });

    await logAudit({ user: req.hrmsUser, action: "CANCEL_PERMISSION", module: "Permissions", recordId: permId, newValue: "Cancelled", ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/permissions/register/override", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { employeeId, year, month, newLimitMinutes, justification } = req.body as {
      employeeId: number; year: number; month: number; newLimitMinutes: number; justification: string;
    };

    const register = await getOrCreateRegister(employeeId, year, month);
    const [updated] = await db.update(permissionRegistersTable)
      .set({ limitMinutes: newLimitMinutes, updatedAt: new Date() })
      .where(eq(permissionRegistersTable.id, register.id))
      .returning();

    await logAudit({ user: req.hrmsUser, action: "OVERRIDE_PERMISSION_LIMIT", module: "Permissions", recordId: updated.id, newValue: `${newLimitMinutes} min (${justification})`, ipAddress: req.ip });
    res.json({
      employeeId,
      year,
      month,
      usedMinutes: updated.usedMinutes,
      limitMinutes: updated.limitMinutes,
      remainingMinutes: updated.limitMinutes - updated.usedMinutes,
      applications: [],
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
