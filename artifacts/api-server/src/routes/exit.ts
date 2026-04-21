import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import {
  exitRequestsTable,
  exitClearanceTasksTable,
  fnfComputationsTable,
  exitInterviewsTable,
  employeesTable,
  employeeProfilesTable,
  hrmsUsersTable,
  departmentsTable,
  leaveBalancesTable,
  leaveTypesTable,
  issuedDocumentsTable,
  documentTemplatesTable,
  payrollRecordsTable,
  payrollRunsTable,
} from "@workspace/db/schema";
import { eq, and, desc, or, sql, type SQL } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { generatePdf, substituteTemplate } from "../lib/pdf";
import { dispatchNotification } from "../lib/notification-service";
import { getUsersByRoles } from "./system-config";

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

/**
 * Compute notice period days using contractual terms when available.
 * Precedence: employee.noticePeriodDays (if set) → employment-type contractual default → tenure heuristic.
 * Per Automystics policy: Probation=0, employment-type defaults per contract, otherwise tenure-based.
 */
function computeNoticePeriodDays(joinDate: string | null, employmentType?: string | null, noticePeriodDays?: number | null): number {
  // If the employee record carries an explicit contractual notice period, honour it
  if (noticePeriodDays != null && noticePeriodDays > 0) return noticePeriodDays;
  // Employment-type contractual defaults
  if (employmentType === "Contract" || employmentType === "Intern") return 15;
  if (employmentType === "Probation") return 0;
  // Tenure-based fallback (permanent/regular employees)
  if (!joinDate) return 30;
  const years = (Date.now() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
  if (years < 1) return 30;
  if (years < 3) return 60;
  return 90;
}

/**
 * Auto-generate clearance checklist tasks with role-based assignees.
 * HR tasks → assigned to an hr_manager user; Finance → payroll_admin; Manager → employee's HOD;
 * IT tasks → assigned to super_admin (system admin) as a proxy since there is no dedicated IT role.
 */
async function autoGenerateClearanceTasks(exitRequestId: number, actualLwd: string, employeeId?: number) {
  // Resolve role-based assignees
  const [hrUser] = await db.select({ id: hrmsUsersTable.id }).from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.role, "hr_manager")).limit(1);
  const [financeUser] = await db.select({ id: hrmsUsersTable.id }).from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.role, "payroll_admin")).limit(1);
  const [adminUser] = await db.select({ id: hrmsUsersTable.id }).from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.role, "super_admin")).limit(1);

  // Resolve the employee's reporting manager (HOD of their department)
  let managerUserId: number | undefined;
  if (employeeId) {
    const [emp] = await db.select({ departmentId: employeesTable.departmentId })
      .from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (emp?.departmentId) {
      const [hod] = await db.select({ id: hrmsUsersTable.id }).from(hrmsUsersTable)
        .innerJoin(employeesTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(and(eq(hrmsUsersTable.role, "hod"), eq(employeesTable.departmentId, emp.departmentId)))
        .limit(1);
      managerUserId = hod?.id;
    }
  }
  // Fallback: use hr_manager for manager tasks if no HOD found
  const resolvedManagerId = managerUserId ?? hrUser?.id;

  const defaultTasks: { department: string; taskName: string; description: string; assignedToUserId?: number }[] = [
    { department: "IT", taskName: "Revoke System Access", description: "Disable email, VPN, and all system access.", assignedToUserId: adminUser?.id },
    { department: "IT", taskName: "Asset Return", description: "Collect laptop, access cards, and any company hardware.", assignedToUserId: adminUser?.id },
    { department: "Finance", taskName: "Expense Claims Settlement", description: "Settle all pending expense claims.", assignedToUserId: financeUser?.id },
    { department: "Finance", taskName: "Salary & Recovery Clearance", description: "Confirm no pending salary recoveries.", assignedToUserId: financeUser?.id },
    { department: "HR", taskName: "Exit Interview Completion", description: "Ensure exit interview form is submitted.", assignedToUserId: hrUser?.id },
    { department: "HR", taskName: "Relieving Documents", description: "Prepare relieving letter and experience certificate.", assignedToUserId: hrUser?.id },
    { department: "Manager", taskName: "Knowledge Transfer", description: "Ensure all knowledge transfer sessions are complete.", assignedToUserId: resolvedManagerId },
    { department: "Manager", taskName: "Work Handover", description: "Hand over all pending work to the designated colleague.", assignedToUserId: resolvedManagerId },
  ];

  const dueDate = actualLwd;

  // Resolve employee name + code once for notifications
  let empName = "an employee";
  let empCode = "";
  if (employeeId) {
    const [emp] = await db.select({
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
    }).from(employeesTable).where(eq(employeesTable.id, employeeId)).limit(1);
    if (emp) {
      empName = `${emp.firstName} ${emp.lastName}`;
      empCode = emp.employeeCode ?? "";
    }
  }

  // Cache assignee user lookups so we don't re-query for each task
  const assigneeCache = new Map<number, { email: string; name: string; employeeId: number | null }>();
  const resolveAssignee = async (userId: number) => {
    if (assigneeCache.has(userId)) return assigneeCache.get(userId)!;
    const [u] = await db.select({
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
      employeeId: hrmsUsersTable.employeeId,
    }).from(hrmsUsersTable).where(eq(hrmsUsersTable.id, userId)).limit(1);
    if (!u) return null as unknown as { email: string; name: string; employeeId: number | null };
    assigneeCache.set(userId, u);
    return u;
  };

  for (const task of defaultTasks) {
    await db.insert(exitClearanceTasksTable).values({
      exitRequestId,
      department: task.department,
      taskName: task.taskName,
      description: task.description,
      dueDate,
      assignedToUserId: task.assignedToUserId ?? null,
    });

    // Notify the assignee (if any) that a clearance task has been assigned to them
    if (task.assignedToUserId) {
      const assignee = await resolveAssignee(task.assignedToUserId);
      if (assignee?.email) {
        dispatchNotification({
          eventType: "exit_clearance_task_assigned",
          module: "exit",
          recipientEmail: assignee.email,
          recipientName: assignee.name,
          recipientEmployeeDbId: assignee.employeeId,
          variables: {
            recipientName: assignee.name,
            employeeName: empName,
            employeeId: empCode || String(employeeId ?? ""),
            department: task.department,
            taskName: task.taskName,
            taskDescription: task.description,
            dueDate: dueDate ?? "",
          },
          entityType: "exit_request",
          entityId: exitRequestId,
        }).catch(() => {});
      }
    }
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

    const conds: SQL<unknown>[] = [];
    if (status) conds.push(sql`${exitRequestsTable.status} = ${status}`);
    if (exitType) conds.push(sql`${exitRequestsTable.exitType} = ${exitType}`);

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

    // Employees using self-service may only submit Resignations; other exit types are HR-initiated
    if (!isHr && exitType !== "Resignation") {
      res.status(403).json({ error: "Employees may only submit resignation requests via self-service" }); return;
    }

    // Termination is a disciplinary action — only HR Manager or Super Admin may initiate it
    if (exitType === "Termination" && u.role !== "hr_manager" && u.role !== "super_admin") {
      res.status(403).json({ error: "Termination can only be initiated by HR Manager or Super Admin" }); return;
    }

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

    // Fetch contractual notice period from employee profile (takes precedence over employment-type defaults)
    const [empProfile] = await db.select({ noticePeriodDays: employeeProfilesTable.noticePeriodDays })
      .from(employeeProfilesTable)
      .where(eq(employeeProfilesTable.employeeId, empId))
      .limit(1);
    const contractualNoticePeriodDays = empProfile?.noticePeriodDays ?? null;

    // Compute notice period: contractual profile value → employment-type default → tenure heuristic
    const noticePeriodDays = computeNoticePeriodDays(emp.dateOfJoining, emp.employmentType, contractualNoticePeriodDays);

    // Enforce minimum LWD = today + noticePeriodDays (HR Manager / Super Admin may override)
    const canOverrideNotice = u.role === "hr_manager" || u.role === "super_admin";
    if (noticePeriodDays > 0 && !canOverrideNotice) {
      const minLwd = new Date();
      minLwd.setDate(minLwd.getDate() + noticePeriodDays);
      const minLwdStr = minLwd.toISOString().slice(0, 10);
      if (requestedLwd < minLwdStr) {
        res.status(400).json({
          error: `Last working date must be at least ${noticePeriodDays} day(s) from today (minimum: ${minLwdStr})`,
          noticePeriodDays,
          minimumLwd: minLwdStr,
        });
        return;
      }
    }

    // System auto-computes actualLwd = requestedLwd (employee is assumed to serve full notice).
    // HR may override actualLwd later via PATCH if notice is waived or bought out.
    const computedActualLwd = requestedLwd;

    const [exitReq] = await db.insert(exitRequestsTable).values({
      employeeId: empId,
      exitType,
      reason,
      requestedLwd,
      actualLwd: computedActualLwd,
      noticePeriodDays,
      status: "Submitted",
      initiatedByUserId: u.id,
    }).returning();

    // Mark employee status as Notice Period
    await db.update(employeesTable)
      .set({ status: "Notice Period", updatedAt: new Date() })
      .where(eq(employeesTable.id, empId));

    await logAudit({ user: u, action: "create_exit_request", module: "exit", recordId: exitReq.id });

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

    // Mask exit-interview responses for hr_executive — only hr_manager and super_admin may view them
    const canReadResponses = u.role === "hr_manager" || u.role === "super_admin";
    const exitInterview = interview
      ? { ...interview, responses: canReadResponses ? interview.responses : [] }
      : null;

    const enriched = await enrichExitRequest(exitReq);
    res.json({ ...enriched, clearanceTasks, fnfComputation: fnf ?? null, exitInterview });
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
      // Idempotency guard: only auto-generate clearance tasks (and dispatch assignment notifications)
      // the first time the request enters Clearance Pending. Repeated PUTs must not re-spam assignees.
      const existingTasks = await db.select({ id: exitClearanceTasksTable.id })
        .from(exitClearanceTasksTable)
        .where(eq(exitClearanceTasksTable.exitRequestId, id))
        .limit(1);
      if (existingTasks.length === 0) {
        await autoGenerateClearanceTasks(id, lwd, existing.employeeId);
      }
    }

    if (status === "Separated") {
      updates.separatedAt = new Date();
      const lwd = actualLwd ?? existing.actualLwd ?? existing.requestedLwd;
      const lwdDate = lwd ? new Date(lwd) : new Date();
      const lwdPlus1 = new Date(lwdDate);
      lwdPlus1.setDate(lwdPlus1.getDate() + 1);
      const now = new Date();
      if (now >= lwdPlus1) {
        // LWD+1 has passed — revoke system access immediately on both tables
        await db.update(employeesTable)
          .set({ status: "Separated", isActive: false, updatedAt: new Date() })
          .where(eq(employeesTable.id, existing.employeeId));
        await db.update(hrmsUsersTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(hrmsUsersTable.employeeId, existing.employeeId));
      } else {
        // LWD+1 is in the future — mark as Separated but keep access until LWD+1
        await db.update(employeesTable)
          .set({ status: "Separated", updatedAt: new Date() })
          .where(eq(employeesTable.id, existing.employeeId));
      }
    }

    const [updated] = await db.update(exitRequestsTable).set(updates)
      .where(eq(exitRequestsTable.id, id)).returning();

    await logAudit({ user: u, action: "update_exit_request", module: "exit", recordId: id });

    // Notify employee on rejection (only on transition into Rejected — avoid resending on repeat PUTs).
    // Fire-and-forget so notification lookup/dispatch failures cannot fail the business request.
    if (status === "Rejected" && existing.status !== "Rejected") {
      void (async () => {
        try {
          const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
            .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, existing.employeeId)).limit(1);
          if (empUser?.email) {
            await dispatchNotification({
              eventType: "exit_request_rejected", module: "exit",
              recipientEmail: empUser.email, recipientName: empUser.name,
              recipientEmployeeDbId: existing.employeeId,
              variables: {
                recipientName: empUser.name,
                submittedDate: existing.createdAt ? new Date(existing.createdAt).toLocaleDateString("en-IN") : "",
                reason: hrRemarks ?? existing.hrRemarks ?? "",
              },
              entityType: "exit_request", entityId: id,
            });
          }
        } catch (e) { console.error("[exit] rejection notification failed:", e); }
      })();
    }

    // Notify employee of status change
    // "FnF Pending" is the real clearance-complete event (all clearance tasks done → FnF initiated)
    if (status === "Clearance Pending" || status === "FnF Pending" || status === "Separated") {
      const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
        .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, existing.employeeId)).limit(1);
      const isCompletion = status === "FnF Pending" || status === "Separated";
      const eventType = isCompletion ? "exit_clearance_done" : "exit_initiated";
      // Notify the employee that their exit clearance is complete (or in progress)
      if (empUser?.email) {
        dispatchNotification({
          eventType, module: "exit",
          recipientEmail: empUser.email, recipientName: empUser.name,
          recipientEmployeeDbId: existing.employeeId,
          variables: { status, recipientName: empUser.name },
          entityType: "exit_request", entityId: id,
        }).catch(() => {});
      }
      // On completion, also notify HR + Finance to initiate FnF
      if (isCompletion) {
        (async () => {
          const hrUsers = await getUsersByRoles(["super_admin", "hr_manager", "payroll_admin"]);
          const empName = empUser?.name ?? "An employee";
          await Promise.allSettled(hrUsers.map(hr =>
            dispatchNotification({
              eventType: "exit_clearance_completed", module: "exit",
              recipientEmail: hr.email, recipientName: hr.name,
              recipientEmployeeDbId: hr.employeeId,
              variables: { employeeName: empName, employeeId: String(existing.employeeId), recipientName: hr.name },
              entityType: "exit_request", entityId: id,
            })
          ));
        })().catch(() => {});
      }
    }

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
      const [exitReq] = await db.update(exitRequestsTable)
        .set({ status: "FnF Pending", updatedAt: new Date() })
        .where(eq(exitRequestsTable.id, task.exitRequestId)).returning();

      // Notify the employee that exit clearance is complete, and HR/Finance to initiate FnF
      if (exitReq) {
        const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
          .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, exitReq.employeeId)).limit(1);
        if (empUser?.email) {
          dispatchNotification({
            eventType: "exit_clearance_done", module: "exit",
            recipientEmail: empUser.email, recipientName: empUser.name,
            recipientEmployeeDbId: exitReq.employeeId,
            variables: { status: "FnF Pending", recipientName: empUser.name },
            entityType: "exit_request", entityId: exitReq.id,
          }).catch(() => {});
        }
        (async () => {
          const hrUsers = await getUsersByRoles(["super_admin", "hr_manager", "payroll_admin"]);
          const empName = empUser?.name ?? "An employee";
          await Promise.allSettled(hrUsers.map(hr =>
            dispatchNotification({
              eventType: "exit_clearance_completed", module: "exit",
              recipientEmail: hr.email, recipientName: hr.name,
              recipientEmployeeDbId: hr.employeeId,
              variables: { employeeName: empName, employeeId: String(exitReq.employeeId), recipientName: hr.name },
              entityType: "exit_request", entityId: exitReq.id,
            })
          ));
        })().catch(() => {});
      }
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
      .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth))
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
      available: sql<string>`(${leaveBalancesTable.allocated}::numeric - ${leaveBalancesTable.used}::numeric - ${leaveBalancesTable.pending}::numeric + ${leaveBalancesTable.carryForward}::numeric)`,
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

    // Gate: all clearance tasks must be Completed or Waived before FnF can be computed
    const clearanceTasks = await db.select({ id: exitClearanceTasksTable.id, status: exitClearanceTasksTable.status })
      .from(exitClearanceTasksTable)
      .where(eq(exitClearanceTasksTable.exitRequestId, exitRequestId));
    const incomplete = clearanceTasks.filter((t) => t.status !== "Completed" && t.status !== "Waived");
    if (incomplete.length > 0) {
      res.status(422).json({
        error: `Cannot compute FnF: ${incomplete.length} clearance task(s) are still pending. All clearance tasks must be Completed or Waived first.`,
        pendingTaskCount: incomplete.length,
      });
      return;
    }

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

    await logAudit({ user: u, action: "compute_fnf", module: "exit", recordId: fnf.id });

    // Notify Finance (payroll_admin) and HR Manager / Super Admin that FnF is ready for approval.
    (async () => {
      const [emp] = await db.select({
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        employeeCode: employeesTable.employeeId,
      }).from(employeesTable).where(eq(employeesTable.id, exitReq.employeeId)).limit(1);
      const empName = emp ? `${emp.firstName} ${emp.lastName}` : "an employee";
      const empCodeStr = emp?.employeeCode ?? String(exitReq.employeeId);
      const approvers = await getUsersByRoles(["super_admin", "hr_manager", "payroll_admin"]);
      await Promise.allSettled(approvers.map(a =>
        dispatchNotification({
          eventType: "fnf_pending_approval", module: "exit",
          recipientEmail: a.email, recipientName: a.name,
          recipientEmployeeDbId: a.employeeId,
          variables: {
            recipientName: a.name,
            employeeName: empName,
            employeeId: empCodeStr,
            totalPayable: String(Math.max(0, totalPayable)),
            computedBy: u.name ?? "the payroll team",
          },
          entityType: "exit_request", entityId: exitRequestId,
        })
      ));
    })().catch(() => {});

    res.json(fnf);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── APPROVE FnF ──────────────────────────────────────────────────────────────
// approverLane is derived server-side from the user's session role — never trusted from the request body.
// HR Manager + Super Admin → HR approval lane
// Payroll Admin → Finance approval lane
// HR Executive → not permitted to approve FnF
router.post("/exit/requests/:id/fnf/approve", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const exitRequestId = Number(req.params.id);
    const { remarks } = req.body;

    // Derive approver lane — only hr_manager/super_admin can approve as HR; payroll_admin as Finance
    let approverLane: "hr" | "finance";
    if (u.role === "hr_manager" || u.role === "super_admin") {
      approverLane = "hr";
    } else if (u.role === "payroll_admin") {
      approverLane = "finance";
    } else {
      res.status(403).json({ error: "Only HR Manager, Super Admin, or Payroll Admin can approve FnF" }); return;
    }

    const [fnf] = await db.select().from(fnfComputationsTable)
      .where(eq(fnfComputationsTable.exitRequestId, exitRequestId));
    if (!fnf) { res.status(404).json({ error: "FnF computation not found — compute FnF first" }); return; }
    const wasFullyApprovedBefore = !!(fnf.hrApprovedAt && fnf.financeApprovedAt);

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

      // Auto-generate Relieving Letter & Experience Certificate at FnF approval
      if (exitReq) {
        const [emp] = await db.select({
          id: employeesTable.id,
          firstName: employeesTable.firstName,
          lastName: employeesTable.lastName,
          employeeCode: employeesTable.employeeId,
          dateOfJoining: employeesTable.dateOfJoining,
        }).from(employeesTable).where(eq(employeesTable.id, exitReq.employeeId));

        for (const docType of ["Relieving Letter", "Experience Certificate"] as const) {
          const [tmpl] = await db.select().from(documentTemplatesTable)
            .where(and(eq(documentTemplatesTable.documentType, docType), eq(documentTemplatesTable.isActive, true)))
            .limit(1);
          if (tmpl && emp) {
            try {
              const autoFields: Record<string, string> = {
                employeeName: `${emp.firstName} ${emp.lastName}`,
                employeeCode: emp.employeeCode ?? "",
                dateOfJoining: emp.dateOfJoining ?? "",
                lastWorkingDay: exitReq.actualLwd ?? exitReq.requestedLwd ?? "",
                currentDate: new Date().toLocaleDateString("en-IN"),
              };
              const bodyText = substituteTemplate(tmpl.bodyTemplate, autoFields);
              const pdfBuffer = await generatePdf({
                companyName: tmpl.companyName ?? "Automystics Technologies",
                companyAddress: tmpl.companyAddress ?? "",
                headerText: tmpl.headerText ?? "",
                footerText: tmpl.footerText ?? "",
                bodyText,
                title: docType,
              });
              const filename = `${docType.replace(/ /g, "_")}_${emp.employeeCode ?? emp.id}_${Date.now()}.pdf`;
              await db.insert(issuedDocumentsTable).values({
                employeeId: exitReq.employeeId,
                templateId: tmpl.id,
                documentType: docType,
                filename,
                generatedBy: u.id,
                fieldValues: autoFields,
                fileContent: pdfBuffer.toString("base64"),
              });
            } catch (docErr) {
              console.error(`[FnF] Failed to issue ${docType} for employee ${exitReq.employeeId}:`, docErr);
            }
          }
        }
      }
    }

    await logAudit({ user: u, action: "approve_fnf", module: "exit", recordId: fnf.id });

    // Notify the employee that their FnF is fully approved and relieving documents have been issued.
    // Idempotency: only fire on the transition from "not fully approved" → "fully approved" so a repeat
    // approve call by either lane cannot resend the closure email.
    // Fire-and-forget so notification failures cannot break the approval response.
    if (fullyApproved && !wasFullyApprovedBefore) {
      void (async () => {
        try {
          const [exitReqAfter] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
          if (!exitReqAfter) return;
          const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
            .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, exitReqAfter.employeeId)).limit(1);
          if (empUser?.email) {
            await dispatchNotification({
              eventType: "fnf_approved", module: "exit",
              recipientEmail: empUser.email, recipientName: empUser.name,
              recipientEmployeeDbId: exitReqAfter.employeeId,
              variables: {
                recipientName: empUser.name,
                totalPayable: String(updated.totalPayable ?? ""),
              },
              entityType: "exit_request", entityId: exitRequestId,
            });
          }
        } catch (e) { console.error("[exit] fnf_approved notification failed:", e); }
      })();
    }

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
      // Only HR Manager and Super Admin can view interview responses (per policy)
      const canSeeResponses = u.role === "hr_manager" || u.role === "super_admin";
      if (!canSeeResponses) {
        res.json({ ...interview, responses: [] });
      } else {
        res.json(interview);
      }
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CONFIGURE EXIT INTERVIEW QUESTIONS ───────────────────────────────────────
// HR Manager / Super Admin can set custom interview questions for a specific request
router.put("/exit/requests/:id/interview/questions", requireHrmsUser, requireRole("hr_manager", "super_admin"), async (req, res) => {
  try {
    const exitRequestId = Number(req.params.id);
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: "questions must be a non-empty array of { id, question } objects" }); return;
    }

    const [exitReq] = await db.select().from(exitRequestsTable).where(eq(exitRequestsTable.id, exitRequestId));
    if (!exitReq) { res.status(404).json({ error: "Exit request not found" }); return; }

    const [existing] = await db.select().from(exitInterviewsTable)
      .where(eq(exitInterviewsTable.exitRequestId, exitRequestId));

    if (existing) {
      const [updated] = await db.update(exitInterviewsTable)
        .set({ questions })
        .where(eq(exitInterviewsTable.id, existing.id)).returning();
      res.json(updated);
    } else {
      const [newInterview] = await db.insert(exitInterviewsTable).values({
        exitRequestId,
        employeeId: exitReq.employeeId,
        questions,
        responses: [],
      }).returning();
      res.json(newInterview);
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── RETIREMENT & CONTRACT EXPIRY ALERTS ──────────────────────────────────────
// Returns employees approaching retirement (60 days to 60th birthday) and
// Contract Expiry exit requests within the next 30 days.
router.get("/exit/alerts", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const today = new Date();

    // Retirement alerts: employees turning 60 within the next 60 days
    const allActive = await db.select({
      id: employeesTable.id,
      employeeId: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      dateOfBirth: employeesTable.dateOfBirth,
      dateOfJoining: employeesTable.dateOfJoining,
      departmentId: employeesTable.departmentId,
    }).from(employeesTable)
      .where(and(eq(employeesTable.isActive, true), sql`date_of_birth IS NOT NULL`));

    const retirementAlerts = allActive.filter(emp => {
      if (!emp.dateOfBirth) return false;
      const dob = new Date(emp.dateOfBirth);
      const retirementDate = new Date(dob);
      retirementDate.setFullYear(retirementDate.getFullYear() + 60);
      const daysToRetirement = Math.ceil((retirementDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysToRetirement >= 0 && daysToRetirement <= 60;
    }).map(emp => {
      const dob = new Date(emp.dateOfBirth!);
      const retirementDate = new Date(dob);
      retirementDate.setFullYear(retirementDate.getFullYear() + 60);
      const daysToRetirement = Math.ceil((retirementDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...emp, retirementDate: retirementDate.toISOString().slice(0, 10), daysToRetirement };
    });

    // Contract expiry alerts: exit requests with exitType "Contract Expiry" and LWD within 30 days
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const thirtyStr = thirtyDaysFromNow.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const contractExpiries = await db.select({
      exitRequestId: exitRequestsTable.id,
      employeeId: exitRequestsTable.employeeId,
      requestedLwd: exitRequestsTable.requestedLwd,
      actualLwd: exitRequestsTable.actualLwd,
      status: exitRequestsTable.status,
    }).from(exitRequestsTable)
      .where(and(
        eq(exitRequestsTable.exitType, "Contract Expiry"),
        sql`COALESCE(actual_lwd, requested_lwd) BETWEEN ${todayStr} AND ${thirtyStr}`,
      ));

    res.json({
      retirementAlerts,
      contractExpiryAlerts: contractExpiries,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PROCESS LWD+1 ACCESS REVOCATIONS ─────────────────────────────────────────
// HR or cron can call this daily to revoke system access for employees whose
// last working day was yesterday (or earlier) and who are still active.
router.post("/exit/process-access-revocations", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    // Find exit requests where LWD < today and employee is still active
    const pendingRevocations = await db.select({
      exitRequestId: exitRequestsTable.id,
      employeeId: exitRequestsTable.employeeId,
      actualLwd: exitRequestsTable.actualLwd,
      requestedLwd: exitRequestsTable.requestedLwd,
    }).from(exitRequestsTable)
      .leftJoin(employeesTable, eq(exitRequestsTable.employeeId, employeesTable.id))
      .where(and(
        sql`COALESCE(${exitRequestsTable.actualLwd}, ${exitRequestsTable.requestedLwd}) < ${todayStr}`,
        eq(employeesTable.isActive, true),
        or(
          eq(exitRequestsTable.status, "Separated"),
          eq(exitRequestsTable.status, "FnF Approved"),
        ),
      ));

    const revokedIds: number[] = [];
    for (const r of pendingRevocations) {
      await db.update(employeesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(employeesTable.id, r.employeeId));
      // Also deactivate linked HRMS user account to block system login
      await db.update(hrmsUsersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(hrmsUsersTable.employeeId, r.employeeId));
      revokedIds.push(r.employeeId);
    }

    res.json({ revokedCount: revokedIds.length, revokedEmployeeIds: revokedIds });
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
