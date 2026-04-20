import { pgTable, serial, text, integer, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const maritalStatusEnum = pgEnum("marital_status", [
  "Single",
  "Married",
  "Divorced",
  "Widowed",
]);

export const bloodGroupEnum = pgEnum("blood_group", [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
]);

export const employeeProfilesTable = pgTable("employee_profiles", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().unique().references(() => employeesTable.id),
  nationalId: text("national_id"),
  pan: text("pan"),
  aadhaar: text("aadhaar"),
  pfNumber: text("pf_number"),
  esiNumber: text("esi_number"),
  uan: text("uan"),
  maritalStatus: maritalStatusEnum("marital_status"),
  bloodGroup: bloodGroupEnum("blood_group"),
  nationality: text("nationality"),
  permanentAddress: text("permanent_address"),
  currentAddress: text("current_address"),
  linkedinUrl: text("linkedin_url"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelation: text("emergency_contact_relation"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  ifscCode: text("ifsc_code"),
  bankName: text("bank_name"),
  bankBranch: text("bank_branch"),
  probationEndDate: date("probation_end_date"),
  confirmationDate: date("confirmation_date"),
  noticePeriodDays: integer("notice_period_days"),
  workLocation: text("work_location"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeProfile = typeof employeeProfilesTable.$inferSelect;
