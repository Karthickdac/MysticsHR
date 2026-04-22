import { pgTable, serial, text, boolean, integer, timestamp, date, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";
import { designationsTable } from "./designations";

export const employmentTypeEnum = pgEnum("employment_type", [
  "Permanent",
  "Contract",
  "Probation",
  "Intern",
  "Part-Time",
]);

export const employeeStatusEnum = pgEnum("employee_status", [
  "Pre-Joining",
  "Active",
  "On Leave of Absence",
  "Suspended",
  "Notice Period",
  "Separated",
]);

export const genderEnum = pgEnum("gender", ["Male", "Female", "Other"]);

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  dateOfBirth: date("date_of_birth"),
  gender: genderEnum("gender"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  designationId: integer("designation_id").references(() => designationsTable.id),
  employmentType: employmentTypeEnum("employment_type").notNull().default("Permanent"),
  status: employeeStatusEnum("status").notNull().default("Pre-Joining"),
  dateOfJoining: date("date_of_joining"),
  ctc: numeric("ctc", { precision: 14, scale: 2 }),
  managerId: integer("manager_id"),
  location: text("location"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const selectEmployeeSchema = createSelectSchema(employeesTable);

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
