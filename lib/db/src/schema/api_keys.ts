import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { hrmsUsersTable } from "./hrms_users";

/**
 * API keys for machine-to-machine access to the public /api/v1 surface.
 *
 * The full secret is only known at creation time; only its SHA-256 hash is
 * stored. Lookup is done by `prefix` (a short, indexable opaque id baked
 * into the key string) followed by a constant-time compare of the hash.
 *
 * Display format presented to the user (and expected in `Authorization`
 * headers) is:
 *     mhr_live_<prefix>_<secret>
 */
export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  hashedSecret: text("hashed_secret").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  createdById: integer("created_by_id").references(() => hrmsUsersTable.id),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = typeof apiKeysTable.$inferInsert;

/** Catalogue of every scope an API key may grant. Keep in sync with v1 routes. */
export const API_KEY_SCOPES = [
  "employees:read",
  "departments:read",
  "attendance:read",
  "payslips:read",
  "leave:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
