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
 *
 * Shared db / auth / notification / Express plumbing lives in
 * `../test-utils/notification-test-harness.ts`. The documents router relies
 * on the update().set().where().returning() chain producing a row with an
 * `employeeId` and a `documentType`, so we override `defaultUpdateReturn`
 * to shape the returned row appropriately.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  type Row, type TestUser, type TestServerHandle,
  createDbMockState, buildDbMockModule, queueSelect, resetDbMockState,
  createDispatchCapture, buildNotificationServiceMockModule, resetDispatchCapture,
  buildAuthMockModule,
  startTestServer, userHeader,
  flushAsync,
} from "../test-utils/notification-test-harness";

// The documents router calls `.returning()` on update chains and reads
// employeeId / documentType off the returned row. The default harness
// returning row is `{ ...values, id: 1 }`; we widen it here.
const dbState = createDbMockState({
  defaultUpdateReturn: (values: Row) => [{
    ...values,
    id: 1,
    employeeId: 11,
    documentType: (values as Row).documentType ?? "Bonafide",
    createdAt: new Date(),
  }],
});
const dispatchCalls = createDispatchCapture();

vi.mock("../lib/db", () => buildDbMockModule(dbState));
vi.mock("../lib/auth", () => buildAuthMockModule());
vi.mock("../lib/notification-service", () => buildNotificationServiceMockModule(dispatchCalls));
vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../lib/pdf", () => ({
  generatePdf: vi.fn(async () => Buffer.from("pdf")),
  substituteTemplate: vi.fn((tpl: string) => tpl),
}));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./documents");
const {
  documentRequestsTable, documentTemplatesTable,
  hrmsUsersTable, employeesTable,
} = await import("@workspace/db/schema");

let server: TestServerHandle;

beforeEach(async () => {
  resetDbMockState(dbState);
  resetDispatchCapture(dispatchCalls);
  server = await startTestServer(router);
});
afterEach(async () => { await server.close(); });

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /documents/requests — document_request_created", () => {
  it("notifies every HR/super_admin user with employee + document context", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeIdForUser → hrmsUsers row
    queueSelect(dbState, hrmsUsersTable, [{ employeeId: 11 }]);
    // After insert: HR users + employee name
    queueSelect(dbState, hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead" },
      { id: 8, email: "hre@co.test", name: "HR Exec" },
      { id: 9, email: "sa@co.test", name: "Super Admin" },
      // user without email — must be skipped
      { id: 10, email: null, name: "Stub User" },
    ]);
    queueSelect(dbState, employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);

    const res = await fetch(`${server.baseUrl}/documents/requests`, {
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
    queueSelect(dbState, documentRequestsTable, [{ status: "Pending" }]);
    // After update: employee user lookup
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/documents/requests/5`, {
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

    queueSelect(dbState, documentRequestsTable, [{ status: "Pending" }]);
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/documents/requests/5`, {
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
    queueSelect(dbState, documentRequestsTable, [{ status: "Fulfilled" }]);

    const res = await fetch(`${server.baseUrl}/documents/requests/5`, {
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
    queueSelect(dbState, documentRequestsTable, [{
      id: 33, status: "Pending", employeeId: 11,
      documentType: "Bonafide Letter", createdAt: requestCreated,
    }]);
    // Template lookup
    queueSelect(dbState, documentTemplatesTable, [{
      id: 99, bodyTemplate: "Hello {{employeeName}}",
      companyName: "Auto", companyAddress: "", headerText: "", footerText: "",
    }]);
    // Employee lookup
    queueSelect(dbState, employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser",
      employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    // After insert: linked-request fulfilled-notification employee user lookup
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);
    // document_issued employee user lookup
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/documents/generate`, {
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

    queueSelect(dbState, documentTemplatesTable, [{
      id: 99, bodyTemplate: "Hello {{employeeName}}",
      companyName: "Auto", companyAddress: "", headerText: "", footerText: "",
    }]);
    queueSelect(dbState, employeesTable, [{
      id: 11, firstName: "Asha", lastName: "Raiser",
      employeeCode: "E11", dateOfJoining: "2022-01-01",
    }]);
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/documents/generate`, {
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
