import { pgTable, serial, text, integer, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const employeeFamilyMembersTable = pgTable("employee_family_members", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  name: text("name").notNull(),
  relation: text("relation").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  phone: text("phone"),
  occupation: text("occupation"),
  isDependent: boolean("is_dependent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeFamilyMember = typeof employeeFamilyMembersTable.$inferSelect;
