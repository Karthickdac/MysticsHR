/**
 * Route-level tests for the payroll notification flows.
 *
 * Strategy mirrors `helpdesk-notifications.test.ts`. We mock `db`, `auth`,
 * `notification-service`, `system-config`, and `audit`, mount the real
 * payroll router on Express, drive the routes via HTTP, and assert on
 * captured `dispatchNotification` calls.
 *
 * Coverage:
 *  - POST /payroll/locks/:year/:month/lock — fires `payroll_locked` to every
 *    super_admin / hr_manager / payroll_admin returned by getUsersByRoles.
 *  - POST /payroll/runs/:id/compute — fires `payroll_run_pending_approval`
 *    to every active super_admin/payroll_admin found via hrmsUsersTable,
 *    skipping users without an email; variables include period + totals.
 *  - POST /payroll/runs/:id/approve — fires `payslip_published` to each
 *    employee whose payroll record is in the run, skipping those without a
 *    linked hrmsUser email.
 *
 * Note: `form_16_available` is dispatched from `lib/scheduler.ts`, not from
 * `routes/payroll.ts`, so it's intentionally out of scope here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── DB MOCK (per-table FIFO queues) ────────────────────────────────────────
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
  eventType: string; module: string;
  recipientEmail?: string; recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string; entityId?: number;
};
const dispatchCalls: DispatchCall[] = [];
vi.mock("../lib/notification-service", () => ({
  dispatchNotification: vi.fn(async (params: DispatchCall) => { dispatchCalls.push(params); }),
}));

// ─── SYSTEM CONFIG / AUDIT MOCKS ────────────────────────────────────────────
type HrUserRow = { id: number; email: string; name: string; employeeId: number | null };
const systemConfigState: { recipients: HrUserRow[]; roleCalls: string[][] } = { recipients: [], roleCalls: [] };
vi.mock("./system-config", () => ({
  getUsersByRoles: vi.fn(async (roles: string[]) => {
    systemConfigState.roleCalls.push([...roles]);
    return systemConfigState.recipients;
  }),
}));
vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./payroll");
const {
  payrollLocksTable, payrollRunsTable, payrollRecordsTable, payslipsTable,
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
  systemConfigState.recipients = [];
  systemConfigState.roleCalls = [];

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

// Several payroll dispatches happen inside `void import(...).then(...)`
// chains. Yield the event loop a few times so the dynamic-import promise
// settles and the queued dispatches run before assertions.
async function flushAsync(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}
async function flushAsyncDeep() {
  await new Promise((r) => setTimeout(r, 100));
  await flushAsync(5);
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /payroll/locks/:year/:month/lock — payroll_locked", () => {
  it("fires payroll_locked to every super_admin / hr_manager / payroll_admin", async () => {
    const admin: TestUser = { id: 7, role: "payroll_admin", name: "Payroll Admin" };

    // existing lock check — none, so insert path
    queueSelect(payrollLocksTable, []);

    systemConfigState.recipients = [
      { id: 1, email: "sa@co.test", name: "Super Admin", employeeId: null },
      { id: 2, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 3, email: "pa@co.test", name: "Payroll Admin", employeeId: 80 },
    ];

    const res = await fetch(`${baseUrl}/payroll/locks/2025/3/lock`, {
      method: "POST", headers: userHeader(admin), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    expect(dispatchCalls.filter((c) => c.eventType === "payroll_locked")).toHaveLength(3);
    expect(new Set(dispatchCalls.map((c) => c.recipientEmail))).toEqual(
      new Set(["sa@co.test", "hr@co.test", "pa@co.test"]),
    );
    for (const c of dispatchCalls) {
      expect(c.variables?.period).toBe("Mar 2025");
      expect(c.entityType).toBe("payroll_lock");
    }
    // Belt-and-braces: pin the exact role list the route asks for so an
    // accidental role rename or scope expansion doesn't silently change
    // who gets notified about a payroll lock.
    expect(systemConfigState.roleCalls).toContainEqual(
      ["super_admin", "hr_manager", "payroll_admin"],
    );
  });
});

describe("POST /payroll/runs/:id/approve — payslip_published", () => {
  it("fires payslip_published per employee, skipping records whose hrmsUser has no email", async () => {
    const admin: TestUser = { id: 7, role: "payroll_admin", name: "Payroll Admin" };

    // Run lookup
    queueSelect(payrollRunsTable, [{
      id: 50, status: "Computed", periodYear: 2025, periodMonth: 3,
    }]);
    // After the two updates, records-in-run lookup
    queueSelect(payrollRecordsTable, [
      // record for emp 11 — has user + email
      {
        id: 100, employeeId: 11, basic: "30000", hra: "10000", specialAllowance: "0",
        travelAllowance: "0", medicalAllowance: "0", performanceBonus: "0",
        shiftAllowance: "0", nightDifferential: "0", otherEarnings: "0",
        grossEarnings: "40000", pfEmployee: "1800", esiEmployee: "0",
        professionalTax: "200", tds: "1000", lopDeduction: "0",
        loanDeduction: "0", otherDeductions: "0", totalDeductions: "3000",
        netPay: "37000", taxRegime: "new", workingDays: "30", presentDays: "30",
        lopDays: "0", overtimeHours: "0",
      },
      // record for emp 12 — no email on user, dispatch must be skipped
      {
        id: 101, employeeId: 12, basic: "20000", hra: "5000", specialAllowance: "0",
        travelAllowance: "0", medicalAllowance: "0", performanceBonus: "0",
        shiftAllowance: "0", nightDifferential: "0", otherEarnings: "0",
        grossEarnings: "25000", pfEmployee: "1800", esiEmployee: "0",
        professionalTax: "200", tds: "0", lopDeduction: "0",
        loanDeduction: "0", otherDeductions: "0", totalDeductions: "2000",
        netPay: "23000", taxRegime: "new", workingDays: "30", presentDays: "30",
        lopDays: "0", overtimeHours: "0",
      },
    ]);

    // Per-record loop: employees + dept + designation + payslip insert/check
    // Record 100 (emp 11)
    queueSelect(employeesTable, [{ id: 11, firstName: "Asha", lastName: "Raiser", employeeId: "E11", departmentId: 3, designationId: 5 }]);
    // dept lookup (departmentId is set, so the conditional ternary fires)
    // The route does: emp?.departmentId ? db.select(...).from(departmentsTable)... : [null]
    // — that's a real select, so we queue it.
    queueSelect(await (async () => (await import("@workspace/db/schema")).departmentsTable)(), [{ name: "Engineering" }]);
    queueSelect(await (async () => (await import("@workspace/db/schema")).designationsTable)(), [{ name: "Engineer" }]);
    // existingSlip check
    queueSelect(payslipsTable, []);

    // Record 101 (emp 12)
    queueSelect(employeesTable, [{ id: 12, firstName: "Bob", lastName: "Singh", employeeId: "E12", departmentId: 3, designationId: 5 }]);
    queueSelect(await (async () => (await import("@workspace/db/schema")).departmentsTable)(), [{ name: "Engineering" }]);
    queueSelect(await (async () => (await import("@workspace/db/schema")).designationsTable)(), [{ name: "Engineer" }]);
    queueSelect(payslipsTable, []);

    // Notification block (per-record async loop): hrmsUser + payslip lookups
    // Emp 11 — has email
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);
    queueSelect(payslipsTable, [{ id: 900 }]);
    // Emp 12 — no email → second query returns nothing → dispatch skipped
    queueSelect(hrmsUsersTable, [{ email: null, name: "Bob Singh" }]);
    // (no payslip lookup for emp 12 since route returns early)

    const res = await fetch(`${baseUrl}/payroll/runs/50/approve`, {
      method: "POST", headers: userHeader(admin), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    const calls = dispatchCalls.filter((c) => c.eventType === "payslip_published");
    expect(calls).toHaveLength(1);
    expect(calls[0].recipientEmail).toBe("asha@co.test");
    expect(calls[0].variables?.period).toBe("March 2025");
    expect(calls[0].variables?.payslipUrl).toContain("highlight=900");
    expect(calls[0].entityType).toBe("payroll_run");
    expect(calls[0].entityId).toBe(50);
  });
});

describe("POST /payroll/runs/:id/compute — payroll_run_pending_approval", () => {
  it("fires payroll_run_pending_approval to every active super_admin/payroll_admin", async () => {
    const admin: TestUser = { id: 7, role: "payroll_admin", name: "Payroll Admin" };

    // Run lookup — must be Draft or Computed for the compute path to run
    queueSelect(payrollRunsTable, [{
      id: 60, status: "Draft", periodYear: 2025, periodMonth: 1,
    }]);
    // No employees → records=[], totals stay at 0; this lets us isolate the
    // notification block without simulating the entire compute pipeline.
    queueSelect(employeesTable, []);

    // Notification block: approver lookup
    queueSelect(hrmsUsersTable, [
      { email: "sa@co.test", name: "Super Admin", id: 1 },
      { email: "pa@co.test", name: "Payroll Admin", id: 7 },
      // user without email — must be skipped by the route's `if (!a.email) return;`
      { email: null, name: "No Email", id: 99 },
    ]);

    const res = await fetch(`${baseUrl}/payroll/runs/60/compute`, {
      method: "POST", headers: userHeader(admin), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    const calls = dispatchCalls.filter((c) => c.eventType === "payroll_run_pending_approval");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.recipientEmail))).toEqual(
      new Set(["sa@co.test", "pa@co.test"]),
    );
    for (const c of calls) {
      expect(c.variables?.period).toBe("January 2025");
      expect(c.variables?.totalEmployees).toBe("0");
      expect(c.variables?.initiatorName).toBe("Payroll Admin");
      expect(c.entityType).toBe("payroll_run");
      expect(c.entityId).toBe(60);
    }
  });
});
