import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const employeeWorkExperienceTable = pgTable("employee_work_experience", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  company: text("company").notNull(),
  designation: text("designation").notNull(),
  location: text("location"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  ctcDrawn: text("ctc_drawn"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeWorkExperience = typeof employeeWorkExperienceTable.$inferSelect;
