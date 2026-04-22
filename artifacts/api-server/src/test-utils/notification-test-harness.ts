/**
 * Shared scaffolding for the API server's notification-flow tests.
 *
 * The route-level notification tests (helpdesk, leave, payroll, exit,
 * onboarding, documents) all need the same handful of mocks:
 *
 *   - a programmable in-memory `db` (per-table FIFO select queues, plus
 *     insert / update / delete capture and a serial id generator);
 *   - a header-driven `requireHrmsUser` / `requireRole` auth stub;
 *   - a `dispatchNotification` capture so each test can assert on the
 *     event types, recipients, and template variables that fired;
 *   - an Express harness that mounts the real router on an ephemeral
 *     port so the routes are exercised end-to-end via HTTP.
 *
 * This module exposes those building blocks so each test file can wire
 * them up with a few lines instead of re-pasting ~150 lines of fixture
 * code per test. The design is intentionally additive: tests that need
 * more (e.g. capturing the role list passed to `getUsersByRoles`, or
 * pre-seeding update return values) layer their own thin mocks on top.
 *
 * USAGE PATTERN
 * -------------
 *
 *   import {
 *     createDbMockState, buildDbMockModule,
 *     createDispatchCapture, buildNotificationServiceMockModule,
 *     buildAuthMockModule,
 *     startTestServer, userHeader, flushAsync,
 *   } from "../test-utils/notification-test-harness";
 *
 *   const dbState = createDbMockState();
 *   const dispatchCalls = createDispatchCapture();
 *
 *   vi.mock("../lib/db", () => buildDbMockModule(dbState));
 *   vi.mock("../lib/auth", () => buildAuthMockModule());
 *   vi.mock("../lib/notification-service", () =>
 *     buildNotificationServiceMockModule(dispatchCalls));
 *
 *   process.env.DATABASE_URL = "postgres://test/test";
 *   const { default: router } = await import("./helpdesk");
 *
 *   The test file then queues fake select results with `queueSelect`
 *   and asserts on `dispatchCalls` after each HTTP call.
 *
 * NOTE ON HOISTING. `vi.mock` is hoisted to the top of the file by
 * vitest, but the FACTORY functions stored here run lazily — they fire
 * the first time the mocked module is imported, which happens after
 * top-level imports and `const` initialisations. That's why it's safe
 * for the factories to close over `dbState` / `dispatchCalls` declared
 * above the corresponding `vi.mock(...)` call.
 */
import { vi } from "vitest";
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── PUBLIC TYPES ───────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

/** Shape of the "logged-in user" lifted off the `x-test-user` header. */
export type TestUser = {
  id: number;
  role: string;
  name?: string;
  email?: string;
  employeeId?: number | null;
};

export type ReqWithUser = Request & { hrmsUser?: TestUser };

/**
 * Subset of `dispatchNotification` parameters captured by the mock.
 * Every field is optional except the two that every dispatch site
 * provides (`eventType` and `module`) so individual tests don't need
 * to widen this for one-off fields.
 */
export type DispatchCall = {
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: number;
  channels?: Array<"email" | "whatsapp">;
  bypassPreferences?: boolean;
  recipientEmployeeDbId?: number;
  recipientCandidateId?: number;
};

// ─── DB MOCK STATE ──────────────────────────────────────────────────────────

/**
 * Mutable state for the in-memory db mock. One state per test file
 * (or per `describe` if isolation is needed). Reset between tests with
 * `resetDbMockState`.
 */
export interface DbMockState {
  /** Pending select results, keyed by table reference, served FIFO. */
  selectQueues: Map<unknown, Array<Row[]>>;
  /**
   * Per-table queues of rows that the next `update().returning()` call
   * should return. When empty, falls back to echoing the SET values plus
   * `{ id: 1 }` so simple tests stay terse.
   */
  updateReturnQueues: Map<unknown, Array<Row[]>>;
  /** Every `db.insert(table).values(...)` invocation, in call order. */
  inserted: Array<{ table: unknown; rows: Row[] }>;
  /** Every `db.update(table).set(...)` invocation, in call order. */
  updated: Array<{ table: unknown; values: Row }>;
  /** Every `db.delete(table).where(...)` invocation, in call order. */
  deleted: Array<{ table: unknown }>;
  /** Auto-incrementing id used by `insert(...).returning()` rows. */
  nextId: number;
  /**
   * Fallback shape for `update(...).returning()` when no explicit row was
   * queued via `queueUpdateReturn`. Defaults to `[{ ...values, id: 1 }]`.
   * Set this when the route under test reads extra columns off the returned
   * row (e.g. `documentType`, `employeeId`) that the simple echo wouldn't
   * include.
   */
  defaultUpdateReturn: (values: Row) => Row[];
}

export interface DbMockStateOptions {
  defaultUpdateReturn?: (values: Row) => Row[];
}

export function createDbMockState(opts: DbMockStateOptions = {}): DbMockState {
  return {
    selectQueues: new Map(),
    updateReturnQueues: new Map(),
    inserted: [],
    updated: [],
    deleted: [],
    nextId: 100,
    defaultUpdateReturn: opts.defaultUpdateReturn ?? ((values: Row) => [{ ...values, id: 1 }]),
  };
}

export function resetDbMockState(state: DbMockState): void {
  state.selectQueues.clear();
  state.updateReturnQueues.clear();
  state.inserted = [];
  state.updated = [];
  state.deleted = [];
  state.nextId = 100;
}

/** Push fake rows that the next `db.select(...).from(table)` should return. */
export function queueSelect(state: DbMockState, table: unknown, rows: Row[]): void {
  const q = state.selectQueues.get(table) ?? [];
  q.push(rows);
  state.selectQueues.set(table, q);
}

/**
 * Push fake rows that the next `db.update(table).set(...).where(...).returning()`
 * should return for the given table. Useful when the route reads the merged
 * row produced by a partial update (e.g. exit clearance task transitions).
 */
export function queueUpdateReturn(state: DbMockState, table: unknown, rows: Row[]): void {
  const q = state.updateReturnQueues.get(table) ?? [];
  q.push(rows);
  state.updateReturnQueues.set(table, q);
}

// ─── DB MOCK SURFACE ────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
// The drizzle chain types we mimic are wide and recursive; faking them with
// `any` here keeps the harness short without weakening the production code's
// types (it's only used inside test mocks).

function buildDbMockSurface(state: DbMockState) {
  function dequeueSelect(table: unknown): Row[] {
    const q = state.selectQueues.get(table);
    return q && q.length ? q.shift()! : [];
  }
  function makeSelectChain(table: unknown): any {
    const base: any = Promise.resolve().then(() => dequeueSelect(table));
    base.where = () => base;
    base.orderBy = () => base;
    base.limit = () => base;
    base.offset = () => base;
    base.leftJoin = () => base;
    base.innerJoin = () => base;
    base.groupBy = () => base;
    base.having = () => base;
    return base;
  }
  function makeInsertChain(table: unknown, values: Row | Row[]): any {
    const rows = Array.isArray(values) ? values : [values];
    state.inserted.push({ table, rows });
    const generated = rows.map((r) => ({ ...r, id: state.nextId++, createdAt: new Date() }));
    const base: any = Promise.resolve();
    base.returning = () => Promise.resolve(generated);
    base.onConflictDoNothing = () => base;
    base.onConflictDoUpdate = () => base;
    return base;
  }
  function makeUpdateChain(table: unknown) {
    return {
      set: (values: Row) => {
        state.updated.push({ table, values });
        const base: any = Promise.resolve();
        base.returning = () => {
          const q = state.updateReturnQueues.get(table);
          if (q && q.length) return Promise.resolve(q.shift()!);
          return Promise.resolve(state.defaultUpdateReturn(values));
        };
        return { where: () => base };
      },
    };
  }
  const select = (_projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) });
  const surface: any = {
    select,
    selectDistinct: select,
    selectDistinctOn: (_cols: unknown, _proj?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    insert: (t: unknown) => ({ values: (v: Row | Row[]) => makeInsertChain(t, v) }),
    update: (t: unknown) => makeUpdateChain(t),
    delete: (t: unknown) => ({
      where: async () => {
        state.deleted.push({ table: t });
        return undefined;
      },
    }),
    // db.transaction((tx) => fn(tx)) — re-use the same surface so tests don't
    // need to know whether a route runs inside a transaction or not.
    transaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn(surface),
  };
  return surface;
}

/** Build the module factory you pass to `vi.mock("…/lib/db", () => …)`. */
export function buildDbMockModule(state: DbMockState) {
  return { db: buildDbMockSurface(state) };
}

// ─── AUTH MOCK ──────────────────────────────────────────────────────────────

/**
 * Header-driven auth stub. The test sends `x-test-user: <json>` and the
 * middleware lifts that JSON onto `req.hrmsUser`. `requireRole(...roles)`
 * returns a middleware that 403s unless the user's role is in the list.
 */
export function buildAuthMockModule() {
  return {
    requireHrmsUser: (req: ReqWithUser, res: Response, next: NextFunction) => {
      const raw = req.headers["x-test-user"];
      if (typeof raw !== "string") {
        res.status(401).json({ error: "no test user" });
        return;
      }
      req.hrmsUser = JSON.parse(raw) as TestUser;
      next();
    },
    requireRole: (...roles: string[]) =>
      (req: ReqWithUser, res: Response, next: NextFunction) => {
        const role = req.hrmsUser?.role;
        if (!role || !roles.includes(role)) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        next();
      },
  };
}

// ─── NOTIFICATION SERVICE MOCK ──────────────────────────────────────────────

/** Fresh empty buffer for captured `dispatchNotification` calls. */
export function createDispatchCapture(): DispatchCall[] {
  return [];
}

export function resetDispatchCapture(capture: DispatchCall[]): void {
  capture.length = 0;
}

/**
 * Build the module factory you pass to
 * `vi.mock("…/lib/notification-service", () => …)`. The dispatch buffer
 * is mutated in place so the test file can assert on it directly.
 */
export function buildNotificationServiceMockModule(capture: DispatchCall[]) {
  return {
    dispatchNotification: vi.fn(async (params: DispatchCall) => {
      capture.push(params);
    }),
  };
}

// ─── EXPRESS HARNESS ────────────────────────────────────────────────────────

export interface TestServerHandle {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Start an Express app on an ephemeral port with `express.json()` and the
 * given router mounted at `/`. Returns the bound base URL plus a `close()`
 * that the caller should invoke between tests to free the port.
 */
export async function startTestServer(router: Router): Promise<TestServerHandle> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Build the headers you'd pass to `fetch(...)` for a test user. */
export function userHeader(u: TestUser): Record<string, string> {
  return { "x-test-user": JSON.stringify(u), "content-type": "application/json" };
}

// ─── FLUSH HELPERS ──────────────────────────────────────────────────────────

/**
 * Yield the event loop a few times so fire-and-forget dispatches
 * (`.catch(...)`) settle before assertions run. Three turns is plenty for
 * a single-level promise chain.
 */
export async function flushAsync(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Like `flushAsync` but waits a short macrotask first, for routes that
 * dispatch via `void import("…").then(…)` or `void (async () => {…})()`
 * with their own awaited DB lookups (e.g. the FnF approval flow).
 */
export async function flushAsyncDeep(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
  await flushAsync(5);
}
