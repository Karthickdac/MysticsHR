import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const notificationLogsTable = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(), // 'email' | 'whatsapp' | 'in_app'
  eventType: text("event_type").notNull(), // e.g. 'leave_approved', 'payslip_published'
  module: text("module").notNull(), // e.g. 'leave', 'payroll', 'helpdesk'
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  recipientName: text("recipient_name"),
  subject: text("subject"),
  body: text("body"),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed' | 'pending'
  errorMessage: text("error_message"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  metadata: jsonb("metadata"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationLog = typeof notificationLogsTable.$inferSelect;
export type NewNotificationLog = typeof notificationLogsTable.$inferInsert;
