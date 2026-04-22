/**
 * Route-level tests for the documents notification flows.
 *
 * Strategy mirrors `helpdesk-notifications.test.ts`: mock `db`, `auth`,
 * `notification-service`, `audit`, and `pdf` (so we don't actually generate
 * PDFs); mount the real documents router on Express; drive routes via HTTP;
 * assert on captured `dispatchNotification` calls.
 *
 * Coverage:
 *  - POST /documents/requests — fires `document_request_created` to every
 *    HR / super_admin user.
 *  - PUT /documents/requests/:id — only fires `document_request_fulfilled`
 *    or `document_request_cancelled` on a real terminal-status transition;
 *    a no-op re-save (already Fulfilled → Fulfilled) does NOT re-notify.
 *  - POST /documents/generate — fires `document_issued` on every issuance,
 *    PLUS `document_request_fulfilled` to the employee when the issuance is
 *    linked to a pending request.
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
      whereChain.returning = () => Promise.resolve([{
        ...values, id: 1, employeeId: 11, documentType: (values as Row).documentType ?? "Bonafide",
        createdAt: new Date(),
      }]);
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
  channels?: Array<"email" | "whatsapp">;
};
const dispatchCalls: DispatchCall[] = [];
vi.mock("../lib/notification-service", () => ({
  dispatchNotification: vi.fn(async (params: DispatchCall) => { dispatchCalls.push(params); }),
}));

vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../lib/pdf", () => ({
  generatePdf: vi.fn(async () => Buffer.from("pdf")),
  substituteTemplate: vi.fn((tpl: string) => tpl),
}));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./documents");
const {
  documentRequestsTable, documentTemplatesTable, issuedDocumentsTable,
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

async function flushAsync(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /documents/requests — document_request_created", () => {
  it("notifies every HR/super_admin user with employee + document context", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeIdForUser → hrmsUsers row
    queueSelect(hrmsUsersTable, [{ employeeId: 11 }]);
    // After insert: HR users + employee name
    queueSelect(hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead" },
      { id: 8, email: "hre@co.test", name: "HR Exec" },
      { id: 9, email: "sa@co.test", name: "Super Admin" },
      // user without email — must be skipped
      { id: 10, email: null, name: "Stub User" },
    ]);
    queueSelect(employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);

    const res = await fetch(`${baseUrl}/documents/requests`, {
      method: "POST",
      headers: userHeader(employee),
      body: JSON.stringify({ documentType: "Bonafide Letter", reason: "for visa" }),
    });
    expect(res.status).toBe(201);
    await flushAsync();

    const calls = dispatchCalls.filter((c) => c.eventType === "document_request_created");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.recipientEmail))).toEqual(
      new Set(["hr@co.test", "hre@co.test", "sa@co.test"]),
    );
    for (const c of calls) {
      expect(c.module).toBe("documents");
      expect(c.entityType).toBe("document_request");
      expect(c.variables?.employeeName).toBe("Asha Raiser");
      expect(c.variables?.documentType).toBe("Bonafide Letter");
      expect(c.variables?.reason).toBe("for visa");
    }
  });
});

describe("PUT /documents/requests/:id — terminal-state transitions", () => {
  it("fires document_request_fulfilled to the employee on Pending → Fulfilled", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // Pre-update status read
    queueSelect(documentRequestsTable, [{ status: "Pending" }]);
    // After update: employee user lookup
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/documents/requests/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Fulfilled", hrNote: "Issued today" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    const c = dispatchCalls[0];
    expect(c.eventType).toBe("document_request_fulfilled");
    expect(c.recipientEmail).toBe("asha@co.test");
    expect(c.entityType).toBe("document_request");
    expect(c.variables?.documentType).toBe("Bonafide");
    expect(c.variables?.hrNote).toBe("Issued today");
  });

  it("fires document_request_cancelled on Pending → Cancelled", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(documentRequestsTable, [{ status: "Pending" }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/documents/requests/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Cancelled", hrNote: "Duplicate request" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].eventType).toBe("document_request_cancelled");
    expect(dispatchCalls[0].variables?.hrNote).toBe("Duplicate request");
  });

  it("does NOT re-notify when HR re-saves an already-Fulfilled request (no terminal transition)", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // Already Fulfilled — re-save with same status should be a no-op for notifications
    queueSelect(documentRequestsTable, [{ status: "Fulfilled" }]);

    const res = await fetch(`${baseUrl}/documents/requests/5`, {
      method: "PUT",
      headers: userHeader(hr),
      body: JSON.stringify({ status: "Fulfilled", hrNote: "tweaked note" }),
    });
    expect(res.status).toBe(200);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("POST /documents/generate — issuance + linked-request fulfilment", () => {
  it("fires document_issued and document_request_fulfilled when generation closes a pending request", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    const requestCreated = new Date("2025-04-01T10:00:00Z");
    // Linked-request lookup
    queueSelect(documentRequestsTable, [{
      id: 33, status: "Pending", employeeId: 11,
      documentType: "Bonafide Letter", createdAt: requestCreated,
    }]);
    // Template lookup
    queueSelect(documentTemplatesTable, [{
      id: 99, bodyTemplate: "Hello {{employeeName}}",
      companyName: "Auto", companyAddress: "", headerText: "", footerText: "",
    }]);
    // Employee lookup
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser",
      employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    // After insert: linked-request fulfilled-notification employee user lookup
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);
    // document_issued employee user lookup
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/documents/generate`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({
        employeeId: 11,
        documentType: "Bonafide Letter",
        templateId: 99,
        documentRequestId: 33,
        fieldValues: { purpose: "Visa" },
      }),
    });
    expect(res.status).toBe(201);
    await flushAsync();

    // Both events should have fired
    const issued = dispatchCalls.filter((c) => c.eventType === "document_issued");
    expect(issued).toHaveLength(1);
    expect(issued[0].recipientEmail).toBe("asha@co.test");
    expect(issued[0].entityType).toBe("issued_document");
    expect(issued[0].variables?.documentType).toBe("Bonafide Letter");

    const fulfilled = dispatchCalls.filter((c) => c.eventType === "document_request_fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].recipientEmail).toBe("asha@co.test");
    expect(fulfilled[0].entityType).toBe("document_request");
    expect(fulfilled[0].entityId).toBe(33);
    expect(fulfilled[0].variables?.documentType).toBe("Bonafide Letter");
    expect(fulfilled[0].variables?.hrNote).toMatch(/^Issued: /);
  });

  it("fires only document_issued (no fulfilment notice) when not linked to a request", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    queueSelect(documentTemplatesTable, [{
      id: 99, bodyTemplate: "Hello {{employeeName}}",
      companyName: "Auto", companyAddress: "", headerText: "", footerText: "",
    }]);
    queueSelect(employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser",
      employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    queueSelect(hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${baseUrl}/documents/generate`, {
      method: "POST",
      headers: userHeader(hr),
      body: JSON.stringify({
        employeeId: 11,
        documentType: "Salary Slip",
        templateId: 99,
        fieldValues: {},
      }),
    });
    expect(res.status).toBe(201);
    await flushAsync();

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].eventType).toBe("document_issued");
    expect(dispatchCalls[0].recipientEmail).toBe("asha@co.test");
  });
});
