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
 *  - scheduler.remindPreOnboardingPending — fires `onboarding_doc_pending`
 *    to candidates with at least one pending document.
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
vi.mock("../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

process.env.DATABASE_URL = "postgres://test/test";
const { default: router } = await import("./onboarding");
const { onboardingChecklistsTable, hrmsUsersTable } = await import("@workspace/db/schema");

let server: TestServerHandle;

beforeEach(async () => {
  resetDbMockState(dbState);
  resetDispatchCapture(dispatchCalls);
  server = await startTestServer(router);
});
afterEach(async () => { await server.close(); });

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("POST /employees/:id/onboarding-checklist/welcome-email — onboarding_access", () => {
  it("fires onboarding_access to the new employee with the checklist id as entity", async () => {
    const hr: TestUser = { id: 7, role: "hr_manager", name: "HR Lead" };

    // Find the checklist for the employee
    queueSelect(dbState, onboardingChecklistsTable, [{ id: 42, welcomeEmailSentAt: null }]);
    // After update, lookup the employee user
    queueSelect(dbState, hrmsUsersTable, [{ email: "asha@co.test", name: "Asha Raiser" }]);

    const res = await fetch(`${server.baseUrl}/employees/11/onboarding-checklist/welcome-email`, {
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

    queueSelect(dbState, onboardingChecklistsTable, [{ id: 42, welcomeEmailSentAt: null }]);
    // No matching hrmsUser row (e.g. seat hasn't activated yet)
    queueSelect(dbState, hrmsUsersTable, []);

    const res = await fetch(`${server.baseUrl}/employees/11/onboarding-checklist/welcome-email`, {
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
    queueSelect(dbState, preOnboardingRecordsTable, [
      { id: 100, candidateId: 11, expectedJoiningDate: "2026-05-01" },
      { id: 101, candidateId: 12, expectedJoiningDate: "2026-05-15" },
    ]);
    // Step 2 — only record 100 has pending docs; record 101 should be skipped.
    queueSelect(dbState, preOnboardingDocumentsTable, [{ recordId: 100 }]);
    // Step 3 — candidate lookup for the one record that survives the filter.
    queueSelect(dbState, candidatesTable, [{
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

    queueSelect(dbState, preOnboardingRecordsTable, [
      { id: 100, candidateId: 11, expectedJoiningDate: "2026-05-01" },
    ]);
    queueSelect(dbState, preOnboardingDocumentsTable, [{ recordId: 100 }]);
    queueSelect(dbState, candidatesTable, [{ email: null, firstName: "No", lastName: "Mail", phone: null }]);

    await remindPreOnboardingPending();
    await flushAsyncDeep();

    expect(dispatchCalls).toHaveLength(0);
  });
});
