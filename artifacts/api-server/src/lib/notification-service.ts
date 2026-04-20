import nodemailer from "nodemailer";
import { db } from "./db";
import { notificationLogsTable, notificationTemplatesTable, systemSettingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

interface SendEmailOptions {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  eventType: string;
  module: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
}

interface SendWhatsAppOptions {
  to: string;
  toName?: string;
  message: string;
  eventType: string;
  module: string;
  entityType?: string;
  entityId?: number;
}

async function getSmtpSettings() {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, "email"));
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value as string;
  return cfg;
}

async function getWhatsAppSettings() {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, "whatsapp"));
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value as string;
  return cfg;
}

async function logNotification(params: {
  channel: string;
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName?: string;
  subject?: string;
  body?: string;
  status: "sent" | "failed" | "pending";
  errorMessage?: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(notificationLogsTable).values({
      channel: params.channel,
      eventType: params.eventType,
      module: params.module,
      recipientEmail: params.recipientEmail,
      recipientPhone: params.recipientPhone,
      recipientName: params.recipientName,
      subject: params.subject,
      body: params.body,
      status: params.status,
      errorMessage: params.errorMessage,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Record<string, unknown> | null | undefined,
    });
  } catch (e) {
    console.error("[notification-service] Failed to log notification:", e);
  }
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const smtp = await getSmtpSettings();
  if (!smtp.host || !smtp.from) {
    await logNotification({
      channel: "email",
      eventType: opts.eventType,
      module: opts.module,
      recipientEmail: opts.to,
      recipientName: opts.toName,
      subject: opts.subject,
      body: opts.html,
      status: "failed",
      errorMessage: "SMTP not configured",
      entityType: opts.entityType,
      entityId: opts.entityId,
      metadata: opts.metadata,
    });
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: parseInt(smtp.port ?? "587"),
    secure: smtp.secure === "true",
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  });

  try {
    await transporter.sendMail({
      from: smtp.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    await logNotification({
      channel: "email",
      eventType: opts.eventType,
      module: opts.module,
      recipientEmail: opts.to,
      recipientName: opts.toName,
      subject: opts.subject,
      body: opts.html,
      status: "sent",
      entityType: opts.entityType,
      entityId: opts.entityId,
      metadata: opts.metadata,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logNotification({
      channel: "email",
      eventType: opts.eventType,
      module: opts.module,
      recipientEmail: opts.to,
      recipientName: opts.toName,
      subject: opts.subject,
      body: opts.html,
      status: "failed",
      errorMessage: msg,
      entityType: opts.entityType,
      entityId: opts.entityId,
      metadata: opts.metadata,
    });
    console.error("[notification-service] Email send failed:", msg);
    return false;
  }
}

export async function sendWhatsApp(opts: SendWhatsAppOptions): Promise<boolean> {
  const wa = await getWhatsAppSettings();
  if (!wa.phone_number_id || !wa.access_token) {
    await logNotification({
      channel: "whatsapp",
      eventType: opts.eventType,
      module: opts.module,
      recipientPhone: opts.to,
      recipientName: opts.toName,
      body: opts.message,
      status: "failed",
      errorMessage: "WhatsApp not configured",
      entityType: opts.entityType,
      entityId: opts.entityId,
    });
    return false;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${wa.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${wa.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: opts.to,
          type: "text",
          text: { body: opts.message },
        }),
      }
    );
    const ok = res.ok;
    await logNotification({
      channel: "whatsapp",
      eventType: opts.eventType,
      module: opts.module,
      recipientPhone: opts.to,
      recipientName: opts.toName,
      body: opts.message,
      status: ok ? "sent" : "failed",
      errorMessage: ok ? undefined : await res.text(),
      entityType: opts.entityType,
      entityId: opts.entityId,
    });
    return ok;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logNotification({
      channel: "whatsapp",
      eventType: opts.eventType,
      module: opts.module,
      recipientPhone: opts.to,
      recipientName: opts.toName,
      body: opts.message,
      status: "failed",
      errorMessage: msg,
      entityType: opts.entityType,
      entityId: opts.entityId,
    });
    return false;
  }
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export async function dispatchNotification(params: {
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName?: string;
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const templates = await db.select().from(notificationTemplatesTable).where(
      and(eq(notificationTemplatesTable.eventType, params.eventType), eq(notificationTemplatesTable.isActive, true))
    );
    const tpl = templates[0];
    const vars = params.variables ?? {};

    const shouldEmail = tpl ? (tpl.channel === "email" || tpl.channel === "both") : true;
    const shouldWA = tpl ? (tpl.channel === "whatsapp" || tpl.channel === "both") : false;

    if (params.recipientEmail && shouldEmail) {
      const subject = tpl?.emailSubject ? interpolate(tpl.emailSubject, vars) : getDefaultSubject(params.eventType);
      const html = tpl?.emailBody ? interpolate(tpl.emailBody, vars) : getDefaultEmailBody(params.eventType, vars);
      await sendEmail({
        to: params.recipientEmail,
        toName: params.recipientName,
        subject,
        html,
        eventType: params.eventType,
        module: params.module,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata,
      });
    }

    if (params.recipientPhone && shouldWA) {
      const msg = tpl?.whatsappTemplate ? interpolate(tpl.whatsappTemplate, vars) : getDefaultWhatsAppMsg(params.eventType, vars);
      await sendWhatsApp({
        to: params.recipientPhone,
        toName: params.recipientName,
        message: msg,
        eventType: params.eventType,
        module: params.module,
        entityType: params.entityType,
        entityId: params.entityId,
      });
    }
  } catch (e) {
    console.error("[notification-service] dispatchNotification error:", e);
  }
}

function getDefaultSubject(eventType: string): string {
  const subjects: Record<string, string> = {
    leave_submitted: "Leave Application Submitted — Action Required",
    leave_approved: "Your Leave Request Has Been Approved",
    leave_rejected: "Your Leave Request Was Not Approved",
    payslip_published: "Your Payslip is Ready",
    payroll_locked: "Payroll Lock Activated",
    offer_letter_issued: "Your Offer Letter from Automystics Technologies",
    onboarding_access: "Welcome! Your Pre-Onboarding Portal is Ready",
    document_issued: "A Document Has Been Issued to You",
    helpdesk_ticket_raised: "Helpdesk Ticket Assigned to You",
    helpdesk_sla_breach: "⚠️ SLA Breach Alert — Helpdesk Ticket",
    exit_clearance_completed: "Exit Clearance Completed — FnF Initiation Required",
    id_card_generated: "Your ID Card is Ready",
  };
  return subjects[eventType] ?? `Notification: ${eventType}`;
}

function getDefaultEmailBody(eventType: string, vars: Record<string, string>): string {
  const greet = `<p>Dear ${vars.recipientName ?? "Team Member"},</p>`;
  const footer = `<p style="color:#666;font-size:12px;margin-top:24px">This is an automated notification from MysticsHR — Automystics Technologies.</p>`;

  const bodies: Record<string, string> = {
    leave_submitted: `${greet}<p>A leave application has been submitted by <strong>${vars.employeeName ?? "an employee"}</strong> from <strong>${vars.fromDate ?? ""}</strong> to <strong>${vars.toDate ?? ""}</strong> (${vars.days ?? ""} day(s)) for <em>${vars.leaveType ?? "leave"}</em>.</p><p>Please log in to MysticsHR to review and approve/reject the application.</p>`,
    leave_approved: `${greet}<p>Your leave from <strong>${vars.fromDate ?? ""}</strong> to <strong>${vars.toDate ?? ""}</strong> has been <strong style="color:green">approved</strong>.</p><p>Leave Type: ${vars.leaveType ?? ""}</p>`,
    leave_rejected: `${greet}<p>Your leave request from <strong>${vars.fromDate ?? ""}</strong> to <strong>${vars.toDate ?? ""}</strong> has been <strong style="color:red">rejected</strong>.</p><p>Reason: ${vars.reason ?? "Not provided"}</p>`,
    payslip_published: `${greet}<p>Your payslip for <strong>${vars.period ?? "the current period"}</strong> is now available. Log in to your ESS portal to view and download.</p>`,
    payroll_locked: `${greet}<p>The payroll for period <strong>${vars.period ?? ""}</strong> has been locked. Please complete all final processing steps.</p>`,
    offer_letter_issued: `${greet}<p>Congratulations! An offer letter has been issued for the position of <strong>${vars.designation ?? ""}</strong>. Please review and respond within <strong>${vars.deadline ?? "the specified time"}</strong>.</p>`,
    onboarding_access: `${greet}<p>Welcome to Automystics Technologies! Your pre-onboarding portal is now active. Please complete your checklist before your joining date of <strong>${vars.joiningDate ?? ""}</strong>.</p>`,
    document_issued: `${greet}<p>A document (<strong>${vars.documentName ?? "document"}</strong>) has been issued to you. Log in to MysticsHR to download it securely.</p>`,
    helpdesk_ticket_raised: `${greet}<p>A helpdesk ticket (<strong>#${vars.ticketId ?? ""}</strong>) has been assigned to you: <em>${vars.subject ?? ""}</em>.</p><p>SLA Deadline: <strong>${vars.slaDeadline ?? ""}</strong></p>`,
    helpdesk_sla_breach: `${greet}<p>⚠️ Helpdesk ticket <strong>#${vars.ticketId ?? ""}</strong> has breached its SLA deadline. Immediate action is required.</p>`,
    exit_clearance_completed: `${greet}<p>Exit clearance for <strong>${vars.employeeName ?? "an employee"}</strong> (${vars.employeeId ?? ""}) is fully completed. Please initiate the Final & Full Settlement process.</p>`,
    id_card_generated: `${greet}<p>Your ID card is now ready. Log in to MysticsHR to download it.</p>`,
  };

  return `<div style="font-family:sans-serif;max-width:600px;margin:auto">${bodies[eventType] ?? `${greet}<p>You have a new notification regarding ${eventType.replace(/_/g, " ")}.</p>`}${footer}</div>`;
}

function getDefaultWhatsAppMsg(eventType: string, vars: Record<string, string>): string {
  const msgs: Record<string, string> = {
    leave_submitted: `MysticsHR: Leave application by ${vars.employeeName ?? "an employee"} (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) awaits your approval.`,
    leave_approved: `MysticsHR: Your leave (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) has been approved.`,
    leave_rejected: `MysticsHR: Your leave request (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) was not approved.`,
    payslip_published: `MysticsHR: Your payslip for ${vars.period ?? "this month"} is ready. Log in to ESS to download.`,
    offer_letter_issued: `MysticsHR: Your offer letter is ready. Please check your email and respond.`,
    document_issued: `MysticsHR: A new document has been issued to you. Log in to view.`,
    id_card_generated: `MysticsHR: Your ID card is ready for download.`,
    no_sign_in: `MysticsHR: No sign-in detected for today. Please mark your attendance.`,
    no_sign_out: `MysticsHR: No sign-out detected. Please update your attendance.`,
    overtime_alert: `MysticsHR: Your working hours exceed the overtime threshold today.`,
    consecutive_absence: `MysticsHR: ${vars.days ?? "2"}+ consecutive absences detected. Please contact HR.`,
    onboarding_doc_pending: `MysticsHR: You have pending pre-onboarding documents. Please complete them before ${vars.joiningDate ?? "your joining date"}.`,
  };
  return msgs[eventType] ?? `MysticsHR notification: ${eventType.replace(/_/g, " ")}`;
}
