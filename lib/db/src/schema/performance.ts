import {
  pgTable, serial, integer, boolean, timestamp, date, numeric, pgEnum, text,
} from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const cycleTypeEnum = pgEnum("performance_cycle_type", [
  "Annual", "Semi-Annual", "Quarterly",
]);

export const cycleStatusEnum = pgEnum("performance_cycle_status", [
  "Draft", "Active", "Closed",
]);

export const goalStatusEnum = pgEnum("performance_goal_status", [
  "Draft", "Active", "Completed",
]);

export const appraisalStageEnum = pgEnum("appraisal_stage", [
  "Goal Setting", "Mid Review", "Self Appraisal", "Manager Evaluation", "Calibration", "Completed",
]);

export const appraisalOutcomeEnum = pgEnum("appraisal_outcome_label", [
  "Outstanding", "Exceeds Expectations", "Meets Expectations", "Needs Improvement", "Unsatisfactory",
]);

// ─── PERFORMANCE CYCLES ────────────────────────────────────────────────────────
export const performanceCyclesTable = pgTable("performance_cycles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  cycleType: cycleTypeEnum("cycle_type").notNull().default("Annual"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: cycleStatusEnum("status").notNull().default("Draft"),
  currentStage: appraisalStageEnum("current_stage").notNull().default("Goal Setting"),
  description: text("description"),
  createdBy: integer("created_by").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── PERFORMANCE GOALS (KRA/KPI) ──────────────────────────────────────────────
export const performanceGoalsTable = pgTable("performance_goals", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull().references(() => performanceCyclesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  title: text("title").notNull(),
  description: text("description"),
  weightage: numeric("weightage", { precision: 5, scale: 2 }).notNull().default("10"),
  targetValue: text("target_value"),
  measurementMethod: text("measurement_method"),
  status: goalStatusEnum("status").notNull().default("Draft"),
  assignedBy: integer("assigned_by").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── GOAL PROGRESS UPDATES ────────────────────────────────────────────────────
export const goalProgressTable = pgTable("goal_progress", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => performanceGoalsTable.id),
  progressPercent: integer("progress_percent").notNull().default(0),
  commentary: text("commentary"),
  updatedBy: integer("updated_by").references(() => hrmsUsersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── SELF APPRAISALS ──────────────────────────────────────────────────────────
export const selfAppraisalsTable = pgTable("self_appraisals", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => performanceGoalsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  rating: integer("rating").notNull(),
  commentary: text("commentary"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── MANAGER EVALUATIONS ──────────────────────────────────────────────────────
export const managerEvaluationsTable = pgTable("manager_evaluations", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => performanceGoalsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  rating: integer("rating").notNull(),
  commentary: text("commentary"),
  evaluatedBy: integer("evaluated_by").references(() => hrmsUsersTable.id),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── APPRAISAL OUTCOMES ───────────────────────────────────────────────────────
export const appraisalOutcomesTable = pgTable("appraisal_outcomes", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull().references(() => performanceCyclesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  finalScore: numeric("final_score", { precision: 5, scale: 2 }),
  outcomLabel: appraisalOutcomeEnum("outcome_label"),
  calibrationNote: text("calibration_note"),
  normalizedScore: numeric("normalized_score", { precision: 5, scale: 2 }),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  calculatedBy: integer("calculated_by").references(() => hrmsUsersTable.id),
});
