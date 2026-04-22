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
 * `routes/payroll.ts`, so it's bundled in with this file as an extension.
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
  flushAsyncDeep,
} from "../test-utils/notification-test-harness";

const dbState = createDbMockState();
const dispatchCalls = createDispatchCapture();

vi.mock("../lib/db", () => buildDbMockModule(dbState));
vi.mock("../lib/auth", () => buildAuthMockModule());
vi.mock("../lib/notification-service", () => buildNotificationServiceMockModule(dispatchCalls));

// system-config is payroll-specific (recipient role fan-out for `payroll_locked`).
// We also capture the role lists the route asks for, so a future role rename
// or scope expansion is caught by the test.
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

let server: TestServerHandle;

beforeEach(async () => {
  resetDbMockState(dbState);
  resetDispatchCapture(dispatchCalls);
  systemConfigState.recipients = [];
  systemConfigState.roleCalls = [];
  server = await startTestServer(router);
});
afterEach(async () => { await server.close(); });

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /payroll/locks/:year/:month/lock — payroll_locked", () => {
  it("fires payroll_locked to every super_admin / hr_manager / payroll_admin", async () => {
    const admin: TestUser = { id: 7, role: "payroll_admin", name: "Payroll Admin" };

    // existing lock check — none, so insert path
    queueSelect(dbState, payrollLocksTable, []);

    systemConfigState.recipients = [
      { id: 1, email: "sa@co.test", name: "Super Admin", employeeId: null },
      { id: 2, email: "hr@co.test", name: "HR Lead", employeeId: 70 },
      { id: 3, email: "pa@co.test", name: "Payroll Admin", employeeId: 80 },
    ];

    const res = await fetch(`${server.baseUrl}/payroll/locks/2025/3/lock`, {
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
    queueSelect(dbState, payrollRunsTable, [{
      id: 50, status: "Computed", periodYear: 2025, periodMonth: 3,
    }]);
    // After the two updates, records-in-run lookup
    queueSelect(dbState, payrollRecordsTable, [
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
    queueSelect(dbState, employeesTable, [{ id: 11, firstName: "Asha", lastName: "Raiser", employeeId: "E11", departmentId: 3, designationId: 5 }]);
    // dept lookup (departmentId is set, so the conditional ternary fires)
    // The route does: emp?.departmentId ? db.select(...).from(departmentsTable)... : [null]
    // — that's a real select, so we queue it.
    queueSelect(dbState, await (async () => (await import("@workspace/db/schema")).departmentsTable)(), [{ name: "Engineering" }]);
    queueSelect(dbState, await (async () => (await import("@workspace/db/schema")).designationsTable)(), [{ name: "Engineer" }]);
    // existingSlip check
    queueSelect(dbState, payslipsTable, []);

    // Record 101 (emp 12)
    queueSelect(dbState, employeesTable, [{ id: 12, firstName: "Bob", lastName: "Singh", employeeId: "E12", departmentId: 3, designationId: 5 }]);
    queueSelect(dbState, await (async () => (await import("@workspace/db/schema")).departmentsTable)(), [{ name: "Engineering" }]);
    queueSelect(dbState, await (async () => (await import("@workspace/db/schema")).designationsTable)(), [{ name: "Engineer" }]);
    queueSelect(dbState, payslipsTable, []);

    // Notification block (per-record async loop): hrmsUser + payslip lookups
    // Emp 11 — has email
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);
    queueSelect(dbState, payslipsTable, [{ id: 900 }]);
    // Emp 12 — no email → second query returns nothing → dispatch skipped
    queueSelect(dbState, hrmsUsersTable, [{ email: null, name: "Bob Singh" }]);
    // (no payslip lookup for emp 12 since route returns early)

    const res = await fetch(`${server.baseUrl}/payroll/runs/50/approve`, {
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
    queueSelect(dbState, payrollRunsTable, [{
      id: 60, status: "Draft", periodYear: 2025, periodMonth: 1,
    }]);
    // No employees → records=[], totals stay at 0; this lets us isolate the
    // notification block without simulating the entire compute pipeline.
    queueSelect(dbState, employeesTable, []);

    // Notification block: approver lookup
    queueSelect(dbState, hrmsUsersTable, [
      { email: "sa@co.test", name: "Super Admin", id: 1 },
      { email: "pa@co.test", name: "Payroll Admin", id: 7 },
      // user without email — must be skipped by the route's `if (!a.email) return;`
      { email: null, name: "No Email", id: 99 },
    ]);

    const res = await fetch(`${server.baseUrl}/payroll/runs/60/compute`, {
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

// ─── SCHEDULER: annual Form 16 dispatch ─────────────────────────────────────
describe("scheduler.dispatchForm16ForFy — form_16_available", () => {
  it("emails every eligible employee, skips those already-sent and those without an email", async () => {
    const { dispatchForm16ForFy } = await import("../lib/scheduler");
    const { notificationLogsTable } = await import("@workspace/db/schema");

    // Step 1 — recipients (single big joined select on employeesTable).
    queueSelect(dbState, employeesTable, [
      { id: 11, firstName: "Asha", lastName: "Raiser", email: "asha@co.test" },
      // Already sent for FY 2024 — must be skipped via dedup
      { id: 12, firstName: "Bob",  lastName: "Singh",  email: "bob@co.test" },
      // No email — must be skipped
      { id: 13, firstName: "Cara", lastName: "Khan",   email: null },
    ]);
    // Step 2 — already-sent log lookup; record for emp 12 only.
    queueSelect(dbState, notificationLogsTable, [{ entityId: 12 }]);

    const result = await dispatchForm16ForFy(2024);
    await flushAsyncDeep();

    expect(result.eligible).toBe(3);
    expect(result.skipped).toBe(2);

    const calls = dispatchCalls.filter((c) => c.eventType === "form_16_available");
    expect(calls).toHaveLength(1);
    expect(calls[0].recipientEmail).toBe("asha@co.test");
    expect(calls[0].module).toBe("payroll");
    expect(calls[0].entityType).toBe("form_16_fy_2024");
    expect(calls[0].entityId).toBe(11);
    expect(calls[0].variables?.financialYear).toBe("2024-25");
    expect(calls[0].variables?.recipientName).toBe("Asha Raiser");
    expect(calls[0].variables?.form16Url).toContain("/payroll/reports/form-16/11/2024/pdf");
    expect(calls[0].channels).toEqual(["email"]);
  });

  it("returns zeros and dispatches nothing when no eligible employees exist", async () => {
    const { dispatchForm16ForFy } = await import("../lib/scheduler");
    queueSelect(dbState, employeesTable, []);
    const result = await dispatchForm16ForFy(2024);
    await flushAsyncDeep();
    expect(result).toEqual({ eligible: 0, sent: 0, skipped: 0 });
    expect(dispatchCalls).toHaveLength(0);
  });
});
