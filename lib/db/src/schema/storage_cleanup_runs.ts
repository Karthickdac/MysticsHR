import { pgTable, serial, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

export const storageCleanupRunsTable = pgTable("storage_cleanup_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  scanned: integer("scanned").notNull().default(0),
  candidates: integer("candidates").notNull().default(0),
  orphans: integer("orphans").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  ageDays: integer("age_days").notNull().default(0),
  dryRun: boolean("dry_run").notNull().default(false),
  durationMs: integer("duration_ms"),
  triggeredBy: text("triggered_by").notNull().default("cron"), // 'cron' | 'manual:<userId>'
  errorMessage: text("error_message"),
});

export type StorageCleanupRun = typeof storageCleanupRunsTable.$inferSelect;
export type NewStorageCleanupRun = typeof storageCleanupRunsTable.$inferInsert;
