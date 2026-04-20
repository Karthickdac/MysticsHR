import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { hrmsUsersTable } from "./hrms_users";

export const interviewStatusEnum = pgEnum("interview_status", [
  "Scheduled",
  "Completed",
  "Cancelled",
  "No Show",
]);

export const interviewRoundsTable = pgTable("interview_rounds", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  roundNumber: integer("round_number").notNull().default(1),
  roundName: text("round_name").notNull(),
  interviewerId: integer("interviewer_id").references(() => hrmsUsersTable.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  mode: text("mode").notNull().default("Video"),
  meetingLink: text("meeting_link"),
  location: text("location"),
  status: interviewStatusEnum("status").notNull().default("Scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InterviewRound = typeof interviewRoundsTable.$inferSelect;
