/**
 * Route-level tests for the helpdesk notification flows.
 *
 * Strategy: mock the `db`, `auth`, `notification-service` and `system-config`
 * modules, mount the helpdesk router on a real Express app, and drive the
 * routes via HTTP. We assert on the captured `dispatchNotification` calls so
 * we can verify the right event types fire to the right recipients on each
 * helpdesk action. Suppression of opted-out recipients lives inside
 * `dispatchNotification` itself and is covered by
 * `lib/notification-service-preferences.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── DB MOCK ────────────────────────────────────────────────────────────────
// Per-table FIFO queue of select results. Each test seeds the queue in the
// order the route is expected to issue queries against the table. The mock
// is intentionally thin — it just satisfies the chained drizzle API surface
// the helpdesk router uses (select/from/where/orderBy/limit/leftJoin and
// insert/update/delete with .returning()).

type Row = Record<string, unknown>;

type SelectChain<T> = Promise<T[]> & {
  where: (...args: unknown[]) => SelectChain<T>;
  orderBy: (...args: unknown[]) => SelectChain<T>;
  limit: (...args: unknown[]) => SelectChain<T>;
  leftJoin: (...args: unknown[]) => SelectChain<T>;
  innerJoin: (...args: unknown[]) => SelectChain<T>;
};

type InsertChain<T> = Promise<void> & {
  returning: () => Promise<T[]>;
};

type UpdateWhereChain<T> = Promise<void> & {
  returning: () => Promise<T[]>;
};

type UpdateChain<T> = {
  set: (values: Row) => { where: (...args: unknown[]) => UpdateWhereChain<T> };
};

type DeleteChain = { where: (...args: unknown[]) => Promise<void> };

const dbState: {
  selectQueues: Map<unknown, Array<Row[]>>;
  inserted: Array<{ table: unknown; rows: Row[] }>;
  updated: Array<{ table: unknown; values: Row }>;
  nextId: number;
} = {
  selectQueues: new Map(),
  inserted: [],
  updated: [],
  nextId: 100,
};

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
  const generated: Row[] = rows.map((r) => ({
    ...r,
    id: dbState.nextId++,
    createdAt: new Date(),
  }));
  const base = Promise.resolve();
  const chain = base as InsertChain<Row>;
  chain.returning = () => Promise.resolve(generated);
  return chain;
}

function makeUpdateChain(table: unknown): UpdateChain<Row> {
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

function makeDeleteChain(_table: unknown): DeleteChain {
  return { where: async () => undefined };
}

vi.mock("../lib/db", () => ({
  db: {
    select: (_projection?: unknown) => ({ from: (t: unknown) => makeSelectChain(t) }),
    insert: (t: unknown) => ({ values: (v: Row | Row[]) => makeInsertChain(t, v) }),
    update: (t: unknown) => makeUpdateChain(t),
    delete: (t: unknown) => makeDeleteChain(t),
  },
}));

// ─── AUTH MOCK ──────────────────────────────────────────────────────────────
// Lifts a JSON-encoded user from the `x-test-user` header onto req.hrmsUser.
type TestUser = {
  id: number;
  role: string;
  name?: string;
  email?: string;
  employeeId?: number | null;
};
type ReqWithUser = Request & { hrmsUser?: TestUser };

vi.mock("../lib/auth", () => ({
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
}));

// ─── NOTIFICATION SERVICE MOCK ──────────────────────────────────────────────
type DispatchCall = {
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: number;
};
const dispatchCalls: DispatchCall[] = [];
vi.mock("../lib/notification-service", () => ({
  dispatchNotification: vi.fn(async (params: DispatchCall) => {
    dispatchCalls.push(params);
  }),
}));

// ─── SYSTEM CONFIG MOCK ─────────────────────────────────────────────────────
type HrUserRow = { id: number; email: string; name: string; employeeId: number | null };
const systemConfigState: { hrUsers: HrUserRow[] } = { hrUsers: [] };
vi.mock("./system-config", () => ({
  getUsersByRoles: vi.fn(async () => systemConfigState.hrUsers),
}));

// Import the router AFTER mocks are set up.
process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./helpdesk");
const { helpdeskTicketsTable, hrmsUsersTable, employeesTable } = await import("@workspace/db/schema");

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
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

function userHeader(u: TestUser): Record<string, string> {
  return { "x-test-user": JSON.stringify(u), "content-type": "application/json" };
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /helpdesk/tickets — ticket created", () => {
  it("confirms receipt to the requester, notifies the auto-assigned agent, and broadcasts to HR", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeForUser
    queueSelect(hrmsUsersTable, [{ employeeId: 11 }]);
    queueSelect(employeesTable, [{ id: 11 }]);
    // autoAssignForCategory("IT"): tries super_admin first → hit
    queueSelect(hrmsUsersTable, [{ id: 7 }]);
    // assignee lookup for notification
    queueSelect(hrmsUsersTable, [{ email: "agent@co.test", name: "Agent Smith", employeeId: 70 }]);
    // enrichTicket — raisedBy lookup
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    // enrichTicket — assignedTo lookup
    queueSelect(hrmsUsersTable, [{ name: "Agent Smith" }]);

    // HR broadcast: include the assignee (id:7 — should be skipped) and a separate HR user
    systemConfigState.hrUsers = [
      { id: 7, email: "agent@co.test", name: "Agent Smith", employeeId: 70 },
      { id: 8, email: "hr-lead@co.test", name: "HR Lead", employeeId: 80 },
    ];

    const res = await fetch(`${baseUrl}/helpdesk/tickets`, {
      method: "POST",
      headers: userHeader(employee),
      body: JSON.stringify({
        subject: "Laptop won't boot",
        description: "Black screen since this morning.",
        category: "IT",
        priority: "High",
      }),
    });

    expect(res.status).toBe(201);

    // Three dispatches: requester confirmation, assignee assignment, and HR queue broadcast.
    // The HR entry matching the assignee user id is intentionally skipped to avoid double-notification.
    expect(dispatchCalls).toHaveLength(3);

    const requesterCall = dispatchCalls.find((c) => c.eventType === "helpdesk_ticket_confirmation");
    expect(requesterCall).toBeTruthy();
    expect(requesterCall!.recipientEmail).toBe("asha@co.test");
    expect(requesterCall!.recipientName).toBe("Asha Raiser");
    expect(requesterCall!.entityType).toBe("helpdesk_ticket");
    expect(requesterCall!.variables?.subject).toBe("Laptop won't boot");
    expect(requesterCall!.variables?.priority).toBe("High");
    expect(requesterCall!.variables?.category).toBe("IT");

    const assigneeCall = dispatchCalls.find((c) => c.eventType === "helpdesk_ticket_raised");
    expect(assigneeCall).toBeTruthy();
    expect(assigneeCall!.recipientEmail).toBe("agent@co.test");
    expect(assigneeCall!.entityType).toBe("helpdesk_ticket");
    expect(assigneeCall!.variables?.subject).toBe("Laptop won't boot");

    const hrCalls = dispatchCalls.filter((c) => c.eventType === "helpdesk_ticket_created");
    expect(hrCalls).toHaveLength(1);
    expect(hrCalls[0].recipientEmail).toBe("hr-lead@co.test");
    expect(hrCalls[0].variables?.priority).toBe("High");
  });
});

describe("PUT /helpdesk/tickets/:id — status & assignment changes", () => {
  it("notifies the requester when status changes", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // checkTicketAccess: select ticket
    queueSelect(helpdeskTicketsTable, [{
      id: 5,
      subject: "Need access",
      status: "Open",
      raisedByEmployeeId: 22,
      assignedToUserId: 7,
      slaDeadline: new Date(Date.now() + 3600_000),
      slaBreached: false,
      slaEscalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      category: "IT",
      priority: "High",
    }]);
    // raiser lookup
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser", employeeId: 22 }]);
    // enrichTicket — raisedBy + assignedTo
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    queueSelect(hrmsUsersTable, [{ name: "HR Lead" }]);

    const res = await fetch(`${baseUrl}/helpdesk/tickets/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Resolved" }),
    });
    expect(res.status).toBe(200);

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("helpdesk_status_changed");
    expect(c.recipientEmail).toBe("asha@co.test");
    expect(c.variables?.oldStatus).toBe("Open");
    expect(c.variables?.newStatus).toBe("Resolved");
  });

  it("notifies the new assignee when assignment changes", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(helpdeskTicketsTable, [{
      id: 5,
      subject: "VPN broken",
      status: "Open",
      raisedByEmployeeId: 22,
      assignedToUserId: 9,
      slaDeadline: new Date(Date.now() + 3600_000),
      slaBreached: false,
      slaEscalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      category: "IT",
      priority: "Medium",
    }]);
    // new assignee lookup
    queueSelect(hrmsUsersTable, [{ email: "newagent@co.test", name: "New Agent", employeeId: 90 }]);
    // enrichTicket
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    queueSelect(hrmsUsersTable, [{ name: "New Agent" }]);

    const res = await fetch(`${baseUrl}/helpdesk/tickets/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ assignedToUserId: 12 }),
    });
    expect(res.status).toBe(200);

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("helpdesk_ticket_raised");
    expect(c.recipientEmail).toBe("newagent@co.test");
    expect(c.variables?.subject).toBe("VPN broken");
  });
});

describe("POST /helpdesk/tickets/:id/comments — comment added", () => {
  it("notifies both raiser and assignee on a public comment, deduping the author", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // checkTicketAccess
    queueSelect(helpdeskTicketsTable, [{
      id: 5,
      subject: "Need access",
      status: "Open",
      raisedByEmployeeId: 22,
      assignedToUserId: 9,
      slaDeadline: new Date(Date.now() + 3600_000),
      slaBreached: false,
      slaEscalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      category: "IT",
      priority: "Medium",
    }]);
    // author name lookup
    queueSelect(hrmsUsersTable, [{ name: "HR Lead" }]);
    // raiser lookup (by employeeId)
    queueSelect(hrmsUsersTable, [{ id: 22, email: "asha@co.test", name: "Asha Raiser", employeeId: 22 }]);
    // assignee lookup (by user id)
    queueSelect(hrmsUsersTable, [{ email: "agent@co.test", name: "Agent Smith", employeeId: 90 }]);

    const res = await fetch(`${baseUrl}/helpdesk/tickets/5/comments`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({ message: "Investigating now.", isInternal: false }),
    });
    expect(res.status).toBe(201);

    expect(dispatchCalls).toHaveLength(2);
    const emails = new Set(dispatchCalls.map((c) => c.recipientEmail));
    expect(emails).toEqual(new Set(["asha@co.test", "agent@co.test"]));
    for (const c of dispatchCalls) {
      expect(c.eventType).toBe("helpdesk_comment_added");
      expect(c.variables?.commentAuthor).toBe("HR Lead");
      expect(c.variables?.commentPreview).toBe("Investigating now.");
    }
  });

  it("does not notify anyone for an internal-only comment", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(helpdeskTicketsTable, [{
      id: 5,
      subject: "Internal note",
      status: "Open",
      raisedByEmployeeId: 22,
      assignedToUserId: 9,
      slaDeadline: new Date(Date.now() + 3600_000),
      slaBreached: false,
      slaEscalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      category: "IT",
      priority: "Low",
    }]);
    queueSelect(hrmsUsersTable, [{ name: "HR Lead" }]);

    const res = await fetch(`${baseUrl}/helpdesk/tickets/5/comments`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({ message: "FYI for the team only.", isInternal: true }),
    });
    expect(res.status).toBe(201);
    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("POST /helpdesk/sla-check — SLA breach escalation", () => {
  it("escalates breached tickets to HR + assignee with helpdesk_sla_breach", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    const overdue: Row = {
      id: 5,
      subject: "Down server",
      status: "Open",
      raisedByEmployeeId: 22,
      assignedToUserId: 9,
      slaDeadline: new Date(Date.now() - 3600_000),
      slaBreached: false,
      slaEscalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      category: "IT",
      priority: "Urgent",
    };

    // Initial overdue list
    queueSelect(helpdeskTicketsTable, [overdue]);
    // escalateSlaBreach: HR/SA/HOD users
    queueSelect(hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 8, email: "sa@co.test", name: "Super Admin", employeeId: 80 },
    ]);
    // assignee lookup (user id 9, not already in HR list)
    queueSelect(hrmsUsersTable, [
      { id: 9, email: "agent@co.test", name: "Agent Smith", employeeId: 90 },
    ]);

    const res = await fetch(`${baseUrl}/helpdesk/sla-check`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { escalated: number };
    expect(body.escalated).toBe(1);

    // 3 dispatch calls — one per recipient (HR x2 + assignee)
    expect(dispatchCalls).toHaveLength(3);
    expect(dispatchCalls.every((c) => c.eventType === "helpdesk_sla_breach")).toBe(true);
    expect(new Set(dispatchCalls.map((c) => c.recipientEmail))).toEqual(
      new Set(["hr@co.test", "sa@co.test", "agent@co.test"]),
    );
  });
});
