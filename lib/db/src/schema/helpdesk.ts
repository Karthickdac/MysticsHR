import {
  pgTable, serial, integer, boolean, timestamp, text, pgEnum,
} from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const ticketCategoryEnum = pgEnum("ticket_category", [
  "IT", "HR", "Finance", "Payroll", "Admin", "Other",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "Low", "Medium", "High", "Urgent",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "Open", "In Progress", "Pending Employee Response", "Resolved", "Closed",
]);

// ─── HELPDESK TICKETS ─────────────────────────────────────────────────────────
export const helpdeskTicketsTable = pgTable("helpdesk_tickets", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: ticketCategoryEnum("category").notNull(),
  priority: ticketPriorityEnum("priority").notNull(),
  status: ticketStatusEnum("status").notNull().default("Open"),
  raisedByEmployeeId: integer("raised_by_employee_id").references(() => employeesTable.id),
  assignedToUserId: integer("assigned_to_user_id").references(() => hrmsUsersTable.id),
  slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
  slaBreached: boolean("sla_breached").notNull().default(false),
  slaEscalatedAt: timestamp("sla_escalated_at", { withTimezone: true }),
  attachmentUrl: text("attachment_url"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TICKET COMMENTS ──────────────────────────────────────────────────────────
export const ticketCommentsTable = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => helpdeskTicketsTable.id),
  authorId: integer("author_id").notNull().references(() => hrmsUsersTable.id),
  message: text("message").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TICKET ATTACHMENTS ───────────────────────────────────────────────────────
// One row per file attached to a ticket. `commentId` is null for files attached
// at ticket creation (or later directly to the ticket); set when the upload is
// part of a comment. `objectPath` stores the normalized object-storage path
// returned by the upload endpoint (e.g. "/objects/uploads/<uuid>"); `fileName`,
// `fileSize`, and `contentType` are captured at upload time so the UI can render
// without a HEAD round-trip.
export const ticketAttachmentsTable = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => helpdeskTicketsTable.id),
  commentId: integer("comment_id").references(() => ticketCommentsTable.id),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => hrmsUsersTable.id),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  contentType: text("content_type").notNull(),
  objectPath: text("object_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TICKET SLA LOGS ──────────────────────────────────────────────────────────
export const ticketSlaLogsTable = pgTable("ticket_sla_logs", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => helpdeskTicketsTable.id),
  event: text("event").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TICKET ASSIGNMENTS ───────────────────────────────────────────────────────
export const ticketAssignmentsTable = pgTable("ticket_assignments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => helpdeskTicketsTable.id),
  assignedToUserId: integer("assigned_to_user_id").references(() => hrmsUsersTable.id),
  assignedByUserId: integer("assigned_by_user_id").references(() => hrmsUsersTable.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

export type HelpdeskTicket = typeof helpdeskTicketsTable.$inferSelect;
export type TicketComment = typeof ticketCommentsTable.$inferSelect;
export type TicketAssignment = typeof ticketAssignmentsTable.$inferSelect;
