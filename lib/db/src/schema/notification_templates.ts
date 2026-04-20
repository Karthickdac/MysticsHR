import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const notificationTemplatesTable = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull().unique(), // e.g. 'leave_submitted', 'offer_letter_issued'
  channel: text("channel").notNull().default("email"), // 'email' | 'whatsapp' | 'both'
  emailSubject: text("email_subject"),
  emailBody: text("email_body"), // HTML, supports {{variable}} placeholders
  whatsappTemplate: text("whatsapp_template"), // WhatsApp message template with {{1}}, {{2}} params
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationTemplate = typeof notificationTemplatesTable.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplatesTable.$inferInsert;
