import { pgTable, serial, text, integer, timestamp, pgEnum, numeric } from "drizzle-orm/pg-core";
import { departmentsTable } from "./departments";
import { designationsTable } from "./designations";
import { hrmsUsersTable } from "./hrms_users";

export const requisitionStatusEnum = pgEnum("requisition_status", [
  "Draft",
  "Pending Approval",
  "Approved",
  "Rejected",
  "On Hold",
  "Closed",
]);

export const employmentTypeRequisitionEnum = pgEnum("requisition_employment_type", [
  "Permanent",
  "Contract",
  "Probation",
  "Intern",
  "Part-Time",
]);

export const jobRequisitionsTable = pgTable("job_requisitions", {
  id: serial("id").primaryKey(),
  requisitionCode: text("requisition_code").notNull().unique(),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  designationId: integer("designation_id").references(() => designationsTable.id),
  numberOfPositions: integer("number_of_positions").notNull().default(1),
  employmentType: employmentTypeRequisitionEnum("employment_type").notNull().default("Permanent"),
  location: text("location"),
  experienceMin: integer("experience_min"),
  experienceMax: integer("experience_max"),
  budgetMin: numeric("budget_min", { precision: 14, scale: 2 }),
  budgetMax: numeric("budget_max", { precision: 14, scale: 2 }),
  jobDescription: text("job_description"),
  requiredSkills: text("required_skills"),
  status: requisitionStatusEnum("status").notNull().default("Draft"),
  raisedById: integer("raised_by_id").references(() => hrmsUsersTable.id),
  approverId: integer("approver_id").references(() => hrmsUsersTable.id),
  approvalNotes: text("approval_notes"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type JobRequisition = typeof jobRequisitionsTable.$inferSelect;
