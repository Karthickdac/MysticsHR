import { pgTable, serial, text, integer, boolean, timestamp, date, numeric, pgEnum } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";
import { departmentsTable } from "./departments";

export const leaveStatusEnum = pgEnum("leave_status", [
  "Pending", "HOD Approved", "HR Approved", "Approved", "Rejected", "Cancelled", "Cancel Requested",
]);

export const permissionStatusEnum = pgEnum("permission_status", [
  "Pending", "Approved", "Rejected", "Cancelled",
]);

export const leaveTypesTable = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  annualQuota: numeric("annual_quota", { precision: 5, scale: 1 }).notNull().default("0"),
  carryForwardEnabled: boolean("carry_forward_enabled").notNull().default(false),
  carryForwardMax: numeric("carry_forward_max", { precision: 5, scale: 1 }),
  encashmentEnabled: boolean("encashment_enabled").notNull().default(false),
  applicableEmploymentTypes: text("applicable_employment_types").array(),
  minConsecutiveDays: numeric("min_consecutive_days", { precision: 3, scale: 1 }).default("0.5"),
  maxConsecutiveDays: numeric("max_consecutive_days", { precision: 5, scale: 1 }),
  advanceNoticeDays: integer("advance_notice_days").notNull().default(0),
  requiresHrApproval: boolean("requires_hr_approval").notNull().default(true),
  requiresHodApproval: boolean("requires_hod_approval").notNull().default(true),
  allowHalfDay: boolean("allow_half_day").notNull().default(true),
  lopByDefault: boolean("lop_by_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// leave_policies: configurable behaviour layer per leave type (1:1 with leave_types).
// Authoritative source for approval workflow, eligibility, accrual, and consecutive-day rules.
export const leavePoliciesTable = pgTable("leave_policies", {
  id: serial("id").primaryKey(),
  leaveTypeId: integer("leave_type_id").notNull().unique().references(() => leaveTypesTable.id),
  requiresHodApproval: boolean("requires_hod_approval").notNull().default(true),
  requiresHrApproval: boolean("requires_hr_approval").notNull().default(true),
  advanceNoticeDays: integer("advance_notice_days").notNull().default(0),
  minConsecutiveDays: numeric("min_consecutive_days", { precision: 3, scale: 1 }).default("0.5"),
  maxConsecutiveDays: numeric("max_consecutive_days", { precision: 5, scale: 1 }),
  allowHalfDay: boolean("allow_half_day").notNull().default(true),
  lopByDefault: boolean("lop_by_default").notNull().default(false),
  carryForwardEnabled: boolean("carry_forward_enabled").notNull().default(false),
  carryForwardMax: numeric("carry_forward_max", { precision: 5, scale: 1 }),
  encashmentEnabled: boolean("encashment_enabled").notNull().default(false),
  applicableEmploymentTypes: text("applicable_employment_types").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveBalancesTable = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id),
  year: integer("year").notNull(),
  allocated: numeric("allocated", { precision: 5, scale: 1 }).notNull().default("0"),
  used: numeric("used", { precision: 5, scale: 1 }).notNull().default("0"),
  pending: numeric("pending", { precision: 5, scale: 1 }).notNull().default("0"),
  carryForward: numeric("carry_forward", { precision: 5, scale: 1 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveApplicationsTable = pgTable("leave_applications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  totalDays: numeric("total_days", { precision: 5, scale: 1 }).notNull(),
  isHalfDay: boolean("is_half_day").notNull().default(false),
  halfDaySession: text("half_day_session"),
  reason: text("reason").notNull(),
  documentUrl: text("document_url"),
  status: leaveStatusEnum("status").notNull().default("Pending"),
  isLop: boolean("is_lop").notNull().default(false),
  lopConfirmed: boolean("lop_confirmed").notNull().default(false),
  hodActionedById: integer("hod_actioned_by_id").references(() => hrmsUsersTable.id),
  hodRemarks: text("hod_remarks"),
  hodActionedAt: timestamp("hod_actioned_at", { withTimezone: true }),
  hrActionedById: integer("hr_actioned_by_id").references(() => hrmsUsersTable.id),
  hrRemarks: text("hr_remarks"),
  hrActionedAt: timestamp("hr_actioned_at", { withTimezone: true }),
  cancelledById: integer("cancelled_by_id").references(() => hrmsUsersTable.id),
  cancellationReason: text("cancellation_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveAccrualHistoryTable = pgTable("leave_accrual_history", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id),
  year: integer("year").notNull(),
  month: integer("month"),
  accrualType: text("accrual_type").notNull(),
  days: numeric("days", { precision: 5, scale: 1 }).notNull(),
  notes: text("notes"),
  processedById: integer("processed_by_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blackoutDatesTable = pgTable("blackout_dates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  reason: text("reason"),
  createdById: integer("created_by_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissionApplicationsTable = pgTable("permission_applications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  permissionDate: date("permission_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  reason: text("reason").notNull(),
  status: permissionStatusEnum("status").notNull().default("Pending"),
  hodActionedById: integer("hod_actioned_by_id").references(() => hrmsUsersTable.id),
  hodRemarks: text("hod_remarks"),
  hodActionedAt: timestamp("hod_actioned_at", { withTimezone: true }),
  isOverride: boolean("is_override").notNull().default(false),
  overrideJustification: text("override_justification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissionRegistersTable = pgTable("permission_registers", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  usedMinutes: integer("used_minutes").notNull().default(0),
  limitMinutes: integer("limit_minutes").notNull().default(240),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
