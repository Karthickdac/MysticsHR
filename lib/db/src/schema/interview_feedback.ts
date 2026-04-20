import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { interviewRoundsTable } from "./interview_rounds";
import { hrmsUsersTable } from "./hrms_users";

export const recommendationEnum = pgEnum("interview_recommendation", [
  "Strong Hire",
  "Hire",
  "No Decision",
  "No Hire",
  "Strong No Hire",
]);

export const interviewFeedbackTable = pgTable("interview_feedback", {
  id: serial("id").primaryKey(),
  interviewRoundId: integer("interview_round_id").notNull().references(() => interviewRoundsTable.id),
  interviewerId: integer("interviewer_id").references(() => hrmsUsersTable.id),
  technicalScore: integer("technical_score"),
  communicationScore: integer("communication_score"),
  problemSolvingScore: integer("problem_solving_score"),
  cultureFitScore: integer("culture_fit_score"),
  overallScore: integer("overall_score"),
  strengths: text("strengths"),
  weaknesses: text("weaknesses"),
  comments: text("comments"),
  recommendation: recommendationEnum("recommendation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InterviewFeedback = typeof interviewFeedbackTable.$inferSelect;
