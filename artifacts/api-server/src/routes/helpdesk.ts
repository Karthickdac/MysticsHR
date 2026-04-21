import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { dispatchNotification } from "../lib/notification-service";
import { db } from "../lib/db";
import {
  helpdeskTicketsTable,
  ticketCommentsTable,
  ticketSlaLogsTable,
  ticketAssignmentsTable,
  userNotificationsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, or } from "drizzle-orm";

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

  // Lazy SLA escalation: if breach is newly detected and not yet logged, write escalation log + notifications
  if (slaBreached && !ticket.slaEscalatedAt) {
    await db.update(helpdeskTicketsTable)
      .set({ slaBreached: true, slaEscalatedAt: now })
      .where(eq(helpdeskTicketsTable.id, ticket.id));
    await db.insert(ticketSlaLogsTable).values({
      ticketId: ticket.id,
      event: `SLA BREACH: Ticket #${ticket.id} "${ticket.subject}" is overdue. Assignee: user ${ticket.assignedToUserId ?? "unassigned"}.`,
    });

    // Persist in-app notifications to HR managers, HOD (dept managers), and assignee
    const hrUsers = await db.select({ id: hrmsUsersTable.id })
      .from(hrmsUsersTable)
      .where(or(
        eq(hrmsUsersTable.role, "hr_manager"),
        eq(hrmsUsersTable.role, "super_admin"),
        eq(hrmsUsersTable.role, "hod"),
      ));
    const recipients: number[] = hrUsers.map(u => u.id);
    if (ticket.assignedToUserId && !recipients.includes(ticket.assignedToUserId)) {
      recipients.push(ticket.assignedToUserId);
    }
    for (const recipientUserId of recipients) {
      await db.insert(userNotificationsTable).values({
        recipientUserId,
        title: "SLA Breach Alert",
        message: `Ticket #${ticket.id} "${ticket.subject}" has breached its SLA deadline. Immediate action required.`,
        entityType: "helpdesk_ticket",
        entityId: ticket.id,
      }).catch(() => {}); // non-blocking
    }

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
    const { subject, description, category, priority, attachmentUrl } = req.body;
    if (!subject || !description || !category || !priority) {
      res.status(400).json({ error: "subject, description, category and priority are required" }); return;
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

    res.json({ ...enriched, comments: visibleComments });
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
    const { message, isInternal = false } = req.body;
    if (!message) { res.status(400).json({ error: "message is required" }); return; }

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

    await db.update(helpdeskTicketsTable).set({ updatedAt: new Date() })
      .where(eq(helpdeskTicketsTable.id, ticketId));

    const [authorRow] = await db.select({ name: hrmsUsersTable.name }).from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.id, u.id));

    res.status(201).json({ ...comment, authorName: authorRow?.name ?? null });
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

    // Collect HR managers, HR heads, and HOD (department managers) to notify
    const hrUsers = await db.select({ id: hrmsUsersTable.id, role: hrmsUsersTable.role })
      .from(hrmsUsersTable)
      .where(or(
        eq(hrmsUsersTable.role, "hr_manager"),
        eq(hrmsUsersTable.role, "super_admin"),
        eq(hrmsUsersTable.role, "hod"),
      ));

    let escalated = 0;
    for (const ticket of breachTargets) {
      await db.update(helpdeskTicketsTable)
        .set({ slaBreached: true, slaEscalatedAt: now })
        .where(eq(helpdeskTicketsTable.id, ticket.id));

      await db.insert(ticketSlaLogsTable).values({
        ticketId: ticket.id,
        event: `SLA BREACH: Ticket #${ticket.id} "${ticket.subject}" overdue. Assignee: user ${ticket.assignedToUserId ?? "unassigned"}.`,
      });

      // Create in-app notifications for HR managers and ticket assignee
      const recipients: number[] = hrUsers.map(u => u.id);
      if (ticket.assignedToUserId && !recipients.includes(ticket.assignedToUserId)) {
        recipients.push(ticket.assignedToUserId);
      }
      for (const recipientUserId of recipients) {
        await db.insert(userNotificationsTable).values({
          recipientUserId,
          title: "SLA Breach Alert",
          message: `Ticket #${ticket.id} "${ticket.subject}" has breached its SLA deadline. Immediate action required.`,
          entityType: "helpdesk_ticket",
          entityId: ticket.id,
        });
      }

      escalated++;
    }

    res.json({ escalated });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SLA REPORT ───────────────────────────────────────────────────────────────
router.get("/helpdesk/sla-report", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const all = await db.select().from(helpdeskTicketsTable).orderBy(desc(helpdeskTicketsTable.createdAt));

    const now = new Date();
    const totalTickets = all.length;
    const openTickets = all.filter(t => !["Resolved", "Closed"].includes(t.status)).length;
    const resolvedTickets = all.filter(t => ["Resolved", "Closed"].includes(t.status)).length;

    const slaBreachedCount = all.filter(t =>
      t.slaDeadline && new Date(t.slaDeadline) < now && !["Resolved", "Closed"].includes(t.status)
    ).length;

    const resolvedWithTime = all.filter(t => t.resolvedAt && t.createdAt);
    const avgResolutionHours = resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((sum, t) => {
          const diff = new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime();
          return sum + diff / (1000 * 60 * 60);
        }, 0) / resolvedWithTime.length
      : null;

    const priorityMap: Record<string, { count: number; breached: number }> = {};
    const categoryMap: Record<string, number> = {};

    for (const t of all) {
      if (!priorityMap[t.priority]) priorityMap[t.priority] = { count: 0, breached: 0 };
      priorityMap[t.priority].count++;
      if (t.slaDeadline && new Date(t.slaDeadline) < now && !["Resolved", "Closed"].includes(t.status)) {
        priorityMap[t.priority].breached++;
      }
      categoryMap[t.category] = (categoryMap[t.category] ?? 0) + 1;
    }

    res.json({
      totalTickets,
      openTickets,
      resolvedTickets,
      slaBreachedCount,
      avgResolutionHours: avgResolutionHours !== null ? Math.round(avgResolutionHours * 10) / 10 : null,
      byPriority: Object.entries(priorityMap).map(([priority, v]) => ({ priority, ...v })),
      byCategory: Object.entries(categoryMap).map(([category, count]) => ({ category, count })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
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
