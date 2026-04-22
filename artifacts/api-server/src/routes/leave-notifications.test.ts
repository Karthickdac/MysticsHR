/**
 * Route-level tests for the leave notification flows.
 *
 * Strategy mirrors `helpdesk-notifications.test.ts`: mock `db`, `auth`,
 * `notification-service`, `audit`, `payroll-lock`, and
 * `leave-attendance-sync`; mount the real leave router on Express; drive the
 * routes via HTTP. We assert on captured `dispatchNotification` calls so
 * every "who gets emailed when" rule on the leave routes is locked in.
 *
 * Coverage:
 *  - POST /leave/applications — submission notifies the first HOD with
 *    `leave_submitted`, including employee name + date range.
 *  - POST /leave/applications/:id/hr-action — Approved fires `leave_approved`
 *    to the applicant, Rejected fires `leave_rejected` (with the HR remarks
 *    forwarded as `reason`).
 *  - PUT /leave/applications/:id — HR editing the dates of an Approved
 *    request fires `leave_dates_edited` to the applicant AND to every
 *    previous approver (HOD + HR), with old/new dates in the variables.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── DB MOCK (per-table FIFO queues, same shape as helpdesk test) ───────────
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
  inserted: Array<{ table: unknown; rows: Row[] }>;
  updated: Array<{ table: unknown; values: Row }>;
  nextId: number;
} = { selectQueues: new Map(), inserted: [], updated: [], nextId: 100 };

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
      whereChain.returning = () => Promise.resolve([{ ...values, id: 1 }]);
      return { where: () => whereChain };
    },
  };
}

// db.transaction((tx) => fn(tx)) — run the callback against the same surface.
async function runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
  return fn({
    select: (_p?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    insert: (t: unknown) => ({ values: (v: Row | Row[]) => makeInsertChain(t, v) }),
    update: (t: unknown) => makeUpdateChain(t),
    delete: (_t: unknown) => ({ where: async () => undefined }),
  });
}

vi.mock("../lib/db", () => ({
  db: {
    select: (_projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    insert: (t: unknown) => ({ values: (v: Row | Row[]) => makeInsertChain(t, v) }),
    update: (t: unknown) => makeUpdateChain(t),
    delete: (_t: unknown) => ({ where: async () => undefined }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => runTransaction(fn),
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
  eventType: string; module: string;
  recipientEmail?: string; recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string; entityId?: number;
};
const dispatchCalls: DispatchCall[] = [];
vi.mock("../lib/notification-service", () => ({
  dispatchNotification: vi.fn(async (params: DispatchCall) => { dispatchCalls.push(params); }),
}));

// ─── ANCILLARY MOCKS ────────────────────────────────────────────────────────
vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../lib/payroll-lock", () => ({ checkPayrollLock: vi.fn(async () => null) }));
vi.mock("../lib/leave-attendance-sync", () => ({
  applyLeaveToAttendance: vi.fn(async () => undefined),
  revertLeaveFromAttendance: vi.fn(async () => undefined),
  revertLeaveDaysFromAttendance: vi.fn(async () => undefined),
  // Match the real helper: enumerate every YYYY-MM-DD between from and to.
  listDatesInRange: (from: string, to: string) => {
    const out: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  },
}));
vi.mock("../lib/carry-forward", () => ({
  runCarryForwardForYear: vi.fn(async () => undefined),
  CarryForwardLockedError: class extends Error {},
}));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./leave");
const {
  leaveApplicationsTable, leaveTypesTable, leaveBalancesTable, blackoutDatesTable,
  hrmsUsersTable, employeesTable,
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

// dispatchNotification on the leave routes is fire-and-forget (`.catch()`),
// so we need to flush the event loop a few times before asserting.
async function flushAsync(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /leave/applications — submission", () => {
  it("notifies the HOD with leave_submitted when an employee files leave", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeForUser → hrmsUsers + employees
    queueSelect(hrmsUsersTable, [{ employeeId: 11 }]);
    queueSelect(employeesTable, [{ id: 11, departmentId: 3, employmentType: "Full-Time", gender: "F" }]);
    // leave type
    queueSelect(leaveTypesTable, [{
      id: 1, name: "Casual Leave", code: "CL", isActive: true,
      annualQuota: "12", advanceNoticeDays: 0, allowHalfDay: true,
      applicableEmploymentTypes: null, minConsecutiveDays: "0.5", maxConsecutiveDays: "10",
      lopByDefault: false,
    }]);
    // blackout dates
    queueSelect(blackoutDatesTable, []);
    // overlapping check
    queueSelect(leaveApplicationsTable, []);
    // getOrCreateBalance — existing balance with enough headroom
    queueSelect(leaveBalancesTable, [{
      id: 50, allocated: "12", carryForward: "0", used: "0", pending: "0",
    }]);
    // After insert: enrich employee + lookup HOD
    queueSelect(employeesTable, [{ name: "Asha", lastName: "Raiser" }]);
    queueSelect(hrmsUsersTable, [{ email: "hod@co.test" }]);

    // Pick a future date so advanceNoticeDays / blackout logic stays simple.
    const fromDate = "2026-12-15";
    const toDate = "2026-12-16";

    const res = await fetch(`${baseUrl}/leave/applications`, {
      method: "POST",
      headers: userHeader(employee),
      body: JSON.stringify({ leaveTypeId: 1, fromDate, toDate, reason: "family event" }),
    });
    expect(res.status).toBe(201);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("leave_submitted");
    expect(c.module).toBe("leave");
    expect(c.recipientEmail).toBe("hod@co.test");
    expect(c.entityType).toBe("leave_application");
    expect(c.variables?.employeeName).toBe("Asha Raiser");
    expect(c.variables?.fromDate).toBe(fromDate);
    expect(c.variables?.toDate).toBe(toDate);
    expect(c.variables?.leaveType).toBe("Casual Leave");
  });
});

describe("POST /leave/applications/:id/hr-action — HR decision", () => {
  it("fires leave_approved to the applicant on Approved", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "HOD Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2",
    }]);
    queueSelect(leaveTypesTable, [{ requiresHodApproval: true }]);
    // inside transaction: balance lookup
    queueSelect(leaveBalancesTable, [{ id: 50 }]);
    // post-tx: applicant user lookup
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/leave/applications/5/hr-action`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({ action: "Approved", remarks: "OK" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("leave_approved");
    expect(c.recipientEmail).toBe("asha@co.test");
    expect(c.recipientName).toBe("Asha Raiser");
    expect(c.entityType).toBe("leave_application");
    expect(c.entityId).toBe(5);
    expect(c.variables?.fromDate).toBe("2026-12-15");
    expect(c.variables?.toDate).toBe("2026-12-16");
    expect(c.variables?.reason).toBe("OK");
  });

  it("fires leave_rejected to the applicant on Rejected, forwarding remarks as reason", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "HOD Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2",
    }]);
    queueSelect(leaveTypesTable, [{ requiresHodApproval: true }]);
    queueSelect(leaveBalancesTable, [{ id: 50 }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/leave/applications/5/hr-action`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({ action: "Rejected", remarks: "blackout overlap" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("leave_rejected");
    expect(c.recipientEmail).toBe("asha@co.test");
    expect(c.variables?.reason).toBe("blackout overlap");
  });
});

describe("PUT /leave/applications/:id — HR edits an Approved leave's dates", () => {
  it("notifies the applicant AND every previous approver with leave_dates_edited", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead", email: "hr@co.test" };

    // Existing Approved app with both HOD + HR approvals on record
    queueSelect(leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2", isHalfDay: false, halfDaySession: null,
      hodActionedById: 9, hrActionedById: 7,
    }]);
    // No overlap (addedDays > 0 → overlap query fires)
    queueSelect(leaveApplicationsTable, []);
    // Inside tx: balance lookup (delta != 0 path)
    queueSelect(leaveBalancesTable, [{ id: 50 }]);
    // After tx: notification block
    queueSelect(leaveTypesTable, [{ name: "Casual Leave" }]);
    queueSelect(hrmsUsersTable, [{ id: 11, email: "asha@co.test", name: "Asha Raiser" }]);
    queueSelect(hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 9, email: "hod@co.test", name: "HOD User", employeeId: 90 },
    ]);

    const res = await fetch(`${baseUrl}/leave/applications/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({
        fromDate: "2026-12-15", toDate: "2026-12-17",
        reason: "extending by a day",
      }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    // 1 to applicant + 2 to approvers
    expect(dispatchCalls).toHaveLength(3);
    expect(dispatchCalls.every((c) => c.eventType === "leave_dates_edited")).toBe(true);
    expect(new Set(dispatchCalls.map((c) => c.recipientEmail))).toEqual(
      new Set(["asha@co.test", "hr@co.test", "hod@co.test"]),
    );
    for (const c of dispatchCalls) {
      expect(c.variables?.oldFromDate).toBe("2026-12-15");
      expect(c.variables?.oldToDate).toBe("2026-12-16");
      expect(c.variables?.newFromDate).toBe("2026-12-15");
      expect(c.variables?.newToDate).toBe("2026-12-17");
      expect(c.variables?.editedBy).toBe("HR Lead");
      expect(c.variables?.leaveType).toBe("Casual Leave");
      expect(c.variables?.editReason).toBe("extending by a day");
    }
  });
});
