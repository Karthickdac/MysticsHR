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

export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
export type IssuedDocument = typeof issuedDocumentsTable.$inferSelect;
