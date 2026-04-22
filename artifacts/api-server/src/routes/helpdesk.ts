import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { dispatchNotification } from "../lib/notification-service";
import { getUsersByRoles } from "./system-config";
import { db } from "../lib/db";
import { buildSlaReport, buildSlaReportCsv, type SlaTicket } from "../lib/sla-report";
import {
  helpdeskTicketsTable,
  ticketCommentsTable,
  ticketSlaLogsTable,
  ticketAssignmentsTable,
  ticketAttachmentsTable,
  userNotificationsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, or, isNull } from "drizzle-orm";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const MANAGER_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// SLA hours by priority
const SLA_HOURS: Record<string, number> = {
  Urgent: 4,
  High: 8,
  Medium: 24,
  Low: 48,
};

function computeSlaDeadline(priority: string): Date {
  const hours = SLA_HOURS[priority] ?? 24;
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + hours);
  return deadline;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function getEmployeeForUser(userId: number): Promise<{ id: number } | null> {
  const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.id, userId));
  if (!user?.employeeId) return null;
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(eq(employeesTable.id, user.employeeId));
  return emp ?? null;
}

/**
 * Verify the caller can access a specific ticket.
 * Returns the ticket if access is granted, null otherwise.
 */
async function checkTicketAccess(
  ticketId: number,
  u: { id: number; role: string }
): Promise<typeof helpdeskTicketsTable.$inferSelect | null> {
  const [ticket] = await db.select().from(helpdeskTicketsTable)
    .where(eq(helpdeskTicketsTable.id, ticketId));
  if (!ticket) return null;

  const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);
  if (isHrRole) return ticket;

  const emp = await getEmployeeForUser(u.id);
  if (!emp) return null;

  if (ticket.raisedByEmployeeId === emp.id) return ticket;

  if (u.role === "hod") {
    const directReports = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(eq(employeesTable.managerId, emp.id));
    const teamIds = [emp.id, ...directReports.map(r => r.id)];
    if (ticket.raisedByEmployeeId && teamIds.includes(ticket.raisedByEmployeeId)) return ticket;
  }

  return null;
}

/**
 * Category-to-role routing: return first HR user of an appropriate role for auto-assignment.
 * Falls back to any hr_manager if no specific match.
 */
async function autoAssignForCategory(category: string): Promise<number | null> {
  const preferredRoles: Record<string, string[]> = {
    IT: ["super_admin", "hr_manager"],
    HR: ["hr_manager", "hr_executive"],
    Finance: ["payroll_admin", "hr_manager"],
    Payroll: ["payroll_admin", "hr_manager"],
    Admin: ["super_admin", "hr_manager"],
    Other: ["hr_manager", "hr_executive"],
  };
  const roles = preferredRoles[category] ?? ["hr_manager"];
  for (const role of roles) {
    const [user] = await db.select({ id: hrmsUsersTable.id }).from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.role, role as "hr_manager")).limit(1);
    if (user) return user.id;
  }
  return null;
}

// Shared SLA escalation: creates SLA log + in-app notifications + dispatches email/WhatsApp.
// Idempotent: callers should only invoke when slaEscalatedAt is null. The DB update sets escalated=true
// before any side-effects, but since dispatch is fire-and-forget we accept a small risk of duplicate
// dispatch under race conditions (acceptable per task notification idempotency expectations).
async function escalateSlaBreach(ticket: typeof helpdeskTicketsTable.$inferSelect, at: Date) {
  await db.update(helpdeskTicketsTable)
    .set({ slaBreached: true, slaEscalatedAt: at })
    .where(eq(helpdeskTicketsTable.id, ticket.id));
  await db.insert(ticketSlaLogsTable).values({
    ticketId: ticket.id,
    event: `SLA BREACH: Ticket #${ticket.id} "${ticket.subject}" is overdue. Assignee: user ${ticket.assignedToUserId ?? "unassigned"}.`,
  });

  const hrUsers = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
    .from(hrmsUsersTable)
    .where(or(
      eq(hrmsUsersTable.role, "hr_manager"),
      eq(hrmsUsersTable.role, "super_admin"),
      eq(hrmsUsersTable.role, "hod"),
    ));
  const recipients: Array<{ id: number; email: string | null; name: string | null; employeeId: number | null }> = [...hrUsers];
  if (ticket.assignedToUserId && !recipients.find(r => r.id === ticket.assignedToUserId)) {
    const [assignee] = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
      .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, ticket.assignedToUserId)).limit(1);
    if (assignee) recipients.push(assignee);
  }

  for (const r of recipients) {
    await db.insert(userNotificationsTable).values({
      recipientUserId: r.id,
      title: "SLA Breach Alert",
      message: `Ticket #${ticket.id} "${ticket.subject}" has breached its SLA deadline. Immediate action required.`,
      entityType: "helpdesk_ticket",
      entityId: ticket.id,
    }).catch(() => {});

    if (r.email) {
      dispatchNotification({
        eventType: "helpdesk_sla_breach", module: "helpdesk",
        recipientEmail: r.email, recipientName: r.name ?? undefined,
        recipientEmployeeDbId: r.employeeId,
        variables: {
          ticketId: String(ticket.id), subject: ticket.subject,
          recipientName: r.name ?? "Team Member",
        },
        entityType: "helpdesk_ticket", entityId: ticket.id,
      }).catch(() => {});
    }
  }
}

// Insert validated attachment rows for a ticket (and optionally a comment).
// Each row is "promoted" — the file was already uploaded to object storage via
// the presigned URL endpoint and the client passed the resulting metadata back.
async function insertAttachments(
  ticketId: number,
  uploadedByUserId: number,
  attachments: Array<{ objectPath: string; fileName: string; fileSize: number; contentType: string }>,
  commentId: number | null = null,
) {
  if (!attachments.length) return [];
  const rows = await db.insert(ticketAttachmentsTable).values(
    attachments.map(a => ({
      ticketId,
      commentId,
      uploadedByUserId,
      fileName: a.fileName,
      fileSize: a.fileSize,
      contentType: a.contentType,
      objectPath: a.objectPath,
    })),
  ).returning();
  return rows;
}

// Same allowlist as storage.ts; duplicated to keep modules decoupled.
const ALLOWED_ATTACHMENT_TYPES = new Set<string>([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function isValidUploadedAttachment(a: unknown): a is { objectPath: string; fileName: string; fileSize: number; contentType: string } {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o["objectPath"] === "string" && o["objectPath"].startsWith("/objects/") &&
    typeof o["fileName"] === "string" && o["fileName"].length > 0 && o["fileName"].length <= 255 &&
    typeof o["fileSize"] === "number" && Number.isFinite(o["fileSize"]) && o["fileSize"] >= 0 && o["fileSize"] <= MAX_ATTACHMENT_BYTES &&
    typeof o["contentType"] === "string" && ALLOWED_ATTACHMENT_TYPES.has(o["contentType"])
  );
}

async function enrichTicket(ticketInput: typeof helpdeskTicketsTable.$inferSelect) {
  let ticket = ticketInput;
  const [raisedBy] = ticket.raisedByEmployeeId
    ? await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
        .from(employeesTable).where(eq(employeesTable.id, ticket.raisedByEmployeeId))
    : [null];
  const [assignedTo] = ticket.assignedToUserId
    ? await db.select({ name: hrmsUsersTable.name }).from(hrmsUsersTable)
        .where(eq(hrmsUsersTable.id, ticket.assignedToUserId))
    : [null];

  const now = new Date();
  const isOpenStatus = !["Resolved", "Closed"].includes(ticket.status);
  const slaBreached = !!(ticket.slaDeadline && now > new Date(ticket.slaDeadline) && isOpenStatus);

  // Lazy SLA escalation: if breach is newly detected and not yet logged, escalate (logs + in-app + email/WhatsApp)
  if (slaBreached && !ticket.slaEscalatedAt) {
    try { await escalateSlaBreach(ticket, now); } catch (e) { console.error("[helpdesk] lazy escalate failed", e); }
    ticket = { ...ticket, slaBreached: true, slaEscalatedAt: now };
  }

  return {
    ...ticket,
    raisedByName: raisedBy ? `${raisedBy.firstName} ${raisedBy.lastName}` : null,
    assignedToName: assignedTo?.name ?? null,
    slaBreached,
  };
}

// ─── LIST TICKETS ─────────────────────────────────────────────────────────────
router.get("/helpdesk/tickets", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { status, category, priority, assignedTo } = req.query as Record<string, string>;
    const u = req.hrmsUser!;
    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);
    const isManagerRole = (MANAGER_ROLES as readonly string[]).includes(u.role);

    const conds = [];
    if (status) conds.push(eq(helpdeskTicketsTable.status, status as "Open"));
    if (category) conds.push(eq(helpdeskTicketsTable.category, category as "IT"));
    if (priority) conds.push(eq(helpdeskTicketsTable.priority, priority as "Low"));
    if (assignedTo) conds.push(eq(helpdeskTicketsTable.assignedToUserId, Number(assignedTo)));

    if (!isHrRole) {
      if (u.role === "employee") {
        const emp = await getEmployeeForUser(u.id);
        if (!emp) { res.json([]); return; }
        conds.push(eq(helpdeskTicketsTable.raisedByEmployeeId, emp.id));
      } else if (u.role === "hod") {
        // HOD: see own team tickets
        const hodEmp = await getEmployeeForUser(u.id);
        if (!hodEmp) { res.json([]); return; }
        const directReports = await db.select({ id: employeesTable.id }).from(employeesTable)
          .where(eq(employeesTable.managerId, hodEmp.id));
        const teamIds = [hodEmp.id, ...directReports.map(r => r.id)];
        if (teamIds.length === 0) { res.json([]); return; }
        conds.push(inArray(helpdeskTicketsTable.raisedByEmployeeId, teamIds));
      } else {
        // payroll_admin: see own tickets only
        const emp = await getEmployeeForUser(u.id);
        if (emp) {
          conds.push(eq(helpdeskTicketsTable.raisedByEmployeeId, emp.id));
        } else {
          res.json([]); return;
        }
      }
    }

    const tickets = await db.select().from(helpdeskTicketsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(helpdeskTicketsTable.createdAt));

    const enriched = await Promise.all(tickets.map(enrichTicket));
    res.json(enriched);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CREATE TICKET ────────────────────────────────────────────────────────────
router.post("/helpdesk/tickets", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { subject, description, category, priority, attachmentUrl, attachments } = req.body;
    if (!subject || !description || !category || !priority) {
      res.status(400).json({ error: "subject, description, category and priority are required" }); return;
    }

    let validatedAttachments: Array<{ objectPath: string; fileName: string; fileSize: number; contentType: string }> = [];
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || !attachments.every(isValidUploadedAttachment)) {
        res.status(400).json({ error: "attachments must be an array of {objectPath,fileName,fileSize,contentType}" }); return;
      }
      validatedAttachments = attachments;
    }

    const emp = await getEmployeeForUser(u.id);
    const slaDeadline = computeSlaDeadline(priority);
    const assignedToUserId = await autoAssignForCategory(category);

    const [ticket] = await db.insert(helpdeskTicketsTable).values({
      subject,
      description,
      category,
      priority,
      raisedByEmployeeId: emp?.id ?? null,
      assignedToUserId,
      slaDeadline,
      attachmentUrl: attachmentUrl ?? null,
    }).returning();

    if (validatedAttachments.length) {
      await insertAttachments(ticket.id, u.id, validatedAttachments, null);
    }

    await db.insert(ticketSlaLogsTable).values({
      ticketId: ticket.id,
      event: `Ticket created with priority ${priority}. SLA deadline: ${slaDeadline.toISOString()}`,
    });

    // Record initial auto-assignment in assignment history for audit trail
    if (assignedToUserId) {
      await db.insert(ticketAssignmentsTable).values({
        ticketId: ticket.id,
        assignedToUserId,
        assignedByUserId: null,
        note: `Auto-assigned based on category: ${category}`,
      });
    }

    // Confirmation to the requester that we received their ticket. Best-effort:
    // we use the requester's own user account email/name from req.hrmsUser; if
    // the calling user has no email on file (rare — service accounts) the
    // dispatch is skipped silently.
    if (u.email) {
      dispatchNotification({
        eventType: "helpdesk_ticket_confirmation", module: "helpdesk",
        recipientEmail: u.email, recipientName: u.name ?? undefined,
        recipientEmployeeDbId: emp?.id ?? null,
        variables: {
          ticketId: String(ticket.id), subject, category, priority,
          slaDeadline: slaDeadline.toISOString(),
          recipientName: u.name ?? "Team Member",
        },
        entityType: "helpdesk_ticket", entityId: ticket.id,
      }).catch(() => {});
    }

    // Notify assignee about new ticket
    if (assignedToUserId) {
      const [assignee] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
        .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, assignedToUserId));
      if (assignee?.email) {
        dispatchNotification({
          eventType: "helpdesk_ticket_raised", module: "helpdesk",
          recipientEmail: assignee.email, recipientName: assignee.name ?? undefined,
          recipientEmployeeDbId: assignee.employeeId,
          variables: {
            ticketId: String(ticket.id), subject, slaDeadline: slaDeadline.toISOString(),
            recipientName: assignee.name ?? "Team Member",
          },
          entityType: "helpdesk_ticket", entityId: ticket.id,
        }).catch(() => {});
      }
    }

    // Broadcast new ticket to HR (super_admin, hr_manager, hr_executive — matches HR_ROLES) so HR is aware of incoming tickets
    try {
      const hrUsers = await getUsersByRoles([...HR_ROLES]);
      const raiserName = emp ? `Employee #${emp.id}` : "an employee";
      for (const hr of hrUsers) {
        if (!hr.email || hr.id === assignedToUserId) continue; // skip assignee (already notified) and self
        dispatchNotification({
          eventType: "helpdesk_ticket_created", module: "helpdesk",
          recipientEmail: hr.email, recipientName: hr.name ?? undefined,
          recipientEmployeeDbId: hr.employeeId,
          variables: {
            ticketId: String(ticket.id), subject, category, priority,
            slaDeadline: slaDeadline.toISOString(),
            raisedBy: raiserName, recipientName: hr.name ?? "HR",
          },
          entityType: "helpdesk_ticket", entityId: ticket.id,
        }).catch(() => {});
      }
    } catch (e) { console.error("[helpdesk] failed to broadcast ticket created to HR", e); }

    res.status(201).json(await enrichTicket(ticket));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET TICKET DETAIL ────────────────────────────────────────────────────────
router.get("/helpdesk/tickets/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const u = req.hrmsUser!;

    const ticket = await checkTicketAccess(id, u);
    if (!ticket) { res.status(404).json({ error: "Ticket not found or access denied" }); return; }

    const enriched = await enrichTicket(ticket);
    const isManagerRole = (MANAGER_ROLES as readonly string[]).includes(u.role);

    const comments = await db.select({
      id: ticketCommentsTable.id,
      ticketId: ticketCommentsTable.ticketId,
      authorId: ticketCommentsTable.authorId,
      authorName: hrmsUsersTable.name,
      message: ticketCommentsTable.message,
      isInternal: ticketCommentsTable.isInternal,
      createdAt: ticketCommentsTable.createdAt,
    }).from(ticketCommentsTable)
      .leftJoin(hrmsUsersTable, eq(ticketCommentsTable.authorId, hrmsUsersTable.id))
      .where(eq(ticketCommentsTable.ticketId, id))
      .orderBy(ticketCommentsTable.createdAt);

    const visibleComments = isManagerRole ? comments : comments.filter(c => !c.isInternal);

    // Fetch attachments and group by commentId. Ticket-level attachments
    // (commentId IS NULL) live on `attachments`; per-comment attachments live
    // on each comment's `attachments` array.
    const attachmentRows = await db.select({
      id: ticketAttachmentsTable.id,
      ticketId: ticketAttachmentsTable.ticketId,
      commentId: ticketAttachmentsTable.commentId,
      uploadedByUserId: ticketAttachmentsTable.uploadedByUserId,
      uploadedByName: hrmsUsersTable.name,
      fileName: ticketAttachmentsTable.fileName,
      fileSize: ticketAttachmentsTable.fileSize,
      contentType: ticketAttachmentsTable.contentType,
      objectPath: ticketAttachmentsTable.objectPath,
      createdAt: ticketAttachmentsTable.createdAt,
    }).from(ticketAttachmentsTable)
      .leftJoin(hrmsUsersTable, eq(ticketAttachmentsTable.uploadedByUserId, hrmsUsersTable.id))
      .where(eq(ticketAttachmentsTable.ticketId, id))
      .orderBy(ticketAttachmentsTable.createdAt);

    const ticketLevelAttachments = attachmentRows.filter(a => a.commentId === null);
    const commentsWithAttachments = visibleComments.map(c => ({
      ...c,
      attachments: attachmentRows.filter(a => a.commentId === c.id),
    }));

    res.json({ ...enriched, comments: commentsWithAttachments, attachments: ticketLevelAttachments });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── UPDATE TICKET ────────────────────────────────────────────────────────────
router.put("/helpdesk/tickets/:id", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const u = req.hrmsUser!;
    const { status, priority, assignedToUserId } = req.body;

    // HOD can only update tickets within their team scope; HR roles have unrestricted access
    const existing = await checkTicketAccess(id, u);
    if (!existing) { res.status(404).json({ error: "Ticket not found or access denied" }); return; }

    const updates: Partial<typeof helpdeskTicketsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (status) updates.status = status;
    if (priority) {
      updates.priority = priority;
      updates.slaDeadline = computeSlaDeadline(priority);
    }
    if (assignedToUserId !== undefined) updates.assignedToUserId = assignedToUserId;

    if (status === "Resolved") updates.resolvedAt = new Date();
    if (status === "Closed") updates.closedAt = new Date();

    await db.insert(ticketSlaLogsTable).values({
      ticketId: id,
      event: `Status changed to ${status ?? existing.status}` +
        (assignedToUserId !== undefined ? `, assigned to user ${assignedToUserId}` : ""),
    });

    const [updated] = await db.update(helpdeskTicketsTable).set(updates)
      .where(eq(helpdeskTicketsTable.id, id)).returning();

    // Notify raiser when status changes
    if (status && status !== existing.status && existing.raisedByEmployeeId) {
      try {
        const [raiser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
          .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, existing.raisedByEmployeeId)).limit(1);
        if (raiser?.email) {
          dispatchNotification({
            eventType: "helpdesk_status_changed", module: "helpdesk",
            recipientEmail: raiser.email, recipientName: raiser.name ?? undefined,
            recipientEmployeeDbId: raiser.employeeId,
            variables: {
              ticketId: String(id), subject: existing.subject,
              oldStatus: existing.status, newStatus: status,
              recipientName: raiser.name ?? "Team Member",
            },
            entityType: "helpdesk_ticket", entityId: id,
          }).catch(() => {});
        }
      } catch (e) { console.error("[helpdesk] failed to notify raiser of status change", e); }
    }

    // Notify new assignee when assignment changes
    if (assignedToUserId !== undefined && assignedToUserId !== existing.assignedToUserId && assignedToUserId !== null) {
      try {
        const [newAssignee] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
          .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, assignedToUserId)).limit(1);
        if (newAssignee?.email) {
          dispatchNotification({
            eventType: "helpdesk_ticket_raised", module: "helpdesk",
            recipientEmail: newAssignee.email, recipientName: newAssignee.name ?? undefined,
            recipientEmployeeDbId: newAssignee.employeeId,
            variables: {
              ticketId: String(id), subject: existing.subject,
              slaDeadline: (updates.slaDeadline ?? existing.slaDeadline ?? new Date()).toISOString(),
              recipientName: newAssignee.name ?? "Team Member",
            },
            entityType: "helpdesk_ticket", entityId: id,
          }).catch(() => {});
        }
      } catch (e) { console.error("[helpdesk] failed to notify new assignee", e); }
    }

    res.json(await enrichTicket(updated));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LIST COMMENTS ────────────────────────────────────────────────────────────
router.get("/helpdesk/tickets/:id/comments", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;

    const ticket = await checkTicketAccess(ticketId, u);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found or access denied" }); return;
    }

    const isManagerRole = (MANAGER_ROLES as readonly string[]).includes(u.role);

    const comments = await db.select({
      id: ticketCommentsTable.id,
      ticketId: ticketCommentsTable.ticketId,
      authorId: ticketCommentsTable.authorId,
      authorName: hrmsUsersTable.name,
      message: ticketCommentsTable.message,
      isInternal: ticketCommentsTable.isInternal,
      createdAt: ticketCommentsTable.createdAt,
    }).from(ticketCommentsTable)
      .leftJoin(hrmsUsersTable, eq(ticketCommentsTable.authorId, hrmsUsersTable.id))
      .where(eq(ticketCommentsTable.ticketId, ticketId))
      .orderBy(ticketCommentsTable.createdAt);

    res.json(isManagerRole ? comments : comments.filter(c => !c.isInternal));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── ADD COMMENT ─────────────────────────────────────────────────────────────
router.post("/helpdesk/tickets/:id/comments", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;
    const { message, isInternal = false, attachments } = req.body;
    if (!message) { res.status(400).json({ error: "message is required" }); return; }

    let validatedAttachments: Array<{ objectPath: string; fileName: string; fileSize: number; contentType: string }> = [];
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || !attachments.every(isValidUploadedAttachment)) {
        res.status(400).json({ error: "attachments must be an array of {objectPath,fileName,fileSize,contentType}" }); return;
      }
      validatedAttachments = attachments;
    }

    const ticket = await checkTicketAccess(ticketId, u);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found or access denied" }); return;
    }

    const isManagerRole = (MANAGER_ROLES as readonly string[]).includes(u.role);
    const internalFlag = isManagerRole ? Boolean(isInternal) : false;

    const [comment] = await db.insert(ticketCommentsTable).values({
      ticketId,
      authorId: u.id,
      message,
      isInternal: internalFlag,
    }).returning();

    let createdAttachments: Array<typeof ticketAttachmentsTable.$inferSelect> = [];
    if (validatedAttachments.length) {
      createdAttachments = await insertAttachments(ticketId, u.id, validatedAttachments, comment.id);
    }

    await db.update(helpdeskTicketsTable).set({ updatedAt: new Date() })
      .where(eq(helpdeskTicketsTable.id, ticketId));

    const [authorRow] = await db.select({ name: hrmsUsersTable.name }).from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.id, u.id));

    // Notify the "other party" on a public comment (skip internal comments)
    if (!internalFlag) {
      try {
        const commentPreview = message.length > 200 ? message.slice(0, 200) + "…" : message;
        const notifyMap = new Map<number, { email: string; name: string | null; employeeId: number | null }>();

        // Look up raiser via employeeId
        if (ticket.raisedByEmployeeId) {
          const [raiser] = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
            .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, ticket.raisedByEmployeeId)).limit(1);
          if (raiser?.email && raiser.id !== u.id) {
            notifyMap.set(raiser.id, { email: raiser.email, name: raiser.name, employeeId: raiser.employeeId });
          }
        }
        // Look up assignee (deduped against raiser via map keyed by user id)
        if (ticket.assignedToUserId && ticket.assignedToUserId !== u.id && !notifyMap.has(ticket.assignedToUserId)) {
          const [assignee] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
            .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, ticket.assignedToUserId)).limit(1);
          if (assignee?.email) {
            notifyMap.set(ticket.assignedToUserId, { email: assignee.email, name: assignee.name, employeeId: assignee.employeeId });
          }
        }

        for (const t of notifyMap.values()) {
          dispatchNotification({
            eventType: "helpdesk_comment_added", module: "helpdesk",
            recipientEmail: t.email, recipientName: t.name ?? undefined,
            recipientEmployeeDbId: t.employeeId,
            variables: {
              ticketId: String(ticketId), subject: ticket.subject,
              commentAuthor: authorRow?.name ?? "A team member",
              commentPreview, recipientName: t.name ?? "Team Member",
            },
            entityType: "helpdesk_ticket", entityId: ticketId,
          }).catch(() => {});
        }
      } catch (e) { console.error("[helpdesk] failed to notify on comment", e); }
    }

    res.status(201).json({ ...comment, authorName: authorRow?.name ?? null, attachments: createdAttachments });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── TICKET ATTACHMENTS ──────────────────────────────────────────────────────
// List ticket-level attachments (commentId IS NULL). Comment attachments are
// already returned inline in the ticket detail / comment list responses.
router.get("/helpdesk/tickets/:id/attachments", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;
    const ticket = await checkTicketAccess(ticketId, u);
    if (!ticket) { res.status(404).json({ error: "Ticket not found or access denied" }); return; }

    const rows = await db.select({
      id: ticketAttachmentsTable.id,
      ticketId: ticketAttachmentsTable.ticketId,
      commentId: ticketAttachmentsTable.commentId,
      uploadedByUserId: ticketAttachmentsTable.uploadedByUserId,
      uploadedByName: hrmsUsersTable.name,
      fileName: ticketAttachmentsTable.fileName,
      fileSize: ticketAttachmentsTable.fileSize,
      contentType: ticketAttachmentsTable.contentType,
      objectPath: ticketAttachmentsTable.objectPath,
      createdAt: ticketAttachmentsTable.createdAt,
    }).from(ticketAttachmentsTable)
      .leftJoin(hrmsUsersTable, eq(ticketAttachmentsTable.uploadedByUserId, hrmsUsersTable.id))
      .where(and(eq(ticketAttachmentsTable.ticketId, ticketId), isNull(ticketAttachmentsTable.commentId)))
      .orderBy(ticketAttachmentsTable.createdAt);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Attach already-uploaded files to an existing ticket (anyone with access).
router.post("/helpdesk/tickets/:id/attachments", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;
    const ticket = await checkTicketAccess(ticketId, u);
    if (!ticket) { res.status(404).json({ error: "Ticket not found or access denied" }); return; }

    const { attachments } = req.body;
    if (!Array.isArray(attachments) || attachments.length === 0 || !attachments.every(isValidUploadedAttachment)) {
      res.status(400).json({ error: "attachments must be a non-empty array of {objectPath,fileName,fileSize,contentType}" }); return;
    }

    const created = await insertAttachments(ticketId, u.id, attachments, null);
    await db.update(helpdeskTicketsTable).set({ updatedAt: new Date() })
      .where(eq(helpdeskTicketsTable.id, ticketId));
    res.status(201).json(created);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Remove an attachment. Only the uploader or an HR role may delete; the
// underlying object in GCS is intentionally NOT deleted (keeps the audit
// trail simple and avoids cross-region delete coupling).
router.delete("/helpdesk/tickets/:id/attachments/:attachmentId", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const attachmentId = Number(req.params.attachmentId);
    const u = req.hrmsUser!;
    const ticket = await checkTicketAccess(ticketId, u);
    if (!ticket) { res.status(404).json({ error: "Ticket not found or access denied" }); return; }

    const [attachment] = await db.select().from(ticketAttachmentsTable)
      .where(and(eq(ticketAttachmentsTable.id, attachmentId), eq(ticketAttachmentsTable.ticketId, ticketId)));
    if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }

    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);
    if (!isHrRole && attachment.uploadedByUserId !== u.id) {
      res.status(403).json({ error: "Only the uploader or HR can remove this attachment" }); return;
    }

    await db.delete(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, attachmentId));
    res.status(204).end();
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SLA CHECK (DETERMINISTIC ESCALATION) ────────────────────────────────────
router.post("/helpdesk/sla-check", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const now = new Date();
    // Find all open tickets past their SLA deadline that haven't been escalated yet
    const overdueTickets = await db.select().from(helpdeskTicketsTable)
      .where(eq(helpdeskTicketsTable.slaBreached, false));

    const breachTargets = overdueTickets.filter(t =>
      t.slaDeadline &&
      new Date(t.slaDeadline) < now &&
      !["Resolved", "Closed"].includes(t.status) &&
      !t.slaEscalatedAt
    );

    let escalated = 0;
    for (const ticket of breachTargets) {
      await escalateSlaBreach(ticket, now);
      escalated++;
    }

    res.json({ escalated });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SLA REPORT ───────────────────────────────────────────────────────────────
// Loads tickets + assignee names from the DB and delegates the KPI/CSV math to
// the pure builders in `lib/sla-report.ts` (which are unit-tested in isolation).
async function loadSlaReportInputs(): Promise<{ tickets: SlaTicket[]; assigneeNameById: Map<number, string | null> }> {
  const all = await db.select().from(helpdeskTicketsTable).orderBy(desc(helpdeskTicketsTable.createdAt));
  const tickets: SlaTicket[] = all.map(t => ({
    id: t.id,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    assignedToUserId: t.assignedToUserId,
    raisedByEmployeeId: t.raisedByEmployeeId,
    slaDeadline: t.slaDeadline,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
  }));
  const assigneeIds = [...new Set(tickets.map(t => t.assignedToUserId).filter((v): v is number => v !== null))];
  const userRows = assigneeIds.length > 0
    ? await db.select({ id: hrmsUsersTable.id, name: hrmsUsersTable.name })
        .from(hrmsUsersTable)
        .where(inArray(hrmsUsersTable.id, assigneeIds))
    : [];
  return { tickets, assigneeNameById: new Map(userRows.map(u => [u.id, u.name])) };
}

class BadDateParamError extends Error {
  constructor(public readonly param: string) { super(`Invalid date for query param '${param}'`); }
}
function parseDateParam(v: unknown, name: string): Date | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new BadDateParamError(name);
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new BadDateParamError(name);
  return d;
}

router.get("/helpdesk/sla-report", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const from = parseDateParam(req.query.from, "from");
    const to = parseDateParam(req.query.to, "to");
    const { tickets, assigneeNameById } = await loadSlaReportInputs();
    const payload = buildSlaReport({ tickets, assigneeNameById, now: new Date(), from, to });
    res.json(payload);
  } catch (err) {
    if (err instanceof BadDateParamError) { res.status(400).json({ error: err.message }); return; }
    console.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// CSV export of SLA report — one row per ticket within the optional date range
router.get("/helpdesk/sla-report.csv", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const from = parseDateParam(req.query.from, "from");
    const to = parseDateParam(req.query.to, "to");
    const { tickets } = await loadSlaReportInputs();
    const csv = buildSlaReportCsv(tickets, { now: new Date(), from, to });
    const fileLabel = `helpdesk-sla-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileLabel}"`);
    res.send(csv);
  } catch (err) {
    if (err instanceof BadDateParamError) { res.status(400).json({ error: err.message }); return; }
    console.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── TICKET ASSIGNMENTS ───────────────────────────────────────────────────────
// List assignment history for a ticket
router.get("/helpdesk/tickets/:id/assignments", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;
    if (!(await checkTicketAccess(ticketId, u))) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    const rows = await db.select({
      id: ticketAssignmentsTable.id,
      ticketId: ticketAssignmentsTable.ticketId,
      assignedToUserId: ticketAssignmentsTable.assignedToUserId,
      assignedByUserId: ticketAssignmentsTable.assignedByUserId,
      assignedAt: ticketAssignmentsTable.assignedAt,
      note: ticketAssignmentsTable.note,
      assigneeName: hrmsUsersTable.name,
    }).from(ticketAssignmentsTable)
      .leftJoin(hrmsUsersTable, eq(ticketAssignmentsTable.assignedToUserId, hrmsUsersTable.id))
      .where(eq(ticketAssignmentsTable.ticketId, ticketId))
      .orderBy(desc(ticketAssignmentsTable.assignedAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Create a new ticket assignment (record assignment event)
router.post("/helpdesk/tickets/:id/assignments", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const ticketId = Number(req.params.id);
    const { assignedToUserId, note } = req.body;
    if (!assignedToUserId) {
      res.status(400).json({ error: "assignedToUserId is required" }); return;
    }

    // Verify ticket exists
    const [ticket] = await db.select().from(helpdeskTicketsTable)
      .where(eq(helpdeskTicketsTable.id, ticketId));
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

    // Update assignedToUserId on ticket
    await db.update(helpdeskTicketsTable)
      .set({ assignedToUserId, updatedAt: new Date() })
      .where(eq(helpdeskTicketsTable.id, ticketId));

    // Record in assignment history
    const [assignment] = await db.insert(ticketAssignmentsTable).values({
      ticketId,
      assignedToUserId,
      assignedByUserId: u.id,
      note: note ?? null,
    }).returning();

    // Notify the newly assigned user
    await db.insert(userNotificationsTable).values({
      recipientUserId: assignedToUserId,
      title: "Ticket Assigned to You",
      message: `Ticket #${ticketId} "${ticket.subject}" has been assigned to you.`,
      entityType: "helpdesk_ticket",
      entityId: ticketId,
    });

    res.status(201).json(assignment);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
