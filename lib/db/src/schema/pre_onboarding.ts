import { pgTable, serial, text, integer, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { offerLettersTable } from "./offer_letters";
import { hrmsUsersTable } from "./hrms_users";

export const preOnboardingStatusEnum = pgEnum("pre_onboarding_status", [
  "Pending",
  "In Progress",
  "Completed",
  "Cancelled",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "Pending",
  "Uploaded",
  "Under Verification",
  "Verified",
  "Rejected",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "Government ID",
  "PAN Card",
  "Bank Account Details",
  "Passport Photo",
  "Educational Certificate",
  "Experience Letter",
  "Relieving Letter",
  "Salary Slip",
  "Address Proof",
  "Other",
]);

export const preOnboardingRecordsTable = pgTable("pre_onboarding_records", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  offerLetterId: integer("offer_letter_id").references(() => offerLettersTable.id),
  expectedJoiningDate: date("expected_joining_date").notNull(),
  status: preOnboardingStatusEnum("status").notNull().default("Pending"),
  completionPercentage: integer("completion_percentage").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preOnboardingDocumentsTable = pgTable("pre_onboarding_documents", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull().references(() => preOnboardingRecordsTable.id),
  documentType: documentTypeEnum("document_type").notNull(),
  documentName: text("document_name").notNull(),
  fileUrl: text("file_url"),
  status: documentStatusEnum("status").notNull().default("Pending"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  verifiedById: integer("verified_by_id").references(() => hrmsUsersTable.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  isRequired: integer("is_required").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PreOnboardingRecord = typeof preOnboardingRecordsTable.$inferSelect;
export type PreOnboardingDocument = typeof preOnboardingDocumentsTable.$inferSelect;
