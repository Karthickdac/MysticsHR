import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const employeeHistoryTable = pgTable("employee_history", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  module: text("module").notNull(),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedById: integer("changed_by_id").references(() => hrmsUsersTable.id),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeHistory = typeof employeeHistoryTable.$inferSelect;
