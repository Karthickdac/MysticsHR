import { sql } from "drizzle-orm";
import { db } from "./db";
import { DEFAULT_TIMEZONE, isValidIanaTimezone } from "./timezones";

/**
 * One-time idempotent backfill of `employees.timezone` from the
 * configured company default in `system_settings.org_profile.timezone`.
 *
 * The schema's `DEFAULT 'Asia/Kolkata'` gives every existing row a
 * value when the column is added, but the task spec calls for the
 * company-configured timezone to be used. This helper aligns existing
 * rows on first boot after the migration and records a marker so it
 * does not run again.
 */
export async function backfillEmployeeTimezones(): Promise<void> {
  try {
    const markerRows = await db
      .execute<{ value: unknown }>(sql`
        SELECT value FROM system_settings
        WHERE category = 'system' AND key = 'employees_tz_backfilled'
        LIMIT 1
      `)
      .then((r) => r.rows);
    if (markerRows.length > 0) return;

    const [row] = await db
      .execute<{ value: unknown }>(sql`
        SELECT value FROM system_settings
        WHERE category = 'org_profile' AND key = 'timezone'
        LIMIT 1
      `)
      .then((r) => r.rows);
    const companyTz =
      typeof row?.value === "string" && isValidIanaTimezone(row.value)
        ? row.value
        : DEFAULT_TIMEZONE;

    await db.execute(sql`
      UPDATE employees
      SET timezone = ${companyTz}
      WHERE timezone IS NULL OR timezone = '' OR timezone = ${DEFAULT_TIMEZONE}
    `);

    await db.execute(sql`
      INSERT INTO system_settings (category, key, value)
      VALUES ('system', 'employees_tz_backfilled', to_jsonb(true))
      ON CONFLICT DO NOTHING
    `);
  } catch (e) {
    console.error("Timezone backfill failed (non-fatal):", e);
  }
}
