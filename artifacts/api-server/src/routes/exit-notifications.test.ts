/**
 * End-to-end tests for the exit workflow notification chain.
 *
 * Strategy mirrors `helpdesk-notifications.test.ts`: mock `db`, `auth`,
 * `notification-service`, `system-config`, `audit`, `pdf`, and
 * `document-tokens`; mount the real exit router on Express; drive the
 * routes via HTTP; assert on captured `dispatchNotification` calls.
 *
 * Coverage:
 *  - Submit → Approve (Clearance Pending) — fires per-task assignment +
 *    employee `exit_initiated` notifications.
 *  - Repeat Approve — does NOT regenerate tasks or re-spam assignees
 *    (idempotency guard).
 *  - Complete final clearance task — auto-flips to FnF Pending and fires
 *    `exit_clearance_done` (employee) + `exit_clearance_completed` (HR).
 *  - Compute FnF — fires `fnf_pending_approval` to all approvers.
 *  - Approve FnF (HR then Finance) — only the SECOND approval (full) fires
 *    `fnf_approved` to the employee.
 *  - Repeat full FnF approve — does NOT re-fire the closure email.
 *  - Reject exit request — fires `exit_request_rejected`; second reject
 *    does not resend.
 *  - Scheduler `remindOverdueExitClearanceTasks` — fires
 *    `exit_clearance_task_overdue` per overdue task, suppresses tasks
 *    already nudged today, and pins channels to ["whatsapp"].
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── DB MOCK (per-table FIFO queues, same shape as helpdesk test) ────────────
type Row = Record<string, unknown>;

type SelectChain<T> = Promise<T[]> & {
  where: (...args: unknown[]) => SelectChain<T>;
  orderBy: (...args: unknown[]) => SelectChain<T>;
  limit: (...args: unknown[]) => SelectChain<T>;
  leftJoin: (...args: unknown[]) => SelectChain<T>;
  innerJoin: (...args: unknown[]) => SelectChain<T>;
};
type InsertChain<T> = Promise<void> & { returning: (...args: unknown[]) => Promise<T[]> };
type UpdateWhereChain<T> = Promise<void> & { returning: () => Promise<T[]> };
type UpdateChain = { set: (values: Row) => { where: (...args: unknown[]) => UpdateWhereChain<Row> } };

const dbState: {
  selectQueues: Map<unknown, Array<Row[]>>;
  updateReturnQueues: Map<unknown, Array<Row[]>>;
  inserted: Array<{ table: unknown; rows: Row[] }>;
  updated: Array<{ table: unknown; values: Row }>;
  nextId: number;
} = { selectQueues: new Map(), updateReturnQueues: new Map(), inserted: [], updated: [], nextId: 100 };

function queueSelect(table: unknown, rows: Row[]) {
  const q = dbState.selectQueues.get(table) ?? [];
  q.push(rows);
  dbState.selectQueues.set(table, q);
}
function dequeueSelect(table: unknown): Row[] {
  const q = dbState.selectQueues.get(table);
  return q && q.length ? q.shift()! : [];
}
function makeSelectChain(table: unknown): SelectChain<Row> {
  const base = Promise.resolve().then(() => dequeueSelect(table));
  const chain = base as SelectChain<Row>;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  return chain;
}
function makeInsertChain(table: unknown, values: Row | Row[]): InsertChain<Row> {
  const rows = Array.isArray(values) ? values : [values];
  dbState.inserted.push({ table, rows });
  const generated: Row[] = rows.map((r) => ({ ...r, id: dbState.nextId++, createdAt: new Date() }));
  const base = Promise.resolve();
  const chain = base as InsertChain<Row>;
  chain.returning = () => Promise.resolve(generated);
  return chain;
}
function makeUpdateChain(table: unknown): UpdateChain {
  return {
    set: (values: Row) => {
      dbState.updated.push({ table, values });
      const base = Promise.resolve();
      const whereChain = base as UpdateWhereChain<Row>;
      whereChain.returning = () => {
        // If a per-call update return is queued, prefer it (so tests can
        // simulate the real DB merging unset columns). Fall back to echoing
        // the SET values plus an id so simple paths stay terse.
        const q = dbState.updateReturnQueues.get(table);
        if (q && q.length) {
          const next = q.shift()!;
          return Promise.resolve(next);
        }
        return Promise.resolve([{ ...values, id: 1 }]);
      };
      return { where: () => whereChain };
    },
  };
}
function queueUpdateReturn(table: unknown, rows: Row[]) {
  const q = dbState.updateReturnQueues.get(table) ?? [];
  q.push(rows);
  dbState.updateReturnQueues.set(table, q);
}

vi.mock("../lib/db", () => ({
  db: {
    select: (_projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    insert: (t: unknown) => ({ values: (v: Row | Row[]) => makeInsertChain(t, v) }),
    update: (t: unknown) => makeUpdateChain(t),
    delete: (_t: unknown) => ({ where: async () => undefined }),
  },
}));

// ─── AUTH MOCK ──────────────────────────────────────────────────────────────
type TestUser = { id: number; role: string; name?: string; email?: string; employeeId?: number | null };
type ReqWithUser = Request & { hrmsUser?: TestUser };

vi.mock("../lib/auth", () => ({
  requireHrmsUser: (req: ReqWithUser, res: Response, next: NextFunction) => {
    const raw = req.headers["x-test-user"];
    if (typeof raw !== "string") { res.status(401).json({ error: "no test user" }); return; }
    req.hrmsUser = JSON.parse(raw) as TestUser;
    next();
  },
  requireRole: (...roles: string[]) =>
    (req: ReqWithUser, res: Response, next: NextFunction) => {
      const role = req.hrmsUser?.role;
      if (!role || !roles.includes(role)) { res.status(403).json({ error: "forbidden" }); return; }
      next();
    },
}));

// ─── NOTIFICATION SERVICE MOCK ──────────────────────────────────────────────
type DispatchCall = {
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: number;
  channels?: Array<"email" | "whatsapp">;
};
const dispatchCalls: DispatchCall[] = [];
vi.mock("../lib/notification-service", () => ({
  dispatchNotification: vi.fn(async (params: DispatchCall) => {
    dispatchCalls.push(params);
  }),
}));

// ─── SYSTEM CONFIG / AUDIT / PDF / DOCUMENT-TOKENS MOCKS ────────────────────
type HrUserRow = { id: number; email: string; name: string; employeeId: number | null };
const systemConfigState: { hrUsers: HrUserRow[] } = { hrUsers: [] };
vi.mock("./system-config", () => ({
  getUsersByRoles: vi.fn(async () => systemConfigState.hrUsers),
}));

vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../lib/pdf", () => ({
  generatePdf: vi.fn(async () => Buffer.from("pdf")),
  substituteTemplate: vi.fn((tpl: string) => tpl),
}));
vi.mock("../lib/document-tokens", () => ({
  issueDocumentDownloadToken: vi.fn(async () => ({
    url: "https://example.test/doc/abc",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })),
  getAppBaseUrl: vi.fn(() => "https://example.test"),
}));

// Import the router AFTER mocks are set up.
process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./exit");
const {
  exitRequestsTable, exitClearanceTasksTable, fnfComputationsTable,
  hrmsUsersTable, employeesTable, employeeProfilesTable, departmentsTable,
  documentTemplatesTable,
} = await import("@workspace/db/schema");

// ─── HTTP SERVER ────────────────────────────────────────────────────────────
let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  dbState.selectQueues.clear();
  dbState.inserted = [];
  dbState.updated = [];
  dbState.nextId = 100;
  dispatchCalls.length = 0;
  systemConfigState.hrUsers = [];

  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

function userHeader(u: TestUser): Record<string, string> {
  return { "x-test-user": JSON.stringify(u), "content-type": "application/json" };
}

// Many exit-route notifications are fire-and-forget (`.catch()` or wrapped in
// `void (async () => {…})()`), so the HTTP response can return before all
// dispatches have settled. Yield the event loop a few times so queued
// microtasks/promise chains finish before assertions run.
async function flushAsync(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}
// Use this when the route fires deeply-nested `void (async () => {…})()`
// dispatches that include their own `await` chains (FnF approval, e.g.).
async function flushAsyncDeep() {
  await new Promise((r) => setTimeout(r, 100));
  await flushAsync(5);
}

// Convenience: queue the four assignee-resolution role lookups + dept/HOD/emp
// rows that `autoGenerateClearanceTasks` issues, plus the per-unique-assignee
// resolveAssignee selects (cached, so 4 selects for 4 unique users).
function queueAutoGenerateLookups(opts: {
  hrUserId: number; financeUserId: number; adminUserId: number;
  hodUserId: number; departmentId: number;
  employeeName: { firstName: string; lastName: string; employeeCode: string };
  assigneeRows: Array<{ id: number; email: string; name: string; employeeId: number | null }>;
}) {
  queueSelect(hrmsUsersTable, [{ id: opts.hrUserId }]);
  queueSelect(hrmsUsersTable, [{ id: opts.financeUserId }]);
  queueSelect(hrmsUsersTable, [{ id: opts.adminUserId }]);
  queueSelect(employeesTable, [{ departmentId: opts.departmentId }]);
  queueSelect(hrmsUsersTable, [{ id: opts.hodUserId }]);
  queueSelect(employeesTable, [opts.employeeName]);
  // resolveAssignee is cached by user id — order is encounter order in the
  // task list (IT[admin], Finance[finance], HR[hr], Manager[hod]).
  for (const a of opts.assigneeRows) queueSelect(hrmsUsersTable, [a]);
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("PUT /exit/requests/:id — Clearance Pending transition", () => {
  it("auto-generates 8 tasks and notifies each unique assignee + the employee", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // existing exit request
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "Submitted", requestedLwd: "2025-12-31",
      actualLwd: null, hrRemarks: null, createdAt: new Date(),
    }]);
    // existingTasks check (idempotency) — empty, so autogen runs
    queueSelect(exitClearanceTasksTable, []);
    // autoGenerateClearanceTasks lookups
    queueAutoGenerateLookups({
      hrUserId: 7, financeUserId: 8, adminUserId: 9, hodUserId: 10, departmentId: 3,
      employeeName: { firstName: "Asha", lastName: "Raiser", employeeCode: "E11" },
      assigneeRows: [
        // First task encountered is IT → adminUser (id 9), then Finance(8), HR(7), Manager(10)
        { id: 9, email: "admin@co.test", name: "Admin User", employeeId: 90 },
        { id: 8, email: "finance@co.test", name: "Finance User", employeeId: 80 },
        { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
        { id: 10, email: "hod@co.test", name: "HOD User", employeeId: 100 },
      ],
    });
    // enrichExitRequest after the .returning()
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11", departmentId: 3 }]);
    queueSelect(departmentsTable, [{ name: "Engineering" }]);
    // employee user lookup for exit_initiated
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/exit/requests/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Clearance Pending" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    // 8 task-assignment dispatches (one per task with an assignee)
    const taskCalls = dispatchCalls.filter((c) => c.eventType === "exit_clearance_task_assigned");
    expect(taskCalls).toHaveLength(8);
    // Recipients are the 4 unique users; admin/finance/hr/hod each get 2 tasks
    const counts = new Map<string, number>();
    for (const c of taskCalls) counts.set(c.recipientEmail!, (counts.get(c.recipientEmail!) ?? 0) + 1);
    expect(counts.get("admin@co.test")).toBe(2);
    expect(counts.get("finance@co.test")).toBe(2);
    expect(counts.get("hr@co.test")).toBe(2);
    expect(counts.get("hod@co.test")).toBe(2);

    // exit_initiated to the employee
    const initiated = dispatchCalls.filter((c) => c.eventType === "exit_initiated");
    expect(initiated).toHaveLength(1);
    expect(initiated[0].recipientEmail).toBe("asha@co.test");
    expect(initiated[0].entityType).toBe("exit_request");
    expect(initiated[0].entityId).toBe(5);
  });

  it("does NOT regenerate tasks or re-notify assignees on a repeat Clearance Pending PUT", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "Clearance Pending", requestedLwd: "2025-12-31",
      actualLwd: "2025-12-31", hrRemarks: null, createdAt: new Date(),
    }]);
    // existingTasks check — already populated, so autogen is skipped
    queueSelect(exitClearanceTasksTable, [{ id: 100 }]);
    // enrichExitRequest
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11", departmentId: 3 }]);
    queueSelect(departmentsTable, [{ name: "Engineering" }]);
    // exit_initiated employee lookup still fires (status block runs unconditionally)
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/exit/requests/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Clearance Pending" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    // No assignment notifications second time around
    expect(dispatchCalls.filter((c) => c.eventType === "exit_clearance_task_assigned")).toHaveLength(0);
    // Status notification still fires (this is the design — only task autogen is gated)
    expect(dispatchCalls.filter((c) => c.eventType === "exit_initiated")).toHaveLength(1);
  });
});

describe("PUT /exit/requests/:id — rejection", () => {
  it("notifies the employee on transition into Rejected and not on repeat", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // First reject — was Submitted
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "Submitted", hrRemarks: null,
      createdAt: new Date("2025-01-15"),
    }]);
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11", departmentId: 3 }]);
    queueSelect(departmentsTable, [{ name: "Engineering" }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res1 = await fetch(`${baseUrl}/exit/requests/5`, {
      method: "PUT", headers: userHeader(hr),
      body: JSON.stringify({ status: "Rejected", hrRemarks: "Withdrawn after discussion" }),
    });
    expect(res1.status).toBe(200);
    await flushAsync();

    const rejections = dispatchCalls.filter((c) => c.eventType === "exit_request_rejected");
    expect(rejections).toHaveLength(1);
    expect(rejections[0].recipientEmail).toBe("asha@co.test");
    expect(rejections[0].variables?.reason).toBe("Withdrawn after discussion");

    // Second reject — already Rejected, must NOT resend
    dispatchCalls.length = 0;
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "Rejected", hrRemarks: "Withdrawn after discussion",
      createdAt: new Date("2025-01-15"),
    }]);
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11", departmentId: 3 }]);
    queueSelect(departmentsTable, [{ name: "Engineering" }]);

    const res2 = await fetch(`${baseUrl}/exit/requests/5`, {
      method: "PUT", headers: userHeader(hr),
      body: JSON.stringify({ status: "Rejected", hrRemarks: "Updated note" }),
    });
    expect(res2.status).toBe(200);
    await flushAsync();
    expect(dispatchCalls.filter((c) => c.eventType === "exit_request_rejected")).toHaveLength(0);
  });
});

describe("PUT /exit/clearance-tasks/:taskId — final task completion", () => {
  it("flips to FnF Pending and notifies employee + HR/Finance broadcast", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // Load the task being updated
    queueSelect(exitClearanceTasksTable, [{
      id: 200, exitRequestId: 5, status: "Pending", assignedToUserId: 7,
    }]);
    // After update, allTasks check — only one task, completion makes allDone = true
    queueSelect(exitClearanceTasksTable, [{ id: 200, status: "Pending" }]);
    // employee lookup for exit_clearance_done
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    systemConfigState.hrUsers = [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 8, email: "finance@co.test", name: "Finance User", employeeId: 80 },
    ];

    const res = await fetch(`${baseUrl}/exit/clearance-tasks/200`, {
      method: "PUT", headers: userHeader(hr),
      body: JSON.stringify({ status: "Completed", remarks: "All set" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    const empNotices = dispatchCalls.filter((c) => c.eventType === "exit_clearance_done");
    expect(empNotices).toHaveLength(1);
    expect(empNotices[0].recipientEmail).toBe("asha@co.test");

    const hrBroadcast = dispatchCalls.filter((c) => c.eventType === "exit_clearance_completed");
    expect(hrBroadcast).toHaveLength(2);
    expect(new Set(hrBroadcast.map((c) => c.recipientEmail))).toEqual(
      new Set(["hr@co.test", "finance@co.test"]),
    );
  });

  it("does NOT broadcast when only some tasks are complete", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(exitClearanceTasksTable, [{
      id: 200, exitRequestId: 5, status: "Pending", assignedToUserId: 7,
    }]);
    // allTasks: this one + a still-pending sibling → allDone = false
    queueSelect(exitClearanceTasksTable, [
      { id: 200, status: "Pending" },
      { id: 201, status: "Pending" },
    ]);

    const res = await fetch(`${baseUrl}/exit/clearance-tasks/200`, {
      method: "PUT", headers: userHeader(hr),
      body: JSON.stringify({ status: "Completed" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();
    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("POST /exit/requests/:id/fnf — compute", () => {
  it("notifies all approvers when an FnF computation is created", async () => {
    const payroll: TestUser = { id: 8, role: "payroll_admin", name: "Finance User" };

    queueSelect(exitRequestsTable, [{ id: 5, employeeId: 11, status: "FnF Pending" }]);
    // Clearance gating — all complete
    queueSelect(exitClearanceTasksTable, [
      { id: 200, status: "Completed" },
      { id: 201, status: "Waived" },
    ]);
    // Existing FnF — none, so insert
    queueSelect(fnfComputationsTable, []);
    // Notification: employee lookup for name
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11" }]);

    systemConfigState.hrUsers = [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 8, email: "finance@co.test", name: "Finance User", employeeId: 80 },
      { id: 9, email: "admin@co.test", name: "Admin", employeeId: 90 },
    ];

    const res = await fetch(`${baseUrl}/exit/requests/5/fnf`, {
      method: "POST", headers: userHeader(payroll),
      body: JSON.stringify({
        pendingSalary: 50000, leaveEncashment: 10000, gratuity: 0,
        bonusProration: 0, noticePeriodLop: 0, otherDeductions: 0,
      }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    const calls = dispatchCalls.filter((c) => c.eventType === "fnf_pending_approval");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.recipientEmail))).toEqual(
      new Set(["hr@co.test", "finance@co.test", "admin@co.test"]),
    );
    expect(calls[0].variables?.totalPayable).toBe("60000");
    expect(calls[0].variables?.employeeName).toBe("Asha Raiser");
  });
});

describe("POST /exit/requests/:id/fnf/approve — dual-lane approval", () => {
  it("does NOT email the employee on the first (HR) approval, only on the second (Finance) full approval", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };
    const payroll: TestUser = { id: 8, role: "payroll_admin", name: "Finance User" };

    // ── HR approves first ──
    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: null, financeApprovedAt: null,
      totalPayable: "60000",
    }]);

    const res1 = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(hr), body: JSON.stringify({ remarks: "OK" }),
    });
    expect(res1.status).toBe(200);
    await flushAsync();
    expect(dispatchCalls.filter((c) => c.eventType === "fnf_approved")).toHaveLength(0);

    // ── Finance approves second — fully approved transition ──
    dispatchCalls.length = 0;
    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: new Date(), financeApprovedAt: null,
      totalPayable: "60000",
    }]);
    // The route only SETs financeApprovedAt on this call — the real DB
    // preserves the existing hrApprovedAt. Simulate that so the route's
    // `fullyApproved = !!(updated.hrApprovedAt && updated.financeApprovedAt)`
    // check flips true and the closure email is dispatched.
    queueUpdateReturn(fnfComputationsTable, [{
      id: 50, exitRequestId: 5,
      hrApprovedAt: new Date(), financeApprovedAt: new Date(),
      totalPayable: "60000",
    }]);
    // After update: re-select exitRequest for doc generation block
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "FnF Pending", requestedLwd: "2025-12-31", actualLwd: "2025-12-31",
    }]);
    // Employee lookup for doc autogen
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser", employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    // Document templates — none, so doc generation is skipped (no relieving_doc_link emails)
    queueSelect(documentTemplatesTable, []);
    queueSelect(documentTemplatesTable, []);
    // fnf_approved notification block: re-select exit + employee user
    queueSelect(exitRequestsTable, [{ id: 5, employeeId: 11, status: "FnF Approved" }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res2 = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(payroll), body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200);
    await flushAsyncDeep();

    const closure = dispatchCalls.filter((c) => c.eventType === "fnf_approved");
    expect(closure).toHaveLength(1);
    expect(closure[0].recipientEmail).toBe("asha@co.test");
    expect(closure[0].variables?.totalPayable).toBe("60000");

    // ── Repeat full-approve: no email re-sent ──
    dispatchCalls.length = 0;
    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: new Date(), financeApprovedAt: new Date(),
      totalPayable: "60000",
    }]);
    const res3 = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(hr), body: JSON.stringify({}),
    });
    expect(res3.status).toBe(200);
    await flushAsync();
    expect(dispatchCalls.filter((c) => c.eventType === "fnf_approved")).toHaveLength(0);
  });
});

describe("POST /exit/requests — submission stage", () => {
  it("dispatches exit_request_submitted to all HR roles with the right variables", async () => {
    const employee: TestUser = { id: 30, role: "employee", name: "Asha Raiser" };

    // Two HR users + one super_admin should be notified at submission time;
    // payroll_admin and hod must NOT be queued here because the route only
    // requests super_admin / hr_manager / hr_executive at this stage.
    systemConfigState.hrUsers = [
      { id: 1, name: "Super Admin", email: "admin@a.test", employeeId: 100 },
      { id: 2, name: "HR Manager", email: "hrm@a.test", employeeId: 101 },
      { id: 3, name: "HR Executive", email: "hre@a.test", employeeId: 102 },
    ];

    // getEmployeeForUser does TWO selects: first hrmsUsersTable for employeeId,
    // then employeesTable for the employee record.
    queueSelect(hrmsUsersTable, [{ employeeId: 11 }]);
    queueSelect(employeesTable, [{
      id: 11, dateOfJoining: "2020-01-01", employmentType: "Permanent", departmentId: 3,
    }]);
    // Then the route re-selects the employee row by id
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser", employeeId: "E11",
      dateOfJoining: "2020-01-01", employmentType: "Permanent", departmentId: 3,
    }]);
    // employeeProfilesTable for contractual notice period override (set to 0
    // so the notice-period gate does not reject the request)
    queueSelect(employeeProfilesTable, [{ noticePeriodDays: 0 }]);
    // enrichExitRequest after insert
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser", employeeCode: "E11", departmentId: 3 }]);
    queueSelect(departmentsTable, [{ name: "Engineering" }]);

    // requestedLwd far in the future so the notice-period gate passes
    const futureLwd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await fetch(`${baseUrl}/exit/requests`, {
      method: "POST", headers: userHeader(employee),
      body: JSON.stringify({ exitType: "Resignation", reason: "Personal", requestedLwd: futureLwd }),
    });
    expect(res.status).toBe(201);
    await flushAsyncDeep();

    const submitted = dispatchCalls.filter((c) => c.eventType === "exit_request_submitted");
    expect(submitted).toHaveLength(3);

    // Recipients cover every HR role; no payroll_admin / hod here.
    const emails = submitted.map((c) => c.recipientEmail).sort();
    expect(emails).toEqual(["admin@a.test", "hre@a.test", "hrm@a.test"]);

    // Variables carry the employee identity, exit type, and requested LWD so
    // the templates can render meaningful subject/body/whatsapp content.
    for (const call of submitted) {
      expect(call.module).toBe("exit");
      expect(call.entityType).toBe("exit_request");
      expect(call.variables.employeeName).toBe("Asha Raiser");
      expect(call.variables.employeeId).toBe("E11");
      expect(call.variables.exitType).toBe("Resignation");
      expect(call.variables.requestedLwd).toBe(futureLwd);
      expect(call.variables.reason).toBe("Personal");
    }
  });
});

describe("POST /exit/requests/:id/fnf/approve — relieving documents (happy path)", () => {
  it("issues docs and emails one relieving_doc_link per generated document", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };
    const payroll: TestUser = { id: 8, role: "payroll_admin", name: "Finance User" };

    // ── HR approves first (no dispatches expected) ──
    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: null, financeApprovedAt: null,
      totalPayable: "60000",
    }]);
    const res1 = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(hr), body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);
    await flushAsync();
    dispatchCalls.length = 0;

    // ── Finance approves second — full approval; docs WILL be issued ──
    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: new Date(), financeApprovedAt: null,
      totalPayable: "60000",
    }]);
    queueUpdateReturn(fnfComputationsTable, [{
      id: 50, exitRequestId: 5,
      hrApprovedAt: new Date(), financeApprovedAt: new Date(),
      totalPayable: "60000",
    }]);
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "FnF Pending",
      requestedLwd: "2025-12-31", actualLwd: "2025-12-31",
    }]);
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser", employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    // Active templates for both document types — this is the key difference
    // from the "no docs" test: the loop body actually runs, generates a PDF,
    // mints a download token, and queues a relieving_doc_link email.
    queueSelect(documentTemplatesTable, [{
      id: 401, documentType: "Relieving Letter", isActive: true,
      bodyTemplate: "Dear {{employeeName}}", companyName: "Automystics", companyAddress: "",
      headerText: "", footerText: "",
    }]);
    queueSelect(documentTemplatesTable, [{
      id: 402, documentType: "Experience Certificate", isActive: true,
      bodyTemplate: "Dear {{employeeName}}", companyName: "Automystics", companyAddress: "",
      headerText: "", footerText: "",
    }]);
    // fnf_approved IIFE: re-select exit + employee user
    queueSelect(exitRequestsTable, [{ id: 5, employeeId: 11, status: "FnF Approved" }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res2 = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(payroll), body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200);
    await flushAsyncDeep();

    // One closure email + one relieving_doc_link per document.
    const closure = dispatchCalls.filter((c) => c.eventType === "fnf_approved");
    expect(closure).toHaveLength(1);
    expect(closure[0].variables?.documentsIssued).toBe("true");

    const docLinks = dispatchCalls.filter((c) => c.eventType === "relieving_doc_link");
    expect(docLinks).toHaveLength(2);
    const docTypes = docLinks.map((c) => c.variables?.documentType).sort();
    expect(docTypes).toEqual(["Experience Certificate", "Relieving Letter"]);
    for (const c of docLinks) {
      expect(c.recipientEmail).toBe("asha@co.test");
      expect(c.variables?.downloadUrl).toBe("https://example.test/doc/abc");
      expect(c.variables?.expiresAt).toMatch(/\d/); // a formatted date string
      expect(c.entityType).toBe("exit_request");
      expect(c.entityId).toBe(5);
    }
  });

  it("skips relieving_doc_link emails when APP_URL is not configured (avoids broken links)", async () => {
    const { getAppBaseUrl } = await import("../lib/document-tokens");
    const spy = vi.mocked(getAppBaseUrl).mockReturnValueOnce("");
    const payroll: TestUser = { id: 8, role: "payroll_admin", name: "Finance User" };

    queueSelect(fnfComputationsTable, [{
      id: 50, exitRequestId: 5, hrApprovedAt: new Date(), financeApprovedAt: null,
      totalPayable: "60000",
    }]);
    queueUpdateReturn(fnfComputationsTable, [{
      id: 50, exitRequestId: 5,
      hrApprovedAt: new Date(), financeApprovedAt: new Date(),
      totalPayable: "60000",
    }]);
    queueSelect(exitRequestsTable, [{
      id: 5, employeeId: 11, status: "FnF Pending",
      requestedLwd: "2025-12-31", actualLwd: "2025-12-31",
    }]);
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser", employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    queueSelect(documentTemplatesTable, [{
      id: 401, documentType: "Relieving Letter", isActive: true,
      bodyTemplate: "x", companyName: "A", companyAddress: "", headerText: "", footerText: "",
    }]);
    queueSelect(documentTemplatesTable, [{
      id: 402, documentType: "Experience Certificate", isActive: true,
      bodyTemplate: "x", companyName: "A", companyAddress: "", headerText: "", footerText: "",
    }]);
    queueSelect(exitRequestsTable, [{ id: 5, employeeId: 11, status: "FnF Approved" }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/exit/requests/5/fnf/approve`, {
      method: "POST", headers: userHeader(payroll), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    expect(dispatchCalls.filter((c) => c.eventType === "fnf_approved")).toHaveLength(1);
    expect(dispatchCalls.filter((c) => c.eventType === "relieving_doc_link")).toHaveLength(0);
    spy.mockRestore();
  });
});

// ─── SCHEDULER: overdue exit clearance task WhatsApp nudge ──────────────────
describe("scheduler.remindOverdueExitClearanceTasks", () => {
  it("nudges only assignees of overdue tasks not already nudged today, on the WhatsApp channel", async () => {
    // Need to import scheduler AFTER mocks are in place.
    const { remindOverdueExitClearanceTasks } = await import("../lib/scheduler");
    const { exitClearanceTasksTable: ect, notificationLogsTable } =
      await import("@workspace/db/schema");

    // The function does a single big joined select on exitClearanceTasksTable.
    // We queue both the overdue rows and an empty notification-log lookup.
    queueSelect(ect, [
      {
        id: 200, exitRequestId: 5, taskName: "Asset Return", department: "IT",
        dueDate: "2025-01-01", assignedToUserId: 9,
        assigneeEmail: "admin@co.test", assigneeName: "Admin", assigneeEmployeeId: 90,
        employeeId: 11, employeeFirstName: "Asha", employeeLastName: "Raiser", employeeCode: "E11",
      },
      {
        id: 201, exitRequestId: 5, taskName: "Knowledge Transfer", department: "Manager",
        dueDate: "2025-01-02", assignedToUserId: 10,
        assigneeEmail: "hod@co.test", assigneeName: "HOD", assigneeEmployeeId: 100,
        employeeId: 11, employeeFirstName: "Asha", employeeLastName: "Raiser", employeeCode: "E11",
      },
    ]);
    // Today's notification logs — task 200 was already nudged → suppress
    queueSelect(notificationLogsTable, [
      { entityId: 200, recipientPhone: null, recipientEmail: "admin@co.test" },
    ]);
    // Two resolveAssigneePhone lookups (employees table); return null phones
    queueSelect(employeesTable, [{ phone: null }]);
    queueSelect(employeesTable, [{ phone: null }]);

    await remindOverdueExitClearanceTasks();
    await flushAsync();

    const overdueCalls = dispatchCalls.filter((c) => c.eventType === "exit_clearance_task_overdue");
    // Task 200 suppressed; only task 201 nudged
    expect(overdueCalls).toHaveLength(1);
    expect(overdueCalls[0].recipientEmail).toBe("hod@co.test");
    expect(overdueCalls[0].entityType).toBe("exit_clearance_task");
    expect(overdueCalls[0].entityId).toBe(201);
    expect(overdueCalls[0].channels).toEqual(["whatsapp"]);
    expect(overdueCalls[0].variables?.taskName).toBe("Knowledge Transfer");
    expect(overdueCalls[0].variables?.employeeName).toBe("Asha Raiser");
    expect(Number(overdueCalls[0].variables?.daysOverdue)).toBeGreaterThanOrEqual(1);
  });

  it("returns silently when there are no overdue tasks", async () => {
    const { remindOverdueExitClearanceTasks } = await import("../lib/scheduler");
    const { exitClearanceTasksTable: ect } = await import("@workspace/db/schema");
    queueSelect(ect, []);
    await remindOverdueExitClearanceTasks();
    await flushAsync();
    expect(dispatchCalls).toHaveLength(0);
  });
});

// Avoid unused-import lint errors for tables only used by name-binding above.
void employeeProfilesTable;
