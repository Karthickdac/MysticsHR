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
 *
 * The shared db / auth / notification-service / Express plumbing lives in
 * `../test-utils/notification-test-harness.ts` so other notification-flow
 * suites can re-use it without re-pasting the same fixture code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  type Row, type TestUser, type TestServerHandle,
  createDbMockState, buildDbMockModule, queueSelect, resetDbMockState,
  createDispatchCapture, buildNotificationServiceMockModule, resetDispatchCapture,
  buildAuthMockModule,
  startTestServer, userHeader,
} from "../test-utils/notification-test-harness";

// Per-file fixture state. The `vi.mock` factories below close over these so
// every test in this file shares one db / dispatch buffer; the `beforeEach`
// hook resets them between cases.
const dbState = createDbMockState();
const dispatchCalls = createDispatchCapture();

vi.mock("../lib/db", () => buildDbMockModule(dbState));
vi.mock("../lib/auth", () => buildAuthMockModule());
vi.mock("../lib/notification-service", () => buildNotificationServiceMockModule(dispatchCalls));

// system-config is helpdesk-specific (HR fan-out for new tickets).
type HrUserRow = { id: number; email: string; name: string; employeeId: number | null };
const systemConfigState: { hrUsers: HrUserRow[] } = { hrUsers: [] };
vi.mock("./system-config", () => ({
  getUsersByRoles: vi.fn(async () => systemConfigState.hrUsers),
}));

// Import the router AFTER mocks are set up.
process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./helpdesk");
const { helpdeskTicketsTable, hrmsUsersTable, employeesTable } = await import("@workspace/db/schema");

let server: TestServerHandle;

beforeEach(async () => {
  resetDbMockState(dbState);
  resetDispatchCapture(dispatchCalls);
  systemConfigState.hrUsers = [];
  server = await startTestServer(router);
});
afterEach(async () => { await server.close(); });

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /helpdesk/tickets — ticket created", () => {
  it("confirms receipt to the requester, notifies the auto-assigned agent, and broadcasts to HR", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeForUser
    queueSelect(dbState, hrmsUsersTable, [{ employeeId: 11 }]);
    queueSelect(dbState, employeesTable, [{ id: 11 }]);
    // autoAssignForCategory("IT"): tries super_admin first → hit
    queueSelect(dbState, hrmsUsersTable, [{ id: 7 }]);
    // assignee lookup for notification
    queueSelect(dbState, hrmsUsersTable, [{ email: "agent@co.test", name: "Agent Smith", employeeId: 70 }]);
    // enrichTicket — raisedBy lookup
    queueSelect(dbState, employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    // enrichTicket — assignedTo lookup
    queueSelect(dbState, hrmsUsersTable, [{ name: "Agent Smith" }]);

    // HR broadcast: include the assignee (id:7 — should be skipped) and a separate HR user
    systemConfigState.hrUsers = [
      { id: 7, email: "agent@co.test", name: "Agent Smith", employeeId: 70 },
      { id: 8, email: "hr-lead@co.test", name: "HR Lead", employeeId: 80 },
    ];

    const res = await fetch(`${server.baseUrl}/helpdesk/tickets`, {
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
    queueSelect(dbState, helpdeskTicketsTable, [{
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
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser", employeeId: 22 }]);
    // enrichTicket — raisedBy + assignedTo
    queueSelect(dbState, employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    queueSelect(dbState, hrmsUsersTable, [{ name: "HR Lead" }]);

    const res = await fetch(`${server.baseUrl}/helpdesk/tickets/5`, {
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

    queueSelect(dbState, helpdeskTicketsTable, [{
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
    queueSelect(dbState, hrmsUsersTable, [{ email: "newagent@co.test", name: "New Agent", employeeId: 90 }]);
    // enrichTicket
    queueSelect(dbState, employeesTable, [{ firstName: "Asha", lastName: "Raiser" }]);
    queueSelect(dbState, hrmsUsersTable, [{ name: "New Agent" }]);

    const res = await fetch(`${server.baseUrl}/helpdesk/tickets/5`, {
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
    queueSelect(dbState, helpdeskTicketsTable, [{
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
    queueSelect(dbState, hrmsUsersTable, [{ name: "HR Lead" }]);
    // raiser lookup (by employeeId)
    queueSelect(dbState, hrmsUsersTable, [{ id: 22, email: "asha@co.test", name: "Asha Raiser", employeeId: 22 }]);
    // assignee lookup (by user id)
    queueSelect(dbState, hrmsUsersTable, [{ email: "agent@co.test", name: "Agent Smith", employeeId: 90 }]);

    const res = await fetch(`${server.baseUrl}/helpdesk/tickets/5/comments`, {
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

    queueSelect(dbState, helpdeskTicketsTable, [{
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
    queueSelect(dbState, hrmsUsersTable, [{ name: "HR Lead" }]);

    const res = await fetch(`${server.baseUrl}/helpdesk/tickets/5/comments`, {
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
    queueSelect(dbState, helpdeskTicketsTable, [overdue]);
    // escalateSlaBreach: HR/SA/HOD users
    queueSelect(dbState, hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 8, email: "sa@co.test", name: "Super Admin", employeeId: 80 },
    ]);
    // assignee lookup (user id 9, not already in HR list)
    queueSelect(dbState, hrmsUsersTable, [
      { id: 9, email: "agent@co.test", name: "Agent Smith", employeeId: 90 },
    ]);

    const res = await fetch(`${server.baseUrl}/helpdesk/sla-check`, {
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
