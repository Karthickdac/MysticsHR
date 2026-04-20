import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import {
  exitRequestsTable,
  exitClearanceTasksTable,
  fnfComputationsTable,
  exitInterviewsTable,
  employeesTable,
  hrmsUsersTable,
  departmentsTable,
  leaveBalancesTable,
  leaveTypesTable,
  issuedDocumentsTable,
  documentTemplatesTable,
  payrollRecordsTable,
  payrollRunsTable,
} from "@workspace/db/schema";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { logAudit } from "../lib/audit";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function getEmployeeForUser(userId: number) {
  const [u] = await db.select({ employeeId: hrmsUsersTable.employeeId })
    .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, userId));
  if (!u?.employeeId) return null;
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, u.employeeId));
  return emp ?? null;
}

function computeNoticePeriodDays(joinDate: string | null): number {
  if (!joinDate) return 30;
  const years = (Date.now() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
  if (years < 1) return 30;
  if (years < 3) return 60;
  return 90;
}

async function autoGenerateClearanceTasks(exitRequestId: number, actualLwd: string) {
  const defaultTasks = [
    { department: "IT", taskName: "Revoke System Access", description: "Disable email, VPN, and all system access." },
    { department: "IT", taskName: "Asset Return", description: "Collect laptop, access cards, and any company hardware." },
    { department: "Finance", taskName: "Expense Claims Settlement", description: "Settle all pending expense claims." },
    { department: "Finance", taskName: "Salary & Recovery Clearance", description: "Confirm no pending salary recoveries." },
    { department: "HR", taskName: "Exit Interview Completion", description: "Ensure exit interview form is submitted." },
    { department: "HR", taskName: "Relieving Documents", description: "Prepare relieving letter and experience certificate." },
    { department: "Manager", taskName: "Knowledge Transfer", description: "Ensure all knowledge transfer sessions are complete." },
    { department: "Manager", taskName: "Work Handover", description: "Hand over all pending work to the designated colleague." },
  ];

  const dueDate = actualLwd;
  for (const task of defaultTasks) {
    await db.insert(exitClearanceTasksTable).values({
      exitRequestId,
      department: task.department,
      taskName: task.taskName,
      description: task.description,
      dueDate,
    });
  }
}

async function enrichExitRequest(req: typeof exitRequestsTable.$inferSelect) {
  const [emp] = await db.select({
    firstName: employeesTable.firstName,
    lastName: employeesTable.lastName,
    employeeCode: employeesTable.employeeId,
    departmentId: employeesTable.departmentId,
  }).from(employeesTable).where(eq(employeesTable.id, req.employeeId));

  let departmentName: string | null = null;
  if (emp?.departmentId) {
    const [dept] = await db.select({ name: departmentsTable.name })
      .from(departmentsTable).where(eq(departmentsTable.id, emp.departmentId));
    departmentName = dept?.name ?? null;
  }

  return {
    ...req,
    employeeName: emp ? `${emp.firstName} ${emp.lastName}` : null,
    employeeCode: emp?.employeeCode ?? null,
    departmentName,
  };
}

// ─── LIST EXIT REQUESTS ───────────────────────────────────────────────────────
router.get("/exit/requests", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { status, exitType, employeeId } = req.query as Record<string, string>;
    const isHr = (HR_ROLES as readonly string[]).includes(u.role);

    const conds: any[] = [];
    if (status) conds.push(eq(exitRequestsTable.status, status as any));
    if (exitType) conds.push(eq(exitRequestsTable.exitType, exitType as any));

    if (!isHr) {
      const emp = await getEmployeeForUser(u.id);
      if (!emp) { res.json([]); return; }
      conds.push(eq(exitRequestsTable.employeeId, emp.id));
    } else if (employeeId) {
      conds.push(eq(exitRequestsTable.employeeId, Number(employeeId)));
    }

    const rows = await db.select().from(exitRequestsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(exitRequestsTable.createdAt));

    const enriched = await Promise.all(rows.map(enrichExitRequest));
    res.json(enriched);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CREATE EXIT REQUEST ──────────────────────────────────────────────────────
router.post("/exit/requests", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { exitType, reason, requestedLwd, employeeId: bodyEmployeeId } = req.body;
    if (!exitType || !reason || !requestedLwd) {
      res.status(400).json({ error: "exitType, reason, and requestedLwd are required" }); return;
    }

    const isHr = (HR_ROLES as readonly string[]).includes(u.role);
    let empId: number;

    if (isHr && bodyEmployeeId) {
      empId = Number(bodyEmployeeId);
    } else {
      const emp = await getEmployeeForUser(u.id);
      if (!emp) { res.status(400).json({ error: "No employee record linked to your account" }); return; }
      empId = emp.id;
    }

    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, empId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

    // Compute notice period
    const noticePeriodDays = computeNoticePeriodDays(emp.dateOfJoining);

    const [exitReq] = await db.insert(exitRequestsTable).values({
      employeeId: empId,
      exitType,
      reason,
      requestedLwd,
      noticePeriodDays,
      status: "Submitted",
      initiatedByUserId: u.id,
    }).returning();

    // Mark employee status as Notice Period
    await db.update(employeesTable)
      .set({ status: "Notice Period", updatedAt: new Date() })
      .where(eq(employeesTable.id, empId));

    await logAudit({
      userId: u.id,
      action: "create_exit_request",
      entityType: "exit_request",
      entityId: exitReq.id,
      changes: { exitType, reason, requestedLwd, empId },
    });

    res.status(201).json(await enrichExitRequest(exitReq));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET EXIT REQUEST DETAIL ──────────────────────────────────────────────────
router.get("/exit/requests/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const id = Number(req.params.id);
    const isHr = (HR_ROLES as readonly string[]).includes(u.role);

    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, id));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    // Non-HR users can only see their own
    if (!isHr) {
      const emp = await getEmployeeForUser(u.id);
      if (!emp || emp.id !== exitReq.employeeId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const clearanceTasks = await db.select({
      id: exitClearanceTasksTable.id,
      exitRequestId: exitClearanceTasksTable.exitRequestId,
      department: exitClearanceTasksTable.department,
      taskName: exitClearanceTasksTable.taskName,
      description: exitClearanceTasksTable.description,
      assignedToUserId: exitClearanceTasksTable.assignedToUserId,
      assigneeName: hrmsUsersTable.name,
      dueDate: exitClearanceTasksTable.dueDate,
      status: exitClearanceTasksTable.status,
      completedAt: exitClearanceTasksTable.completedAt,
      remarks: exitClearanceTasksTable.remarks,
    }).from(exitClearanceTasksTable)
      .leftJoin(hrmsUsersTable, eq(exitClearanceTasksTable.assignedToUserId, hrmsUsersTable.id))
      .where(eq(exitClearanceTasksTable.exitRequestId, id))
      .orderBy(exitClearanceTasksTable.department);

    const [fnf] = await db.select().from(fnfComputationsTable)
      .where(eq(fnfComputationsTable.exitRequestId, id));

    const [interview] = isHr
      ? await db.select().from(exitInterviewsTable).where(eq(exitInterviewsTable.exitRequestId, id))
      : [null];

    const enriched = await enrichExitRequest(exitReq);
    res.json({ ...enriched, clearanceTasks, fnfComputation: fnf ?? null, exitInterview: interview ?? null });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── UPDATE EXIT REQUEST ──────────────────────────────────────────────────────
router.put("/exit/requests/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const id = Number(req.params.id);
    const { status, actualLwd, noticePeriodDays, noticePeriodWaived, noticePeriodBuyout, hrRemarks } = req.body;

    const [existing] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Exit request not found" }); return; }

    // Notice period waiver/buyout requires HR Manager or super_admin authorization
    if ((noticePeriodWaived === true || noticePeriodBuyout === true) &&
        u.role !== "super_admin" && u.role !== "hr_manager") {
      res.status(403).json({ error: "Only HR Manager or Super Admin can waive or buyout notice periods" }); return;
    }

    const updates: Partial<typeof exitRequestsTable.$inferInsert> = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (actualLwd !== undefined) updates.actualLwd = actualLwd;
    if (noticePeriodDays !== undefined) updates.noticePeriodDays = noticePeriodDays;
    if (noticePeriodWaived !== undefined) updates.noticePeriodWaived = noticePeriodWaived;
    if (noticePeriodBuyout !== undefined) updates.noticePeriodBuyout = noticePeriodBuyout;
    if (hrRemarks !== undefined) updates.hrRemarks = hrRemarks;

    if (status === "Clearance Pending") {
      updates.approvedByUserId = u.id;
      updates.approvedAt = new Date();
      const lwd = actualLwd ?? existing.requestedLwd;
      await autoGenerateClearanceTasks(id, lwd);
    }

    if (status === "Separated") {
      updates.separatedAt = new Date();
      // Mark employee as Separated
      await db.update(employeesTable)
        .set({ status: "Separated", isActive: false, updatedAt: new Date() })
        .where(eq(employeesTable.id, existing.employeeId));
    }

    const [updated] = await db.update(exitRequestsTable).set(updates)
      .where(eq(exitRequestsTable.id, id)).returning();

    await logAudit({
      userId: u.id,
      action: "update_exit_request",
      entityType: "exit_request",
      entityId: id,
      changes: updates,
    });

    res.json(await enrichExitRequest(updated));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LIST CLEARANCE TASKS ─────────────────────────────────────────────────────
router.get("/exit/requests/:id/clearance-tasks", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const id = Number(req.params.id);
    const isHr = (HR_ROLES as readonly string[]).includes(u.role);

    // Verify the exit request exists and enforce ownership for non-HR users
    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, id));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    if (!isHr) {
      const emp = await getEmployeeForUser(u.id);
      if (!emp || emp.id !== exitReq.employeeId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const rows = await db.select({
      id: exitClearanceTasksTable.id,
      exitRequestId: exitClearanceTasksTable.exitRequestId,
      department: exitClearanceTasksTable.department,
      taskName: exitClearanceTasksTable.taskName,
      description: exitClearanceTasksTable.description,
      assignedToUserId: exitClearanceTasksTable.assignedToUserId,
      assigneeName: hrmsUsersTable.name,
      dueDate: exitClearanceTasksTable.dueDate,
      status: exitClearanceTasksTable.status,
      completedAt: exitClearanceTasksTable.completedAt,
      remarks: exitClearanceTasksTable.remarks,
    }).from(exitClearanceTasksTable)
      .leftJoin(hrmsUsersTable, eq(exitClearanceTasksTable.assignedToUserId, hrmsUsersTable.id))
      .where(eq(exitClearanceTasksTable.exitRequestId, id))
      .orderBy(exitClearanceTasksTable.department);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── UPDATE CLEARANCE TASK ────────────────────────────────────────────────────
// Authorization: HR roles can complete/waive any task.
// Non-HR users may only update a task if they are explicitly assigned to it.
router.put("/exit/clearance-tasks/:taskId", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const taskId = Number(req.params.taskId);
    const { status, remarks } = req.body;
    if (!status) { res.status(400).json({ error: "status is required" }); return; }

    const [task] = await db.select().from(exitClearanceTasksTable).where(eq(exitClearanceTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const isHr = (HR_ROLES as readonly string[]).includes(u.role);
    if (!isHr) {
      // Non-HR users must be explicitly assigned to this task
      if (task.assignedToUserId !== u.id) {
        res.status(403).json({ error: "You are not authorized to update this clearance task" }); return;
      }
      // Non-HR users cannot Waive — only HR can waive
      if (status === "Waived") {
        res.status(403).json({ error: "Only HR can waive clearance tasks" }); return;
      }
    }

    const updates: Partial<typeof exitClearanceTasksTable.$inferInsert> = { status };
    if (remarks !== undefined) updates.remarks = remarks;
    if (status === "Completed" || status === "Waived") {
      updates.completedAt = new Date();
      updates.completedByUserId = u.id;
    }

    const [updated] = await db.update(exitClearanceTasksTable).set(updates)
      .where(eq(exitClearanceTasksTable.id, taskId)).returning();

    // Check if all tasks for this exit request are complete — if so, move to FnF Pending
    const allTasks = await db.select().from(exitClearanceTasksTable)
      .where(eq(exitClearanceTasksTable.exitRequestId, task.exitRequestId));
    const allDone = allTasks.every(t =>
      t.id === taskId
        ? (status === "Completed" || status === "Waived")
        : (t.status === "Completed" || t.status === "Waived")
    );
    if (allDone) {
      await db.update(exitRequestsTable)
        .set({ status: "FnF Pending", updatedAt: new Date() })
        .where(eq(exitRequestsTable.id, task.exitRequestId));
    }

    res.json({ ...updated, assigneeName: null });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SUGGEST FnF VALUES (auto-compute from payroll + leave data) ──────────────
router.get("/exit/requests/:id/fnf/suggest", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const exitRequestId = Number(req.params.id);
    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, exitReq.employeeId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

    // ── Last payroll record ──────────────────────────────────────────────────
    const latestPayrollRun = await db.select().from(payrollRunsTable)
      .where(eq(payrollRunsTable.status, "Approved"))
      .orderBy(desc(payrollRunsTable.year), desc(payrollRunsTable.month))
      .limit(1);

    let pendingSalary = 0;
    let dailyRate = 0;
    if (latestPayrollRun.length > 0) {
      const [record] = await db.select().from(payrollRecordsTable)
        .where(and(
          eq(payrollRecordsTable.payrollRunId, latestPayrollRun[0].id),
          eq(payrollRecordsTable.employeeId, exitReq.employeeId),
        ));
      if (record) {
        const gross = Number(record.grossEarnings ?? 0);
        const present = Number(record.presentDays ?? 26);
        dailyRate = present > 0 ? gross / present : gross / 26;
        // Pending salary is the last month's net pay as the baseline
        pendingSalary = Number(record.netPay ?? 0);
      }
    }

    // Fallback: derive daily rate from CTC
    if (dailyRate === 0 && emp.ctc) {
      dailyRate = Number(emp.ctc) / 12 / 26;
    }

    // ── Gratuity (Gratuity Act: tenure >= 5 yrs, formula = 15 × last salary/26 × years) ──
    let gratuity = 0;
    const tenureYears = emp.dateOfJoining
      ? (Date.now() - new Date(emp.dateOfJoining).getTime()) / (1000 * 60 * 60 * 24 * 365)
      : 0;
    if (tenureYears >= 5) {
      const monthlySalary = dailyRate * 26;
      gratuity = Math.round((15 * monthlySalary / 26) * Math.floor(tenureYears));
    }

    // ── Leave encashment (earned leave with encashment enabled) ──────────────
    let leaveEncashment = 0;
    const balances = await db.select({
      available: leaveBalancesTable.available,
      encashmentEnabled: leaveTypesTable.encashmentEnabled,
    }).from(leaveBalancesTable)
      .leftJoin(leaveTypesTable, eq(leaveBalancesTable.leaveTypeId, leaveTypesTable.id))
      .where(eq(leaveBalancesTable.employeeId, exitReq.employeeId));

    for (const b of balances) {
      if (b.encashmentEnabled) {
        leaveEncashment += Number(b.available ?? 0) * dailyRate;
      }
    }
    leaveEncashment = Math.round(leaveEncashment);

    // ── Notice period short-fall LOP ─────────────────────────────────────────
    let noticePeriodLop = 0;
    if (!exitReq.noticePeriodWaived && !exitReq.noticePeriodBuyout && exitReq.requestedLwd && exitReq.actualLwd) {
      const requestedLwdDate = new Date(exitReq.requestedLwd);
      const actualLwdDate = new Date(exitReq.actualLwd);
      const shortfallDays = Math.max(0, Math.round((requestedLwdDate.getTime() - actualLwdDate.getTime()) / (1000 * 60 * 60 * 24)));
      noticePeriodLop = Math.round(shortfallDays * dailyRate);
    }

    res.json({
      pendingSalary: Math.round(pendingSalary),
      leaveEncashment,
      gratuity,
      bonusProration: 0,
      noticePeriodLop,
      otherDeductions: 0,
      dailyRate: Math.round(dailyRate * 100) / 100,
      tenureYears: Math.round(tenureYears * 10) / 10,
      notes: {
        pendingSalary: "Based on last approved payroll net pay",
        leaveEncashment: `Based on ${balances.filter(b => b.encashmentEnabled).length} encashable leave type(s)`,
        gratuity: tenureYears >= 5 ? `Eligible — ${Math.floor(tenureYears)} years tenure` : "Not eligible — tenure < 5 years",
        noticePeriodLop: exitReq.noticePeriodWaived ? "Waived" : exitReq.noticePeriodBuyout ? "Buyout" : `Short-fall LOP estimate`,
      },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET FnF COMPUTATION ──────────────────────────────────────────────────────
router.get("/exit/requests/:id/fnf", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [fnf] = await db.select().from(fnfComputationsTable)
      .where(eq(fnfComputationsTable.exitRequestId, id));
    if (!fnf) { res.status(404).json({ error: "FnF computation not found" }); return; }
    res.json(fnf);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── COMPUTE FnF ──────────────────────────────────────────────────────────────
router.post("/exit/requests/:id/fnf", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const exitRequestId = Number(req.params.id);
    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    const {
      pendingSalary = 0,
      leaveEncashment = 0,
      gratuity = 0,
      bonusProration = 0,
      noticePeriodLop = 0,
      otherDeductions = 0,
      remarks,
    } = req.body ?? {};

    const totalPayable = Number(pendingSalary) + Number(leaveEncashment) +
      Number(gratuity) + Number(bonusProration) -
      Number(noticePeriodLop) - Number(otherDeductions);

    // Upsert — delete old and create new
    const existing = await db.select().from(fnfComputationsTable)
      .where(eq(fnfComputationsTable.exitRequestId, exitRequestId));

    let fnf: typeof fnfComputationsTable.$inferSelect;
    if (existing.length > 0) {
      [fnf] = await db.update(fnfComputationsTable).set({
        pendingSalary: String(pendingSalary),
        leaveEncashment: String(leaveEncashment),
        gratuity: String(gratuity),
        bonusProration: String(bonusProration),
        noticePeriodLop: String(noticePeriodLop),
        otherDeductions: String(otherDeductions),
        totalPayable: String(Math.max(0, totalPayable)),
        computedByUserId: u.id,
        computedAt: new Date(),
        remarks: remarks ?? null,
        updatedAt: new Date(),
      }).where(eq(fnfComputationsTable.exitRequestId, exitRequestId)).returning();
    } else {
      [fnf] = await db.insert(fnfComputationsTable).values({
        exitRequestId,
        pendingSalary: String(pendingSalary),
        leaveEncashment: String(leaveEncashment),
        gratuity: String(gratuity),
        bonusProration: String(bonusProration),
        noticePeriodLop: String(noticePeriodLop),
        otherDeductions: String(otherDeductions),
        totalPayable: String(Math.max(0, totalPayable)),
        computedByUserId: u.id,
        computedAt: new Date(),
        remarks: remarks ?? null,
      }).returning();
    }

    // Move exit request to FnF Pending if not already
    if (!["FnF Pending", "FnF Approved", "Separated"].includes(exitReq.status)) {
      await db.update(exitRequestsTable)
        .set({ status: "FnF Pending", updatedAt: new Date() })
        .where(eq(exitRequestsTable.id, exitRequestId));
    }

    await logAudit({
      userId: u.id,
      action: "compute_fnf",
      entityType: "fnf_computation",
      entityId: fnf.id,
      changes: { exitRequestId, totalPayable },
    });

    res.json(fnf);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── APPROVE FnF ──────────────────────────────────────────────────────────────
// approverRole is derived server-side from the user's session role — never trusted from the request body.
// HR roles (super_admin, hr_manager, hr_executive) → provide HR approval
// Finance roles (payroll_admin) → provide Finance approval
router.post("/exit/requests/:id/fnf/approve", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const exitRequestId = Number(req.params.id);
    const { remarks } = req.body;

    // Derive approver lane from session role — never trust client-supplied value
    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);
    const approverLane: "hr" | "finance" = isHrRole ? "hr" : "finance";

    const [fnf] = await db.select().from(fnfComputationsTable)
      .where(eq(fnfComputationsTable.exitRequestId, exitRequestId));
    if (!fnf) { res.status(404).json({ error: "FnF computation not found — compute FnF first" }); return; }

    const updates: Partial<typeof fnfComputationsTable.$inferInsert> = { updatedAt: new Date() };
    if (approverLane === "hr") {
      updates.hrApprovedByUserId = u.id;
      updates.hrApprovedAt = new Date();
    } else {
      updates.financeApprovedByUserId = u.id;
      updates.financeApprovedAt = new Date();
    }
    if (remarks) updates.remarks = remarks;

    const [updated] = await db.update(fnfComputationsTable).set(updates)
      .where(eq(fnfComputationsTable.id, fnf.id)).returning();

    // If both HR and Finance have approved, move exit request to FnF Approved and auto-generate documents
    const fullyApproved = !!(updated.hrApprovedAt && updated.financeApprovedAt);
    if (fullyApproved) {
      const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));

      await db.update(exitRequestsTable)
        .set({ status: "FnF Approved", updatedAt: new Date() })
        .where(eq(exitRequestsTable.id, exitRequestId));

      // Auto-generate Relieving Letter
      if (exitReq) {
        const [template] = await db.select().from(documentTemplatesTable)
          .where(and(eq(documentTemplatesTable.documentType, "Relieving Letter"), eq(documentTemplatesTable.isActive, true)))
          .limit(1);

        // Try to insert issued document records for both Relieving Letter and Experience Certificate
        for (const docType of ["Relieving Letter", "Experience Certificate"] as const) {
          const [tmpl] = await db.select().from(documentTemplatesTable)
            .where(and(eq(documentTemplatesTable.documentType, docType), eq(documentTemplatesTable.isActive, true)))
            .limit(1);
          if (tmpl) {
            try {
              await db.insert(issuedDocumentsTable).values({
                employeeId: exitReq.employeeId,
                templateId: tmpl.id,
                documentType: docType,
                filename: `${docType.replace(/ /g, "_")}_${exitReq.employeeId}_${Date.now()}.pdf`,
                generatedBy: u.id,
                fieldValues: {
                  lastWorkingDay: exitReq.actualLwd ?? exitReq.requestedLwd,
                  currentDate: new Date().toLocaleDateString("en-IN"),
                },
                fileContent: "PENDING_GENERATION",
              });
            } catch (docErr) {
              console.error(`[FnF] Failed to issue ${docType} for employee ${exitReq.employeeId}:`, docErr);
            }
          }
        }
      }
    }

    await logAudit({
      userId: u.id,
      action: "approve_fnf",
      entityType: "fnf_computation",
      entityId: fnf.id,
      changes: { approverRole, exitRequestId },
    });

    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET EXIT INTERVIEW ───────────────────────────────────────────────────────
router.get("/exit/requests/:id/interview", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const exitRequestId = Number(req.params.id);
    const isHr = (HR_ROLES as readonly string[]).includes(u.role);

    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    if (!isHr) {
      const emp = await getEmployeeForUser(u.id);
      if (!emp || emp.id !== exitReq.employeeId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const [interview] = await db.select().from(exitInterviewsTable)
      .where(eq(exitInterviewsTable.exitRequestId, exitRequestId));

    if (!interview) {
      // Auto-create exit interview with default questions
      const defaultQuestions = [
        { id: 1, question: "What is your primary reason for leaving?" },
        { id: 2, question: "How would you rate your overall experience at the company? (1-5)" },
        { id: 3, question: "What did you like most about working here?" },
        { id: 4, question: "What could the company have done better?" },
        { id: 5, question: "Would you recommend this company to others? (Yes/No)" },
        { id: 6, question: "How was your relationship with your manager?" },
        { id: 7, question: "Do you have any other feedback for HR?" },
      ];

      const [newInterview] = await db.insert(exitInterviewsTable).values({
        exitRequestId,
        employeeId: exitReq.employeeId,
        questions: defaultQuestions,
        responses: [],
      }).returning();

      res.json(newInterview);
    } else {
      // Non-HR only sees their own, without responses
      if (!isHr) {
        res.json({ ...interview, responses: interview.submittedAt ? [] : interview.responses });
      } else {
        res.json(interview);
      }
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SUBMIT EXIT INTERVIEW ────────────────────────────────────────────────────
router.post("/exit/requests/:id/interview", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const exitRequestId = Number(req.params.id);
    const { responses } = req.body;
    if (!responses || !Array.isArray(responses)) {
      res.status(400).json({ error: "responses array is required" }); return;
    }

    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    const emp = await getEmployeeForUser(u.id);
    const isHr = (HR_ROLES as readonly string[]).includes(u.role);
    if (!isHr && (!emp || emp.id !== exitReq.employeeId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    const [existing] = await db.select().from(exitInterviewsTable)
      .where(eq(exitInterviewsTable.exitRequestId, exitRequestId));

    if (existing) {
      const [updated] = await db.update(exitInterviewsTable).set({
        responses,
        submittedAt: new Date(),
      }).where(eq(exitInterviewsTable.id, existing.id)).returning();
      res.json(updated);
    } else {
      const [newInterview] = await db.insert(exitInterviewsTable).values({
        exitRequestId,
        employeeId: exitReq.employeeId,
        questions: [],
        responses,
        submittedAt: new Date(),
      }).returning();
      res.json(newInterview);
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
