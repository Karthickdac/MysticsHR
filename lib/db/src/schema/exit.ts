import {
  pgTable, serial, integer, text, timestamp, date, boolean, numeric, pgEnum, jsonb,
} from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const exitTypeEnum = pgEnum("exit_type", [
  "Resignation",
  "Termination",
  "Retirement",
  "Contract Expiry",
]);

export const exitStatusEnum = pgEnum("exit_status", [
  "Submitted",
  "HR Reviewing",
  "Notice Period",
  "Clearance Pending",
  "FnF Pending",
  "FnF Approved",
  "Separated",
  "Rejected",
  "Withdrawn",
]);

export const clearanceStatusEnum = pgEnum("clearance_status", [
  "Pending",
  "Completed",
  "Waived",
]);

export const exitRequestsTable = pgTable("exit_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  exitType: exitTypeEnum("exit_type").notNull(),
  status: exitStatusEnum("status").notNull().default("Submitted"),
  reason: text("reason").notNull(),
  requestedLwd: date("requested_lwd").notNull(),
  actualLwd: date("actual_lwd"),
  noticePeriodDays: integer("notice_period_days"),
  noticePeriodWaived: boolean("notice_period_waived").notNull().default(false),
  noticePeriodBuyout: boolean("notice_period_buyout").notNull().default(false),
  hrRemarks: text("hr_remarks"),
  initiatedByUserId: integer("initiated_by_user_id").references(() => hrmsUsersTable.id),
  approvedByUserId: integer("approved_by_user_id").references(() => hrmsUsersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  separatedAt: timestamp("separated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exitClearanceTasksTable = pgTable("exit_clearance_tasks", {
  id: serial("id").primaryKey(),
  exitRequestId: integer("exit_request_id").notNull().references(() => exitRequestsTable.id),
  department: text("department").notNull(),
  taskName: text("task_name").notNull(),
  description: text("description"),
  assignedToUserId: integer("assigned_to_user_id").references(() => hrmsUsersTable.id),
  dueDate: date("due_date"),
  status: clearanceStatusEnum("status").notNull().default("Pending"),
  completedByUserId: integer("completed_by_user_id").references(() => hrmsUsersTable.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fnfComputationsTable = pgTable("fnf_computations", {
  id: serial("id").primaryKey(),
  exitRequestId: integer("exit_request_id").notNull().references(() => exitRequestsTable.id),
  pendingSalary: numeric("pending_salary", { precision: 14, scale: 2 }).notNull().default("0"),
  leaveEncashment: numeric("leave_encashment", { precision: 14, scale: 2 }).notNull().default("0"),
  gratuity: numeric("gratuity", { precision: 14, scale: 2 }).notNull().default("0"),
  bonusProration: numeric("bonus_proration", { precision: 14, scale: 2 }).notNull().default("0"),
  noticePeriodLop: numeric("notice_period_lop", { precision: 14, scale: 2 }).notNull().default("0"),
  otherDeductions: numeric("other_deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  totalPayable: numeric("total_payable", { precision: 14, scale: 2 }).notNull().default("0"),
  computedByUserId: integer("computed_by_user_id").references(() => hrmsUsersTable.id),
  computedAt: timestamp("computed_at", { withTimezone: true }),
  hrApprovedByUserId: integer("hr_approved_by_user_id").references(() => hrmsUsersTable.id),
  hrApprovedAt: timestamp("hr_approved_at", { withTimezone: true }),
  financeApprovedByUserId: integer("finance_approved_by_user_id").references(() => hrmsUsersTable.id),
  financeApprovedAt: timestamp("finance_approved_at", { withTimezone: true }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exitInterviewsTable = pgTable("exit_interviews", {
  id: serial("id").primaryKey(),
  exitRequestId: integer("exit_request_id").notNull().references(() => exitRequestsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  questions: jsonb("questions").notNull().default([]),
  responses: jsonb("responses").notNull().default([]),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reportSchedulesTable = pgTable("report_schedules", {
  id: serial("id").primaryKey(),
  reportType: text("report_type").notNull(),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // daily, weekly, monthly
  recipients: text("recipients").array().notNull().default([]),
  filters: jsonb("filters").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const savedReportTemplatesTable = pgTable("saved_report_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull(),
  selectedFields: text("selected_fields").array().notNull().default([]),
  filters: jsonb("filters").notNull().default({}),
  createdByUserId: integer("created_by_user_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExitRequest = typeof exitRequestsTable.$inferSelect;
export type ExitClearanceTask = typeof exitClearanceTasksTable.$inferSelect;
export type FnfComputation = typeof fnfComputationsTable.$inferSelect;
export type ExitInterview = typeof exitInterviewsTable.$inferSelect;
