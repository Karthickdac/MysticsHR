import { pgTable, serial, text, integer, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "Not Started",
  "In Progress",
  "Completed",
]);

export const onboardingTaskCategoryEnum = pgEnum("onboarding_task_category", [
  "HR",
  "IT",
  "Department",
  "Employee",
]);

export const onboardingChecklistsTable = pgTable("onboarding_checklists", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().unique().references(() => employeesTable.id),
  status: onboardingStatusEnum("status").notNull().default("Not Started"),
  completionPercentage: integer("completion_percentage").notNull().default(0),
  joiningDate: date("joining_date"),
  welcomeEmailSentAt: timestamp("welcome_email_sent_at", { withTimezone: true }),
  idCardGeneratedAt: timestamp("id_card_generated_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const onboardingTasksTable = pgTable("onboarding_tasks", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => onboardingChecklistsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  category: onboardingTaskCategoryEnum("category").notNull().default("HR"),
  assigneeRole: text("assignee_role"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedById: integer("completed_by_id").references(() => hrmsUsersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inductionSessionsTable = pgTable("induction_sessions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  sessionDate: date("session_date").notNull(),
  trainerName: text("trainer_name").notNull(),
  topics: text("topics"),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  recordedById: integer("recorded_by_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OnboardingChecklist = typeof onboardingChecklistsTable.$inferSelect;
export type OnboardingTask = typeof onboardingTasksTable.$inferSelect;
export type InductionSession = typeof inductionSessionsTable.$inferSelect;
