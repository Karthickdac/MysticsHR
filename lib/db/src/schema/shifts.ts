import { pgTable, serial, text, integer, boolean, timestamp, date, numeric, pgEnum } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { hrmsUsersTable } from "./hrms_users";

export const shiftTypeEnum = pgEnum("shift_type", [
  "Fixed",
  "Flexible",
  "Rotational",
  "Night Shift",
]);

export const weekDayEnum = pgEnum("week_day", [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

export const shiftTemplatesTable = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  shiftType: shiftTypeEnum("shift_type").notNull().default("Fixed"),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(0),
  breakDurationMinutes: integer("break_duration_minutes").notNull().default(0),
  minWorkingHoursMinutes: integer("min_working_hours_minutes").notNull().default(480),
  weeklyOff: text("weekly_off").array(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  shiftRatePerHour: numeric("shift_rate_per_hour", { precision: 10, scale: 2 }),
  nightDifferentialRate: numeric("night_differential_rate", { precision: 10, scale: 2 }),
  overtimeThresholdMinutes: integer("overtime_threshold_minutes").notNull().default(30),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shiftAssignmentsTable = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  shiftTemplateId: integer("shift_template_id").notNull().references(() => shiftTemplatesTable.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  assignedById: integer("assigned_by_id").references(() => hrmsUsersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shiftSwapStatusEnum = pgEnum("shift_swap_status", [
  "Pending", "Approved", "Rejected",
]);

export const shiftSwapsTable = pgTable("shift_swaps", {
  id: serial("id").primaryKey(),
  requesterEmployeeId: integer("requester_employee_id").notNull().references(() => employeesTable.id),
  swapWithEmployeeId: integer("swap_with_employee_id").notNull().references(() => employeesTable.id),
  swapDate: date("swap_date").notNull(),
  reason: text("reason"),
  hodStatus: shiftSwapStatusEnum("hod_status").notNull().default("Pending"),
  hodActionedById: integer("hod_actioned_by_id").references(() => hrmsUsersTable.id),
  hodRemarks: text("hod_remarks"),
  hodActionedAt: timestamp("hod_actioned_at", { withTimezone: true }),
  hrStatus: shiftSwapStatusEnum("hr_status").notNull().default("Pending"),
  hrActionedById: integer("hr_actioned_by_id").references(() => hrmsUsersTable.id),
  hrRemarks: text("hr_remarks"),
  hrActionedAt: timestamp("hr_actioned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
