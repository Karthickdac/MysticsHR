import {
  pgTable, serial, integer, boolean, timestamp, date, numeric, pgEnum, text, jsonb,
} from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const salaryComponentTypeEnum = pgEnum("salary_component_type", [
  "Basic",
  "HRA",
  "Special Allowance",
  "Travel Allowance",
  "Medical Allowance",
  "Performance Bonus",
  "Shift Allowance",
  "Night Differential Pay",
  "Other Earning",
  "PF Employee",
  "PF Employer",
  "ESI Employee",
  "ESI Employer",
  "Professional Tax",
  "TDS",
  "LOP Deduction",
  "Loan Repayment",
  "Other Deduction",
]);

export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "Draft", "Processing", "Computed", "Approved", "Locked",
]);

export const payrollRecordStatusEnum = pgEnum("payroll_record_status", [
  "Pending", "Approved", "Paid",
]);

export const taxRegimeEnum = pgEnum("tax_regime", ["Old", "New"]);

export const salaryRevisionStatusEnum = pgEnum("salary_revision_status", [
  "Pending", "Approved", "Rejected",
]);

export const lockExceptionTypeEnum = pgEnum("lock_exception_type", [
  "edit_salary", "edit_attendance", "edit_leave_balance", "edit_bank_account",
]);

export const lockExceptionStatusEnum = pgEnum("lock_exception_status", [
  "Pending", "Approved", "Rejected",
]);

// ─── SALARY STRUCTURES ────────────────────────────────────────────────────────
// One "active" structure per employee at a given time (soft-versioned via effective dates)
export const salaryStructuresTable = pgTable("salary_structures", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  name: text("name").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  grossCtc: numeric("gross_ctc", { precision: 12, scale: 2 }).notNull().default("0"),
  annualCtc: numeric("annual_ctc", { precision: 14, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── SALARY COMPONENTS ────────────────────────────────────────────────────────
// Individual earning/deduction rows within a salary structure
export const salaryComponentsTable = pgTable("salary_components", {
  id: serial("id").primaryKey(),
  salaryStructureId: integer("salary_structure_id").notNull().references(() => salaryStructuresTable.id),
  componentType: salaryComponentTypeEnum("component_type").notNull(),
  componentName: text("component_name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  percentageOfBasic: numeric("percentage_of_basic", { precision: 6, scale: 2 }),
  isEarning: boolean("is_earning").notNull().default(true),
  sequence: integer("sequence").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PAYROLL RUNS ─────────────────────────────────────────────────────────────
// A single monthly payroll processing cycle
export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  status: payrollRunStatusEnum("status").notNull().default("Draft"),
  initiatedById: integer("initiated_by_id").references(() => hrmsUsersTable.id),
  approvedById: integer("approved_by_id").references(() => hrmsUsersTable.id),
  runAt: timestamp("run_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  totalEmployees: integer("total_employees").notNull().default(0),
  totalGross: numeric("total_gross", { precision: 14, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  totalNet: numeric("total_net", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PAYROLL RECORDS ──────────────────────────────────────────────────────────
// Per-employee result within a payroll run
export const payrollRecordsTable = pgTable("payroll_records", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRunsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  salaryStructureId: integer("salary_structure_id").references(() => salaryStructuresTable.id),
  workingDays: numeric("working_days", { precision: 4, scale: 1 }).notNull().default("0"),
  presentDays: numeric("present_days", { precision: 4, scale: 1 }).notNull().default("0"),
  leaveDays: numeric("leave_days", { precision: 4, scale: 1 }).notNull().default("0"),
  lopDays: numeric("lop_days", { precision: 4, scale: 1 }).notNull().default("0"),
  overtimeHours: numeric("overtime_hours", { precision: 6, scale: 2 }).notNull().default("0"),
  basic: numeric("basic", { precision: 12, scale: 2 }).notNull().default("0"),
  hra: numeric("hra", { precision: 12, scale: 2 }).notNull().default("0"),
  specialAllowance: numeric("special_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  travelAllowance: numeric("travel_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  medicalAllowance: numeric("medical_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  performanceBonus: numeric("performance_bonus", { precision: 12, scale: 2 }).notNull().default("0"),
  shiftAllowance: numeric("shift_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  nightDifferential: numeric("night_differential", { precision: 12, scale: 2 }).notNull().default("0"),
  otherEarnings: numeric("other_earnings", { precision: 12, scale: 2 }).notNull().default("0"),
  grossEarnings: numeric("gross_earnings", { precision: 12, scale: 2 }).notNull().default("0"),
  pfEmployee: numeric("pf_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  pfEmployer: numeric("pf_employer", { precision: 12, scale: 2 }).notNull().default("0"),
  esiEmployee: numeric("esi_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  esiEmployer: numeric("esi_employer", { precision: 12, scale: 2 }).notNull().default("0"),
  professionalTax: numeric("professional_tax", { precision: 12, scale: 2 }).notNull().default("0"),
  tds: numeric("tds", { precision: 12, scale: 2 }).notNull().default("0"),
  lopDeduction: numeric("lop_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  loanDeduction: numeric("loan_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  otherDeductions: numeric("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRegime: taxRegimeEnum("tax_regime").default("New"),
  componentBreakdown: jsonb("component_breakdown"),
  status: payrollRecordStatusEnum("status").notNull().default("Pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PAYSLIPS ─────────────────────────────────────────────────────────────────
// Generated payslip (stored as structured JSON + HTML)
export const payslipsTable = pgTable("payslips", {
  id: serial("id").primaryKey(),
  payrollRecordId: integer("payroll_record_id").notNull().references(() => payrollRecordsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  payslipData: jsonb("payslip_data"),
  htmlContent: text("html_content"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TAX REGIME DECLARATIONS ──────────────────────────────────────────────────
// Employee's income tax regime declaration (Old or New) per FY
export const taxRegimeDeclarationsTable = pgTable("tax_regime_declarations", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  financialYear: text("financial_year").notNull(),
  regime: taxRegimeEnum("regime").notNull().default("New"),
  investmentDeclarations: jsonb("investment_declarations"),
  declarationDate: date("declaration_date").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── SALARY REVISIONS ─────────────────────────────────────────────────────────
// Salary revision workflow: HR creates, Super Admin approves
export const salaryRevisionsTable = pgTable("salary_revisions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  oldStructureId: integer("old_structure_id").references(() => salaryStructuresTable.id),
  newStructureId: integer("new_structure_id").references(() => salaryStructuresTable.id),
  effectiveDate: date("effective_date").notNull(),
  reason: text("reason").notNull(),
  status: salaryRevisionStatusEnum("status").notNull().default("Pending"),
  requestedById: integer("requested_by_id").references(() => hrmsUsersTable.id),
  approvedById: integer("approved_by_id").references(() => hrmsUsersTable.id),
  approvalRemarks: text("approval_remarks"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PAYROLL LOCKS ────────────────────────────────────────────────────────────
// Locks a payroll period to prevent edits during computation
export const payrollLocksTable = pgTable("payroll_locks", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  isLocked: boolean("is_locked").notNull().default(false),
  lockedById: integer("locked_by_id").references(() => hrmsUsersTable.id),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  unlockedById: integer("unlocked_by_id").references(() => hrmsUsersTable.id),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PAYROLL LOCK EXCEPTIONS ──────────────────────────────────────────────────
// HR raises an exception request; Super Admin approves to allow editing during lock
export const payrollLockExceptionsTable = pgTable("payroll_lock_exceptions", {
  id: serial("id").primaryKey(),
  payrollLockId: integer("payroll_lock_id").notNull().references(() => payrollLocksTable.id),
  requestedById: integer("requested_by_id").references(() => hrmsUsersTable.id),
  reason: text("reason").notNull(),
  exceptionType: lockExceptionTypeEnum("exception_type").notNull(),
  status: lockExceptionStatusEnum("status").notNull().default("Pending"),
  approvedById: integer("approved_by_id").references(() => hrmsUsersTable.id),
  approvalRemarks: text("approval_remarks"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── LOAN REPAYMENTS ──────────────────────────────────────────────────────────
// Tracks active loan deductions per employee
export const loanRepaymentsTable = pgTable("loan_repayments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  loanType: text("loan_type").notNull(),
  principalAmount: numeric("principal_amount", { precision: 12, scale: 2 }).notNull(),
  monthlyDeduction: numeric("monthly_deduction", { precision: 12, scale: 2 }).notNull(),
  outstandingAmount: numeric("outstanding_amount", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
