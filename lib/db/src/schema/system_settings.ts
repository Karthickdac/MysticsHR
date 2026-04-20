import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'org_profile' | 'statutory' | 'payroll' | 'security' | 'email' | 'whatsapp' | 'financial_year' | 'approval_chains' | 'custom_fields' | 'leave_blackout'
  key: text("key").notNull(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type NewSystemSetting = typeof systemSettingsTable.$inferInsert;
