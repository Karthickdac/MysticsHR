import { pgTable, serial, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  description: text("description"),
  level: integer("level").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const selectRoleSchema = createSelectSchema(rolesTable);
export type Role = typeof rolesTable.$inferSelect;
