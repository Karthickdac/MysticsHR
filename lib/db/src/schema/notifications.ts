import {
  pgTable, serial, integer, boolean, timestamp, text,
} from "drizzle-orm/pg-core";
import { hrmsUsersTable } from "./hrms_users";

export const userNotificationsTable = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull().references(() => hrmsUsersTable.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserNotification = typeof userNotificationsTable.$inferSelect;
