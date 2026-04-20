import { pgTable, serial, integer, boolean, timestamp, date, numeric, pgEnum, text } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "Present",
  "Absent",
  "Half-Day",
  "On Leave",
  "On Permission",
  "Holiday",
  "Week Off",
  "Regularization Pending",
]);

export const regularizationStatusEnum = pgEnum("regularization_status", [
  "Pending", "Approved", "Rejected",
]);

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  attendanceDate: date("attendance_date").notNull(),
  signInTime: timestamp("sign_in_time", { withTimezone: true }),
  signOutTime: timestamp("sign_out_time", { withTimezone: true }),
  totalMinutesWorked: integer("total_minutes_worked"),
  breakDurationMinutes: integer("break_duration_minutes").default(0),
  overtimeMinutes: integer("overtime_minutes").default(0),
  status: attendanceStatusEnum("status").notNull().default("Absent"),
  isHrOverride: boolean("is_hr_override").notNull().default(false),
  overrideReason: text("override_reason"),
  overrideById: integer("override_by_id").references(() => hrmsUsersTable.id),
  overrideAt: timestamp("override_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceRegularizationsTable = pgTable("attendance_regularizations", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  attendanceDate: date("attendance_date").notNull(),
  requestedSignIn: timestamp("requested_sign_in", { withTimezone: true }),
  requestedSignOut: timestamp("requested_sign_out", { withTimezone: true }),
  reason: text("reason").notNull(),
  status: regularizationStatusEnum("status").notNull().default("Pending"),
  hodActionedById: integer("hod_actioned_by_id").references(() => hrmsUsersTable.id),
  hodRemarks: text("hod_remarks"),
  hodActionedAt: timestamp("hod_actioned_at", { withTimezone: true }),
  attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecordsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const overtimeRecordsTable = pgTable("overtime_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  attendanceDate: date("attendance_date").notNull(),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  ratePerHour: numeric("rate_per_hour", { precision: 10, scale: 2 }),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
  attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecordsTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
