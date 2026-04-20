import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import {
  helpdeskTicketsTable,
  ticketCommentsTable,
  ticketSlaLogsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

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

async function enrichTicket(ticket: typeof helpdeskTicketsTable.$inferSelect) {
  const [raisedBy] = ticket.raisedByEmployeeId
    ? await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
        .from(employeesTable).where(eq(employeesTable.id, ticket.raisedByEmployeeId))
    : [null];
  const [assignedTo] = ticket.assignedToUserId
    ? await db.select({ name: hrmsUsersTable.name }).from(hrmsUsersTable)
        .where(eq(hrmsUsersTable.id, ticket.assignedToUserId))
    : [null];

  // Check SLA breach
  const slaBreached = ticket.slaDeadline ? (new Date() > new Date(ticket.slaDeadline) &&
    ticket.status !== "Resolved" && ticket.status !== "Closed") : false;

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
    const { subject, description, category, priority } = req.body;
    if (!subject || !description || !category || !priority) {
      res.status(400).json({ error: "subject, description, category and priority are required" }); return;
    }

    const emp = await getEmployeeForUser(u.id);
    const slaDeadline = computeSlaDeadline(priority);

    const [ticket] = await db.insert(helpdeskTicketsTable).values({
      subject,
      description,
      category,
      priority,
      raisedByEmployeeId: emp?.id ?? null,
      slaDeadline,
    }).returning();

    await db.insert(ticketSlaLogsTable).values({
      ticketId: ticket.id,
      event: `Ticket created with priority ${priority}. SLA deadline: ${slaDeadline.toISOString()}`,
    });

    res.status(201).json(await enrichTicket(ticket));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET TICKET DETAIL ────────────────────────────────────────────────────────
router.get("/helpdesk/tickets/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const u = req.hrmsUser!;
    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);

    const [ticket] = await db.select().from(helpdeskTicketsTable).where(eq(helpdeskTicketsTable.id, id));
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

    if (!isHrRole) {
      const emp = await getEmployeeForUser(u.id);
      if (emp && ticket.raisedByEmployeeId !== emp.id) {
        if (u.role === "hod") {
          const directReports = await db.select({ id: employeesTable.id }).from(employeesTable)
            .where(eq(employeesTable.managerId, emp.id));
          const teamIds = [emp.id, ...directReports.map(r => r.id)];
          if (!ticket.raisedByEmployeeId || !teamIds.includes(ticket.raisedByEmployeeId)) {
            res.status(403).json({ error: "Access denied" }); return;
          }
        } else {
          res.status(403).json({ error: "Access denied" }); return;
        }
      }
    }

    const enriched = await enrichTicket(ticket);
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

    const isHr = isHrRole || u.role === "hod";
    const visibleComments = isHr ? comments : comments.filter(c => !c.isInternal);

    res.json({ ...enriched, comments: visibleComments });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── UPDATE TICKET ────────────────────────────────────────────────────────────
router.put("/helpdesk/tickets/:id", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, priority, assignedToUserId } = req.body;

    const [existing] = await db.select().from(helpdeskTicketsTable).where(eq(helpdeskTicketsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Ticket not found" }); return; }

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
    const isHrRole = (MANAGER_ROLES as readonly string[]).includes(u.role);

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

    res.json(isHrRole ? comments : comments.filter(c => !c.isInternal));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── ADD COMMENT ─────────────────────────────────────────────────────────────
router.post("/helpdesk/tickets/:id/comments", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const u = req.hrmsUser!;
    const { message, isInternal = false } = req.body;
    if (!message) { res.status(400).json({ error: "message is required" }); return; }

    const isHrRole = (MANAGER_ROLES as readonly string[]).includes(u.role);
    const internalFlag = isHrRole ? Boolean(isInternal) : false;

    const [comment] = await db.insert(ticketCommentsTable).values({
      ticketId,
      authorId: u.id,
      message,
      isInternal: internalFlag,
    }).returning();

    // Update ticket updatedAt and optionally change status
    await db.update(helpdeskTicketsTable).set({ updatedAt: new Date() })
      .where(eq(helpdeskTicketsTable.id, ticketId));

    const [authorRow] = await db.select({ name: hrmsUsersTable.name }).from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.id, u.id));

    res.status(201).json({ ...comment, authorName: authorRow?.name ?? null });
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

export default router;
