/**
 * Route-level tests for the onboarding notification flows.
 *
 * Strategy mirrors `helpdesk-notifications.test.ts`. We mock `db`, `auth`,
 * `notification-service`, and `audit`; mount the real onboarding router on
 * Express; drive routes via HTTP; assert on captured `dispatchNotification`
 * calls.
 *
 * Coverage:
 *  - POST /employees/:id/onboarding-checklist/welcome-email — fires
 *    `onboarding_access` to the new employee, with the checklist id as the
 *    notification's entity. Skips dispatch when the linked hrmsUser has no
 *    email (e.g. record exists but Clerk seat hasn't activated yet).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── DB MOCK ────────────────────────────────────────────────────────────────
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
    selectDistinct: (_projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    selectDistinctOn: (_cols: unknown, _projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
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

vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./onboarding");
const { onboardingChecklistsTable, hrmsUsersTable } = await import("@workspace/db/schema");

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

// The welcome-email route uses `import("../lib/notification-service").then(...)`
// to dispatch, so we need to flush a few microtasks before asserting.
async function flushAsync(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}
async function flushAsyncDeep() {
  await new Promise((r) => setTimeout(r, 50));
  await flushAsync(5);
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /employees/:id/onboarding-checklist/welcome-email — onboarding_access", () => {
  it("fires onboarding_access to the new employee with the checklist id as entity", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // Find the checklist for the employee
    queueSelect(onboardingChecklistsTable, [{ id: 42, welcomeEmailSentAt: null }]);
    // After update, lookup the employee user
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/employees/11/onboarding-checklist/welcome-email`, {
      method: "POST", headers: userHeader(hr), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("onboarding_access");
    expect(c.module).toBe("onboarding");
    expect(c.recipientEmail).toBe("asha@co.test");
    expect(c.recipientName).toBe("Asha Raiser");
    expect(c.entityType).toBe("onboarding_checklist");
    expect(c.entityId).toBe(42);
    expect(c.variables?.recipientName).toBe("Asha Raiser");
  });

  it("does NOT dispatch when the employee has no linked hrmsUser email", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(onboardingChecklistsTable, [{ id: 42, welcomeEmailSentAt: null }]);
    // No matching hrmsUser row (e.g. seat hasn't activated yet)
    queueSelect(hrmsUsersTable, []);

    const res = await fetch(`${baseUrl}/employees/11/onboarding-checklist/welcome-email`, {
      method: "POST", headers: userHeader(hr), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await flushAsyncDeep();

    expect(dispatchCalls).toHaveLength(0);
  });
});

// ─── SCHEDULER: pre-onboarding pending document reminders ───────────────────
describe("scheduler.remindPreOnboardingPending — onboarding_doc_pending", () => {
  it("notifies only candidates whose pre-onboarding record has at least one pending document", async () => {
    const { remindPreOnboardingPending } = await import("../lib/scheduler");
    const { preOnboardingRecordsTable, preOnboardingDocumentsTable, candidatesTable } =
      await import("@workspace/db/schema");

    // Step 1 — two in-progress records with joining dates
    queueSelect(preOnboardingRecordsTable, [
      { id: 100, candidateId: 11, expectedJoiningDate: "2026-05-01" },
      { id: 101, candidateId: 12, expectedJoiningDate: "2026-05-15" },
    ]);
    // Step 2 — only record 100 has pending docs; record 101 should be skipped.
    queueSelect(preOnboardingDocumentsTable, [{ recordId: 100 }]);
    // Step 3 — candidate lookup for the one record that survives the filter.
    queueSelect(candidatesTable, [{
      email: "asha@candidate.test", firstName: "Asha", lastName: "Raiser", phone: null,
    }]);

    await remindPreOnboardingPending();
    await flushAsyncDeep();

    const calls = dispatchCalls.filter((c) => c.eventType === "onboarding_doc_pending");
    expect(calls).toHaveLength(1);
    expect(calls[0].recipientEmail).toBe("asha@candidate.test");
    expect(calls[0].module).toBe("pre_onboarding");
    expect(calls[0].entityType).toBe("pre_onboarding_record");
    expect(calls[0].entityId).toBe(100);
    expect(calls[0].variables?.joiningDate).toBe("2026-05-01");
    expect(calls[0].variables?.recipientName).toBe("Asha Raiser");
  });

  it("does NOT dispatch when the matched candidate has no email on file", async () => {
    const { remindPreOnboardingPending } = await import("../lib/scheduler");
    const { preOnboardingRecordsTable, preOnboardingDocumentsTable, candidatesTable } =
      await import("@workspace/db/schema");

    queueSelect(preOnboardingRecordsTable, [
      { id: 100, candidateId: 11, expectedJoiningDate: "2026-05-01" },
    ]);
    queueSelect(preOnboardingDocumentsTable, [{ recordId: 100 }]);
    queueSelect(candidatesTable, [{ email: null, firstName: "No", lastName: "Mail", phone: null }]);

    await remindPreOnboardingPending();
    await flushAsyncDeep();

    expect(dispatchCalls).toHaveLength(0);
  });
});
