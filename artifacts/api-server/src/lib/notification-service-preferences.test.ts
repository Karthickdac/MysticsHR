/**
 * Suppression tests for `dispatchNotification`. Verifies that per-employee
 * notification preferences correctly suppress channel sends, and that the
 * `bypassPreferences` escape hatch still fires for compliance flows even
 * when the recipient has explicitly opted out.
 *
 * Strategy: replace the `db` module with the shared notification test
 * harness (per-table FIFO queue stub) and the `nodemailer` module with a
 * capturing transport so we can assert what email was (or was not) sent.
 * The route-level helpdesk flows are covered in
 * `routes/helpdesk-notifications.test.ts`.
 *
 * No Express server here — `dispatchNotification` is invoked directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createDbMockState, buildDbMockModule, queueSelect, resetDbMockState,
} from "../test-utils/notification-test-harness";

const dbState = createDbMockState();

vi.mock("./db", () => buildDbMockModule(dbState));

type SentMail = { to: string; subject: string };
const sentMails: SentMail[] = [];

type SendMailOpts = { to: string; subject: string; html?: string };
const fakeTransport = {
  sendMail: async (opts: SendMailOpts) => {
    sentMails.push({ to: opts.to, subject: opts.subject });
    return { accepted: [opts.to] };
  },
};
vi.mock("nodemailer", () => ({
  default: { createTransport: () => fakeTransport },
  createTransport: () => fakeTransport,
}));

// Provide SMTP creds via env so getSmtpSettings() falls back successfully.
process.env.DATABASE_URL = "postgres://test/test";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_FROM = "noreply@test";
// Intentionally leave WhatsApp creds unset so dispatchNotification logs a
// "WhatsApp not configured" failure instead of making a real network call.
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

const { dispatchNotification } = await import("./notification-service");
const {
  notificationTemplatesTable,
  notificationPreferencesTable,
  systemSettingsTable,
  employeesTable,
} = await import("@workspace/db/schema");

beforeEach(() => {
  resetDbMockState(dbState);
  sentMails.length = 0;
});

/** Seed the standard "no template, no SMTP override, no WA creds" lookups
 * that every dispatchNotification call performs before reading preferences. */
function seedTemplateAndSmtp() {
  // notificationTemplatesTable.select(...).where(...) → no custom template
  queueSelect(dbState, notificationTemplatesTable, []);
  // systemSettingsTable.select(...).where(category="email") → fall back to env
  queueSelect(dbState, systemSettingsTable, []);
  // systemSettingsTable.select(...).where(category="whatsapp") → no creds, WA logs as failed
  queueSelect(dbState, systemSettingsTable, []);
}

describe("dispatchNotification — preference suppression", () => {
  it("sends email when no preference row exists (default opt-in)", async () => {
    seedTemplateAndSmtp();
    queueSelect(dbState, notificationPreferencesTable, []); // no preference row → defaults to enabled
    queueSelect(dbState, employeesTable, []); // resolveEmployeePhone → no phone, WA skipped silently

    await dispatchNotification({
      eventType: "helpdesk_ticket_raised",
      module: "helpdesk",
      recipientEmail: "agent@co.test",
      recipientName: "Agent Smith",
      recipientEmployeeDbId: 90,
      variables: { ticketId: "5", subject: "Test", recipientName: "Agent Smith" },
    });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe("agent@co.test");
    expect(sentMails[0].subject).toContain("Helpdesk Ticket");
  });

  it("suppresses email when the employee opted out of the event", async () => {
    seedTemplateAndSmtp();
    queueSelect(dbState, notificationPreferencesTable, [
      { emailEnabled: false, whatsappEnabled: false },
    ]);
    // No employee phone lookup needed because whatsapp is also disabled and
    // the dispatcher short-circuits before resolving the phone. Seed empty
    // anyway in case the implementation queries it defensively.
    queueSelect(dbState, employeesTable, []);

    await dispatchNotification({
      eventType: "helpdesk_ticket_raised",
      module: "helpdesk",
      recipientEmail: "agent@co.test",
      recipientName: "Agent Smith",
      recipientEmployeeDbId: 90,
      variables: { ticketId: "5", subject: "Test", recipientName: "Agent Smith" },
    });

    expect(sentMails).toHaveLength(0);
  });

  it("still sends when bypassPreferences=true even if the employee opted out", async () => {
    seedTemplateAndSmtp();
    // Explicitly seed an opt-out row to prove bypass overrides it. The
    // implementation should never read this queue when bypassPreferences is
    // set, but seeding it makes the test resilient if that ever changes —
    // the dispatch must still send the email.
    queueSelect(dbState, notificationPreferencesTable, [
      { emailEnabled: false, whatsappEnabled: false },
    ]);
    queueSelect(dbState, employeesTable, []); // no phone

    await dispatchNotification({
      eventType: "helpdesk_sla_breach",
      module: "helpdesk",
      recipientEmail: "hr@co.test",
      recipientName: "HR Lead",
      recipientEmployeeDbId: 70,
      bypassPreferences: true,
      variables: { ticketId: "5", subject: "Test", recipientName: "HR Lead" },
    });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe("hr@co.test");
  });

  it("respects channels=['email'] override and skips WhatsApp regardless of template", async () => {
    seedTemplateAndSmtp();
    queueSelect(dbState, notificationPreferencesTable, []); // defaults

    // Even if the employee had a phone, the channel override should keep WA
    // out of the picture entirely.
    queueSelect(dbState, employeesTable, [{ phone: "+15551234567" }]);

    await dispatchNotification({
      eventType: "form_16_available",
      module: "payroll",
      recipientEmail: "user@co.test",
      recipientEmployeeDbId: 11,
      channels: ["email"],
      variables: { recipientName: "User", financialYear: "2025-26" },
    });

    expect(sentMails).toHaveLength(1);
    // WhatsApp must not have been attempted, so no log entry from sendWhatsApp.
    const waLogs = dbState.inserted.filter((r) => {
      const first = r.rows[0] as { channel?: unknown } | undefined;
      return first?.channel === "whatsapp";
    });
    expect(waLogs).toHaveLength(0);
  });
});
