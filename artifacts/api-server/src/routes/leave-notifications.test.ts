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
 *
 * Shared db / auth / notification / Express plumbing lives in
 * `../test-utils/notification-test-harness.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  type TestUser, type TestServerHandle,
  createDbMockState, buildDbMockModule, queueSelect, resetDbMockState,
  createDispatchCapture, buildNotificationServiceMockModule, resetDispatchCapture,
  buildAuthMockModule,
  startTestServer, userHeader,
  flushAsync,
} from "../test-utils/notification-test-harness";

const dbState = createDbMockState();
const dispatchCalls = createDispatchCapture();

vi.mock("../lib/db", () => buildDbMockModule(dbState));
vi.mock("../lib/auth", () => buildAuthMockModule());
vi.mock("../lib/notification-service", () => buildNotificationServiceMockModule(dispatchCalls));

// ─── ANCILLARY MOCKS ────────────────────────────────────────────────────────
// (Leave-specific — kept inline so the harness stays generic.)
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

let server: TestServerHandle;

beforeEach(async () => {
  resetDbMockState(dbState);
  resetDispatchCapture(dispatchCalls);
  server = await startTestServer(router);
});
afterEach(async () => { await server.close(); });

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /leave/applications — submission", () => {
  it("notifies the HOD with leave_submitted when an employee files leave", async () => {
    const employee: TestUser = { id: 11, role: "employee", name: "Asha Raiser", email: "asha@co.test", employeeId: 11 };

    // getEmployeeForUser → hrmsUsers + employees
    queueSelect(dbState, hrmsUsersTable, [{ employeeId: 11 }]);
    queueSelect(dbState, employeesTable, [{ id: 11, departmentId: 3, employmentType: "Full-Time", gender: "F" }]);
    // leave type
    queueSelect(dbState, leaveTypesTable, [{
      id: 1, name: "Casual Leave", code: "CL", isActive: true,
      annualQuota: "12", advanceNoticeDays: 0, allowHalfDay: true,
      applicableEmploymentTypes: null, minConsecutiveDays: "0.5", maxConsecutiveDays: "10",
      lopByDefault: false,
    }]);
    // blackout dates
    queueSelect(dbState, blackoutDatesTable, []);
    // overlapping check
    queueSelect(dbState, leaveApplicationsTable, []);
    // getOrCreateBalance — existing balance with enough headroom
    queueSelect(dbState, leaveBalancesTable, [{
      id: 50, allocated: "12", carryForward: "0", used: "0", pending: "0",
    }]);
    // After insert: enrich employee + lookup HOD
    queueSelect(dbState, employeesTable, [{ name: "Asha", lastName: "Raiser" }]);
    queueSelect(dbState, hrmsUsersTable, [{ email: "hod@co.test" }]);

    // Pick a future date so advanceNoticeDays / blackout logic stays simple.
    const fromDate = "2026-12-15";
    const toDate = "2026-12-16";

    const res = await fetch(`${server.baseUrl}/leave/applications`, {
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

    queueSelect(dbState, leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "HOD Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2",
    }]);
    queueSelect(dbState, leaveTypesTable, [{ requiresHodApproval: true }]);
    // inside transaction: balance lookup
    queueSelect(dbState, leaveBalancesTable, [{ id: 50 }]);
    // post-tx: applicant user lookup
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/leave/applications/5/hr-action`, {
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

    queueSelect(dbState, leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "HOD Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2",
    }]);
    queueSelect(dbState, leaveTypesTable, [{ requiresHodApproval: true }]);
    queueSelect(dbState, leaveBalancesTable, [{ id: 50 }]);
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/leave/applications/5/hr-action`, {
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
    queueSelect(dbState, leaveApplicationsTable, [{
      id: 5, employeeId: 11, leaveTypeId: 1,
      status: "Approved", fromDate: "2026-12-15", toDate: "2026-12-16",
      totalDays: "2", isHalfDay: false, halfDaySession: null,
      hodActionedById: 9, hrActionedById: 7,
    }]);
    // No overlap (addedDays > 0 → overlap query fires)
    queueSelect(dbState, leaveApplicationsTable, []);
    // Inside tx: balance lookup (delta != 0 path)
    queueSelect(dbState, leaveBalancesTable, [{ id: 50 }]);
    // After tx: notification block
    queueSelect(dbState, leaveTypesTable, [{ name: "Casual Leave" }]);
    queueSelect(dbState, hrmsUsersTable, [{ id: 11, email: "asha@co.test", name: "Asha Raiser" }]);
    queueSelect(dbState, hrmsUsersTable, [
      { id: 7, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 9, email: "hod@co.test", name: "HOD User", employeeId: 90 },
    ]);

    const res = await fetch(`${server.baseUrl}/leave/applications/5`, {
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
