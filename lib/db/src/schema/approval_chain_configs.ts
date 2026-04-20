import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const approvalChainConfigsTable = pgTable("approval_chain_configs", {
  id: serial("id").primaryKey(),
  transactionType: text("transaction_type").notNull(), // e.g. 'leave', 'payroll', 'recruitment', 'exit'
  step: integer("step").notNull().default(1),
  approverRole: text("approver_role").notNull(), // role key e.g. 'hod', 'hr_manager', 'super_admin'
  approverLabel: text("approver_label").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  escalationAfterHours: integer("escalation_after_hours"),
  escalateTo: text("escalate_to"),
  conditions: jsonb("conditions"), // optional conditions for this step
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalChainConfig = typeof approvalChainConfigsTable.$inferSelect;
export type NewApprovalChainConfig = typeof approvalChainConfigsTable.$inferInsert;
