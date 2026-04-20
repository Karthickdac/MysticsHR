import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const employeeEducationTable = pgTable("employee_education", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  degree: text("degree").notNull(),
  institution: text("institution").notNull(),
  fieldOfStudy: text("field_of_study"),
  startYear: integer("start_year"),
  endYear: integer("end_year"),
  grade: text("grade"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeEducation = typeof employeeEducationTable.$inferSelect;
