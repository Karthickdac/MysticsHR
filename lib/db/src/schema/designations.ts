import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";

export const designationsTable = pgTable("designations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  code: text("code").notNull().unique(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  level: integer("level").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertDesignationSchema = createInsertSchema(designationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const selectDesignationSchema = createSelectSchema(designationsTable);

export type InsertDesignation = z.infer<typeof insertDesignationSchema>;
export type Designation = typeof designationsTable.$inferSelect;
