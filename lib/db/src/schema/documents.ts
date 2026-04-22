import {
  pgTable, serial, integer, boolean, timestamp, text, jsonb, pgEnum,
} from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { hrmsUsersTable } from "./hrms_users";

export const hrDocumentTypeEnum = pgEnum("hr_document_type", [
  "Experience Certificate", "Appointment Letter", "Warning Notice",
  "Offer Letter", "NOC", "Relieving Letter",
]);

// ─── DOCUMENT TEMPLATES ───────────────────────────────────────────────────────
export const documentTemplatesTable = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  documentType: hrDocumentTypeEnum("document_type").notNull(),
  name: text("name").notNull(),
  companyName: text("company_name"),
  companyAddress: text("company_address"),
  headerText: text("header_text"),
  footerText: text("footer_text"),
  bodyTemplate: text("body_template").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── ISSUED DOCUMENTS ─────────────────────────────────────────────────────────
export const issuedDocumentsTable = pgTable("issued_documents", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  templateId: integer("template_id").references(() => documentTemplatesTable.id),
  documentType: hrDocumentTypeEnum("document_type").notNull(),
  filename: text("filename").notNull(),
  generatedBy: integer("generated_by").references(() => hrmsUsersTable.id),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  fieldValues: jsonb("field_values").notNull().default({}),
  fileContent: text("file_content"),
});

// ─── DOCUMENT REQUESTS (employee-initiated) ───────────────────────────────────
export const documentRequestStatusEnum = pgEnum("document_request_status", [
  "Pending", "Fulfilled", "Cancelled",
]);

export const documentRequestsTable = pgTable("document_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  documentType: hrDocumentTypeEnum("document_type").notNull(),
  reason: text("reason"),
  // Optional template-specific values supplied by the requester (e.g.
  // designation, ctc, probationPeriod). Prefilled into HR's Generate dialog
  // when HR uses one-click Generate from this pending request, so HR does
  // not have to retype them. Stored as a flat string→string map.
  capturedFields: jsonb("captured_fields").notNull().default({}),
  status: documentRequestStatusEnum("status").notNull().default("Pending"),
  issuedDocumentId: integer("issued_document_id").references(() => issuedDocumentsTable.id),
  fulfilledBy: integer("fulfilled_by").references(() => hrmsUsersTable.id),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  hrNote: text("hr_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── DOCUMENT DOWNLOAD TOKENS (one-time signed links emailed to ex-employees) ─
// Each row authorises a public, unauthenticated download of one specific
// issued document until `expiresAt`. Used today to email exiting employees a
// direct download link to their relieving / experience documents so they
// don't have to log back into MysticsHR.
export const documentDownloadTokensTable = pgTable("document_download_tokens", {
  id: serial("id").primaryKey(),
  issuedDocumentId: integer("issued_document_id").notNull().references(() => issuedDocumentsTable.id),
  // High-entropy random token (32 bytes, base64url). Unique so the public
  // endpoint can look up by the path parameter alone.
  token: text("token").notNull().unique(),
  // Hard expiry — past this point the link is dead even if never used.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Per-link audit trail. `downloadedAt` is the first download time;
  // `downloadCount` lets HR spot abnormal re-use of the link.
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  downloadCount: integer("download_count").notNull().default(0),
  lastIpAddress: text("last_ip_address"),
  // Who created the link (null when issued by a system/cron job).
  createdByUserId: integer("created_by_user_id").references(() => hrmsUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
export type IssuedDocument = typeof issuedDocumentsTable.$inferSelect;
export type DocumentRequest = typeof documentRequestsTable.$inferSelect;
export type DocumentDownloadToken = typeof documentDownloadTokensTable.$inferSelect;
