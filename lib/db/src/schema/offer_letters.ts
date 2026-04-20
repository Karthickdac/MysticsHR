import { pgTable, serial, text, integer, timestamp, numeric, date, pgEnum } from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { hrmsUsersTable } from "./hrms_users";

export const offerStatusEnum = pgEnum("offer_status", [
  "Draft",
  "Issued",
  "Accepted",
  "Rejected",
  "Withdrawn",
  "Expired",
]);

export const offerLettersTable = pgTable("offer_letters", {
  id: serial("id").primaryKey(),
  offerCode: text("offer_code").notNull().unique(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  jobTitle: text("job_title").notNull(),
  ctc: numeric("ctc", { precision: 14, scale: 2 }).notNull(),
  joiningDate: date("joining_date").notNull(),
  expiryDate: date("expiry_date"),
  letterContent: text("letter_content"),
  letterUrl: text("letter_url"),
  status: offerStatusEnum("status").notNull().default("Draft"),
  issuedById: integer("issued_by_id").references(() => hrmsUsersTable.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OfferLetter = typeof offerLettersTable.$inferSelect;
