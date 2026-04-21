import nodemailer from "nodemailer";
import { db } from "./db";
import { notificationLogsTable, notificationTemplatesTable, systemSettingsTable, employeesTable, candidatesTable } from "@workspace/db/schema";
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

/**
 * Coerce a JSONB value to a string for credential reads. JSON values can come
 * back as string | number | boolean | null; anything truthy gets stringified
 * and trimmed, empty strings collapse to undefined so env-fallback can kick in.
 */
function asConfigString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const trimmed = s.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Read SMTP credentials. Source of truth is the `system_settings` table
 * (category=`email`, set via the System Config UI). Each individual key falls
 * back to its corresponding SMTP_* environment variable when the DB value is
 * missing or empty, so on a fresh install env-driven credentials still work.
 */
async function getSmtpSettings() {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, "email"));
  const db_: Record<string, string | undefined> = {};
  for (const r of rows) db_[r.key] = asConfigString(r.value);

  return {
    host: db_["host"] ?? process.env["SMTP_HOST"],
    port: db_["port"] ?? process.env["SMTP_PORT"],
    secure: db_["secure"] ?? process.env["SMTP_SECURE"],
    username: db_["username"] ?? process.env["SMTP_USER"],
    password: db_["password"] ?? process.env["SMTP_PASS"],
    from: db_["from"] ?? process.env["SMTP_FROM"],
  };
}

/**
 * Read WhatsApp Cloud API credentials. Same DB-first / env-fallback pattern as
 * `getSmtpSettings()`.
 */
async function getWhatsAppSettings() {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, "whatsapp"));
  const db_: Record<string, string | undefined> = {};
  for (const r of rows) db_[r.key] = asConfigString(r.value);

  return {
    phone_number_id: db_["phone_number_id"] ?? process.env["WHATSAPP_PHONE_NUMBER_ID"],
    access_token: db_["access_token"] ?? process.env["WHATSAPP_ACCESS_TOKEN"],
  };
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

/** Auto-resolve phone from employees table by DB employee row id */
async function resolveEmployeePhone(employeeId?: number | null): Promise<string | undefined> {
  if (!employeeId) return undefined;
  const [row] = await db.select({ phone: employeesTable.phone }).from(employeesTable).where(eq(employeesTable.id, employeeId)).limit(1);
  return row?.phone ?? undefined;
}

/** Auto-resolve phone from candidates table by DB candidate row id */
async function resolveCandidatePhone(candidateId?: number | null): Promise<string | undefined> {
  if (!candidateId) return undefined;
  const [row] = await db.select({ phone: candidatesTable.phone }).from(candidatesTable).where(eq(candidatesTable.id, candidateId)).limit(1);
  return row?.phone ?? undefined;
}

export async function dispatchNotification(params: {
  eventType: string;
  module: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName?: string;
  /** DB row id from employees table — used to auto-resolve phone for WhatsApp */
  recipientEmployeeDbId?: number | null;
  /** DB row id from candidates table — used to auto-resolve phone for WhatsApp */
  recipientCandidateId?: number | null;
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
    // Default to true so WhatsApp fires for all events (if credentials are configured)
    const shouldWA = tpl ? (tpl.channel === "whatsapp" || tpl.channel === "both") : true;

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

    if (shouldWA) {
      // Resolve phone: explicit > employee lookup > candidate lookup
      const phone = params.recipientPhone
        ?? await resolveEmployeePhone(params.recipientEmployeeDbId)
        ?? await resolveCandidatePhone(params.recipientCandidateId);
      if (phone) {
        const msg = tpl?.whatsappTemplate ? interpolate(tpl.whatsappTemplate, vars) : getDefaultWhatsAppMsg(params.eventType, vars);
        await sendWhatsApp({
          to: phone,
          toName: params.recipientName,
          message: msg,
          eventType: params.eventType,
          module: params.module,
          entityType: params.entityType,
          entityId: params.entityId,
        });
      }
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
    payroll_run_pending_approval: "Payroll Run Ready for Approval — Action Required",
    offer_letter_issued: "Your Offer Letter from Automystics Technologies",
    onboarding_access: "Welcome! Your Pre-Onboarding Portal is Ready",
    document_issued: "A Document Has Been Issued to You",
    helpdesk_ticket_raised: "Helpdesk Ticket Assigned to You",
    helpdesk_ticket_created: "New Helpdesk Ticket Raised",
    helpdesk_status_changed: "Update on Your Helpdesk Ticket",
    helpdesk_comment_added: "New Comment on Your Helpdesk Ticket",
    helpdesk_sla_breach: "⚠️ SLA Breach Alert — Helpdesk Ticket",
    exit_clearance_completed: "Exit Clearance Completed — FnF Initiation Required",
    exit_clearance_done: "Your Exit Clearance is Complete",
    exit_initiated: "Your Exit Request Has Been Processed",
    exit_request_rejected: "Update on Your Exit Request",
    exit_clearance_task_assigned: "Exit Clearance Task Assigned to You — Action Required",
    fnf_pending_approval: "Full & Final Settlement Ready for Approval",
    fnf_approved: "Your Full & Final Settlement Has Been Approved",
    id_card_generated: "Your ID Card is Ready",
    no_sign_in: "Action Required: No Attendance Sign-In Detected",
    no_sign_out: "Reminder: Please Sign Out for Today",
    overtime_alert: "Overtime Threshold Exceeded Today",
    consecutive_absence: "Absence Alert — Consecutive Days Detected",
    onboarding_doc_pending: "Action Required: Complete Pre-Onboarding Documents",
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
    payslip_published: `${greet}<p>Your payslip for <strong>${vars.period ?? "the current period"}</strong> is now available.</p>${vars.payslipUrl ? `<p style="margin:18px 0"><a href="${vars.payslipUrl}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">View Your Payslip</a></p>` : `<p>Log in to your ESS portal to view and download.</p>`}`,
    payroll_locked: `${greet}<p>The payroll for period <strong>${vars.period ?? ""}</strong> has been locked. Please complete all final processing steps.</p>`,
    payroll_run_pending_approval: `${greet}<p>A payroll run for <strong>${vars.period ?? ""}</strong> has been computed by <strong>${vars.initiatorName ?? "the payroll team"}</strong> and is ready for your review and approval.</p><ul><li>Total employees: <strong>${vars.totalEmployees ?? ""}</strong></li><li>Total gross: <strong>${vars.totalGross ?? ""}</strong></li><li>Total net pay: <strong>${vars.totalNet ?? ""}</strong></li></ul>${vars.runUrl ? `<p style="margin:18px 0"><a href="${vars.runUrl}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Review Payroll Run</a></p>` : `<p>Log in to MysticsHR to review the payroll run.</p>`}`,
    onboarding_access: `${greet}<p>Welcome to Automystics Technologies! Your pre-onboarding portal is now active. Please complete your checklist before your joining date of <strong>${vars.joiningDate ?? ""}</strong>.</p>`,
    document_issued: `${greet}<p>A document (<strong>${vars.documentType ?? "document"}</strong>) has been issued to you. Log in to MysticsHR to download it securely.</p>`,
    helpdesk_ticket_raised: `${greet}<p>A helpdesk ticket (<strong>#${vars.ticketId ?? ""}</strong>) has been assigned to you: <em>${vars.subject ?? ""}</em>.</p><p>SLA Deadline: <strong>${vars.slaDeadline ?? ""}</strong></p>`,
    helpdesk_ticket_created: `${greet}<p>A new helpdesk ticket has been raised by <strong>${vars.raisedBy ?? "an employee"}</strong>:</p><ul><li>Ticket ID: <strong>#${vars.ticketId ?? ""}</strong></li><li>Subject: <em>${vars.subject ?? ""}</em></li><li>Category: ${vars.category ?? ""}</li><li>Priority: <strong>${vars.priority ?? ""}</strong></li><li>SLA Deadline: ${vars.slaDeadline ?? ""}</li></ul><p>Please log in to MysticsHR to review and take action.</p>`,
    helpdesk_status_changed: `${greet}<p>Your helpdesk ticket <strong>#${vars.ticketId ?? ""}</strong> (<em>${vars.subject ?? ""}</em>) status has been updated to <strong>${vars.newStatus ?? ""}</strong>${vars.oldStatus ? ` (was: ${vars.oldStatus})` : ""}.</p><p>Log in to MysticsHR to view full details.</p>`,
    helpdesk_comment_added: `${greet}<p>A new comment has been posted on your helpdesk ticket <strong>#${vars.ticketId ?? ""}</strong> (<em>${vars.subject ?? ""}</em>) by <strong>${vars.commentAuthor ?? "a team member"}</strong>:</p><blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#444">${vars.commentPreview ?? ""}</blockquote><p>Log in to MysticsHR to reply or view the full conversation.</p>`,
    helpdesk_sla_breach: `${greet}<p>⚠️ Helpdesk ticket <strong>#${vars.ticketId ?? ""}</strong> (<em>${vars.subject ?? ""}</em>) has breached its SLA deadline. Immediate action is required.</p>`,
    exit_clearance_completed: `${greet}<p>Exit clearance for <strong>${vars.employeeName ?? "an employee"}</strong> (${vars.employeeId ?? ""}) is fully completed. Please initiate the Final & Full Settlement process.</p>`,
    exit_clearance_done: `${greet}<p>Your exit clearance has been completed. HR will initiate your Full and Final Settlement shortly. Thank you for your contributions to Automystics Technologies.</p>`,
    exit_initiated: `${greet}<p>Your exit request status has been updated to <strong>${vars.status ?? "Clearance Pending"}</strong>. Please complete all clearance tasks in the MysticsHR portal.</p>`,
    exit_request_rejected: `${greet}<p>Your exit request submitted on <strong>${vars.submittedDate ?? ""}</strong> has been <strong style="color:red">not approved</strong> by HR.</p>${vars.reason ? `<p><strong>HR remarks:</strong> ${vars.reason}</p>` : ""}<p>Please get in touch with the HR team if you have any questions.</p>`,
    exit_clearance_task_assigned: `${greet}<p>You have been assigned a new exit clearance task for <strong>${vars.employeeName ?? "an employee"}</strong> (${vars.employeeId ?? ""}):</p><ul><li>Department: <strong>${vars.department ?? ""}</strong></li><li>Task: <em>${vars.taskName ?? ""}</em></li><li>Due date: <strong>${vars.dueDate ?? ""}</strong></li>${vars.taskDescription ? `<li>${vars.taskDescription}</li>` : ""}</ul><p>Please complete this task in MysticsHR before the employee's last working day so the Full and Final Settlement can proceed without delay.</p>`,
    fnf_pending_approval: `${greet}<p>The Full and Final Settlement for <strong>${vars.employeeName ?? "an employee"}</strong> (${vars.employeeId ?? ""}) has been computed and is awaiting your review and approval.</p><ul><li>Total payable: <strong>${vars.totalPayable ?? ""}</strong></li><li>Computed by: ${vars.computedBy ?? "the payroll team"}</li></ul><p>Please log in to MysticsHR to review the figures and record your approval.</p>`,
    fnf_approved: `${greet}<p>Your Full and Final Settlement has been <strong style="color:green">fully approved</strong>.</p>${vars.documentsIssued ? `<p>Your relieving letter and experience certificate have been issued and are available in the MysticsHR documents section.</p>` : `<p>HR will share your relieving letter and experience certificate shortly — please reach out to HR if you do not receive them.</p>`}${vars.totalPayable ? `<p>Total payable: <strong>${vars.totalPayable}</strong></p>` : ""}<p>Thank you for your contributions to Automystics Technologies. We wish you the very best in your future endeavours.</p>`,
    offer_letter_issued: `${greet}<p>Congratulations! An offer letter for the position of <strong>${vars.jobTitle ?? ""}</strong> has been issued to you with offer code <strong>${vars.offerCode ?? ""}</strong>. Your proposed joining date is <strong>${vars.joiningDate ?? ""}</strong>. Please log in to MysticsHR to review and accept.</p>`,
    id_card_generated: `${greet}<p>Your ID card is now ready. Log in to MysticsHR to download it.</p>`,
    no_sign_in: `${greet}<p>Our system has not recorded a sign-in for you today. If you are working, please update your attendance immediately through MysticsHR or contact HR.</p>`,
    no_sign_out: `${greet}<p>You have a sign-in record for today but no sign-out has been recorded. Please update your attendance or contact HR to avoid payroll discrepancies.</p>`,
    overtime_alert: `${greet}<p>Your total working hours today have exceeded the overtime threshold (<strong>${vars.hours ?? "9"} hours</strong>). Please ensure this is approved by your manager.</p>`,
    consecutive_absence: `${greet}<p>Our records indicate you have been absent for <strong>${vars.days ?? "2"}</strong> or more consecutive days. If this is due to a medical or personal reason, please apply for leave in MysticsHR or contact HR as soon as possible.</p>`,
    onboarding_doc_pending: `${greet}<p>You have pending pre-onboarding documents that must be completed before your joining date of <strong>${vars.joiningDate ?? "your joining date"}</strong>. Please log in to the MysticsHR Pre-Onboarding portal to complete your checklist.</p>`,
  };

  return `<div style="font-family:sans-serif;max-width:600px;margin:auto">${bodies[eventType] ?? `${greet}<p>You have a new notification regarding ${eventType.replace(/_/g, " ")}.</p>`}${footer}</div>`;
}

function getDefaultWhatsAppMsg(eventType: string, vars: Record<string, string>): string {
  const msgs: Record<string, string> = {
    leave_submitted: `MysticsHR: Leave application by ${vars.employeeName ?? "an employee"} (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) awaits your approval.`,
    leave_approved: `MysticsHR: Your leave (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) has been approved.`,
    leave_rejected: `MysticsHR: Your leave request (${vars.fromDate ?? ""} - ${vars.toDate ?? ""}) was not approved.`,
    payslip_published: `MysticsHR: Your payslip for ${vars.period ?? "this month"} is ready.${vars.payslipUrl ? ` View: ${vars.payslipUrl}` : " Log in to ESS to download."}`,
    payroll_run_pending_approval: `MysticsHR: Payroll run for ${vars.period ?? ""} is computed and awaiting your approval. ${vars.runUrl ?? "Log in to MysticsHR to review."}`,
    offer_letter_issued: `MysticsHR: Your offer letter is ready. Please check your email and respond.`,
    document_issued: `MysticsHR: A new document (${vars.documentType ?? "document"}) has been issued to you. Log in to MysticsHR to download.`,
    helpdesk_ticket_raised: `MysticsHR: Helpdesk ticket #${vars.ticketId ?? ""} (${vars.subject ?? ""}) assigned to you. SLA: ${vars.slaDeadline ?? ""}.`,
    helpdesk_ticket_created: `MysticsHR: New helpdesk ticket #${vars.ticketId ?? ""} (${vars.subject ?? ""}) raised by ${vars.raisedBy ?? "an employee"}. Priority: ${vars.priority ?? ""}.`,
    helpdesk_status_changed: `MysticsHR: Your ticket #${vars.ticketId ?? ""} status updated to ${vars.newStatus ?? ""}.`,
    helpdesk_comment_added: `MysticsHR: New comment on your ticket #${vars.ticketId ?? ""} by ${vars.commentAuthor ?? "a team member"}. Log in to view.`,
    helpdesk_sla_breach: `MysticsHR: ⚠️ Ticket #${vars.ticketId ?? ""} (${vars.subject ?? ""}) has breached SLA. Immediate action required.`,
    exit_clearance_done: `MysticsHR: Your exit clearance is complete. HR will initiate your Full & Final Settlement shortly.`,
    exit_clearance_completed: `MysticsHR: Exit clearance for ${vars.employeeName ?? "an employee"} is complete. Please initiate FnF.`,
    exit_initiated: `MysticsHR: Your exit request status updated to ${vars.status ?? "Clearance Pending"}. Please complete clearance tasks.`,
    exit_request_rejected: `MysticsHR: Your exit request was not approved by HR. Please contact HR for details.`,
    exit_clearance_task_assigned: `MysticsHR: New exit clearance task assigned: "${vars.taskName ?? ""}" for ${vars.employeeName ?? "an employee"}. Due ${vars.dueDate ?? ""}.`,
    fnf_pending_approval: `MysticsHR: FnF for ${vars.employeeName ?? "an employee"} (₹${vars.totalPayable ?? ""}) is computed and awaits your approval.`,
    fnf_approved: `MysticsHR: Your Full & Final Settlement has been approved. Relieving documents are ready in MysticsHR.`,
    id_card_generated: `MysticsHR: Your ID card is ready for download.`,
    no_sign_in: `MysticsHR: No sign-in detected for today. Please mark your attendance.`,
    no_sign_out: `MysticsHR: No sign-out detected. Please update your attendance.`,
    overtime_alert: `MysticsHR: Your working hours exceed the overtime threshold today.`,
    consecutive_absence: `MysticsHR: ${vars.days ?? "2"}+ consecutive absences detected. Please contact HR.`,
    onboarding_doc_pending: `MysticsHR: You have pending pre-onboarding documents. Please complete them before ${vars.joiningDate ?? "your joining date"}.`,
  };
  return msgs[eventType] ?? `MysticsHR notification: ${eventType.replace(/_/g, " ")}`;
}
