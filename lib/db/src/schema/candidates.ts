import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { jobRequisitionsTable } from "./job_requisitions";

export const candidateStageEnum = pgEnum("candidate_stage", [
  "Applied",
  "Shortlisted",
  "Interview Scheduled",
  "Interview Completed",
  "Offer Issued",
  "Offer Accepted",
  "Rejected",
  "On Hold",
]);

export const sourceOfHireEnum = pgEnum("source_of_hire", [
  "LinkedIn",
  "Naukri",
  "Indeed",
  "Referral",
  "Walk-In",
  "Campus",
  "Agency",
  "Company Website",
  "Other",
]);

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").references(() => jobRequisitionsTable.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  currentCompany: text("current_company"),
  currentDesignation: text("current_designation"),
  totalExperience: integer("total_experience"),
  currentCtc: text("current_ctc"),
  expectedCtc: text("expected_ctc"),
  noticePeriod: text("notice_period"),
  resumeUrl: text("resume_url"),
  source: sourceOfHireEnum("source").notNull().default("Other"),
  stage: candidateStageEnum("stage").notNull().default("Applied"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Candidate = typeof candidatesTable.$inferSelect;
