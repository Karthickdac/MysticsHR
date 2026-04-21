import { and, eq, isNull, sql } from "drizzle-orm";
import {
  employeesTable,
  leaveTypesTable,
  leaveBalancesTable,
  leaveAccrualHistoryTable,
} from "@workspace/db/schema";
import { db } from "./db";
import { logAudit } from "./audit";
import { logger } from "./logger";

export interface CarryForwardSummary {
  fromYear: number;
  toYear: number;
  processed: number;
  carriedForwardCount: number;
  totalDaysCarried: number;
}

export interface CarryForwardOptions {
  employeeId?: number;
  processedById?: number | null;
}

// Stable advisory-lock key used to serialize all carry-forward executions
// (manual + scheduled + multi-replica). Picked to be unique within the
// application's advisory-lock namespace.
const CARRY_FORWARD_LOCK_KEY = 729103949;

export class CarryForwardLockedError extends Error {
  constructor() {
    super("Another carry-forward run is already in progress");
    this.name = "CarryForwardLockedError";
  }
}

/**
 * Roll leave balances from `year` -> `year + 1` for every active employee
 * (or just `options.employeeId` when supplied). Idempotent: skips
 * employee/type pairs that already have a "Carry Forward" accrual entry for
 * the destination year.
 *
 * Concurrency: the entire job runs inside a single outer transaction guarded
 * by a postgres transaction-scoped advisory lock, so concurrent invocations
 * (manual + cron, multiple cron replicas, two HR users clicking at once)
 * serialize cleanly and the second caller sees the first run's writes when
 * deciding whether each pair was "already processed".
 *
 * Throws `CarryForwardLockedError` (HTTP 409 / scheduler-skip) when another
 * run is already holding the lock.
 *
 * Does NOT enforce payroll-lock — the route layer handles that for
 * HR-triggered runs; the scheduled run intentionally bypasses it so the
 * year-end roll happens automatically.
 */
export async function runCarryForwardForYear(
  year: number,
  options: CarryForwardOptions = {},
): Promise<CarryForwardSummary> {
  const nextYear = year + 1;
  const processedById = options.processedById ?? null;

  let locked = false;
  const summary = await db.transaction(async (tx) => {
    const lockRes = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${CARRY_FORWARD_LOCK_KEY}) AS locked`,
    );
    if (!lockRes.rows[0]?.locked) return null;
    locked = true;

    const leaveTypes = await tx.select().from(leaveTypesTable).where(eq(leaveTypesTable.isActive, true));
    const emps = await tx
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(
        and(
          isNull(employeesTable.deletedAt),
          options.employeeId ? eq(employeesTable.id, options.employeeId) : undefined,
        ),
      );

    let processed = 0;
    let carriedForwardCount = 0;
    let totalDaysCarried = 0;

    for (const emp of emps) {
      for (const lt of leaveTypes) {
        const already = await tx
          .select({ id: leaveAccrualHistoryTable.id })
          .from(leaveAccrualHistoryTable)
          .where(
            and(
              eq(leaveAccrualHistoryTable.employeeId, emp.id),
              eq(leaveAccrualHistoryTable.leaveTypeId, lt.id),
              eq(leaveAccrualHistoryTable.year, nextYear),
              sql`${leaveAccrualHistoryTable.accrualType} = 'Carry Forward'`,
            ),
          );
        if (already.length > 0) continue;

        const [srcBal] = await tx.select().from(leaveBalancesTable).where(
          and(
            eq(leaveBalancesTable.employeeId, emp.id),
            eq(leaveBalancesTable.leaveTypeId, lt.id),
            eq(leaveBalancesTable.year, year),
          ),
        );
        const allocated = parseFloat((srcBal?.allocated as string) ?? "0");
        const carryForward = parseFloat((srcBal?.carryForward as string) ?? "0");
        const used = parseFloat((srcBal?.used as string) ?? "0");
        const pending = parseFloat((srcBal?.pending as string) ?? "0");
        const remaining = Math.max(0, allocated + carryForward - used - pending);

        let cf = 0;
        if (lt.carryForwardEnabled) {
          const cap = lt.carryForwardMax != null ? parseFloat(lt.carryForwardMax as string) : Infinity;
          cf = Math.min(remaining, cap);
        }
        const annualQuota = parseFloat((lt.annualQuota as string) ?? "0");

        // Per-pair savepoint so an unexpected error on one pair doesn't
        // abort the whole run; the outer advisory lock still holds.
        await tx.transaction(async (sp) => {
          const [existing] = await sp.select().from(leaveBalancesTable).where(
            and(
              eq(leaveBalancesTable.employeeId, emp.id),
              eq(leaveBalancesTable.leaveTypeId, lt.id),
              eq(leaveBalancesTable.year, nextYear),
            ),
          );
          if (existing) {
            await sp.update(leaveBalancesTable).set({
              allocated: annualQuota.toFixed(1),
              used: "0",
              pending: "0",
              carryForward: cf.toFixed(1),
              updatedAt: new Date(),
            }).where(eq(leaveBalancesTable.id, existing.id));
          } else {
            await sp.insert(leaveBalancesTable).values({
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year: nextYear,
              allocated: annualQuota.toFixed(1),
              used: "0",
              pending: "0",
              carryForward: cf.toFixed(1),
            });
          }
          await sp.insert(leaveAccrualHistoryTable).values({
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year: nextYear,
            accrualType: "Carry Forward",
            days: cf.toFixed(1),
            notes: lt.carryForwardEnabled
              ? `Carried forward ${cf.toFixed(1)} of ${remaining.toFixed(1)} remaining day(s) from ${year}${lt.carryForwardMax != null ? ` (cap ${lt.carryForwardMax})` : ""}; new-year quota ${annualQuota.toFixed(1)}`
              : `Carry-forward disabled for ${lt.name}; reset balances and allocated new-year quota ${annualQuota.toFixed(1)}`,
            processedById,
          });
        });

        processed++;
        if (cf > 0) { carriedForwardCount++; totalDaysCarried += cf; }
      }
    }

    return { fromYear: year, toYear: nextYear, processed, carriedForwardCount, totalDaysCarried };
  });

  if (!locked || !summary) throw new CarryForwardLockedError();
  return summary;
}

/**
 * Scheduled (cron) entrypoint — invoked once on Jan 1 (and as a startup
 * catch-up if the cron tick was missed). Runs the carry-forward for the
 * previous calendar year, writes an audit log entry, and is fully idempotent
 * (re-runs on the same year are no-ops).
 */
export async function runYearEndCarryForwardJob(): Promise<void> {
  const previousYear = new Date().getFullYear() - 1;
  try {
    logger.info({ previousYear }, "[scheduler] year-end carry-forward starting");
    const summary = await runCarryForwardForYear(previousYear);
    await logAudit({
      action: "AUTO_CARRY_FORWARD_LEAVE_BALANCES",
      module: "Leave",
      newValue: `${summary.fromYear}->${summary.toYear}: processed=${summary.processed}, carried=${summary.carriedForwardCount}, days=${summary.totalDaysCarried.toFixed(1)} (scheduled)`,
    });
    logger.info({ ...summary }, "[scheduler] year-end carry-forward complete");
  } catch (err) {
    if (err instanceof CarryForwardLockedError) {
      logger.warn({ previousYear }, "[scheduler] year-end carry-forward skipped — another run holds the lock");
      return;
    }
    logger.error({ err, previousYear }, "[scheduler] year-end carry-forward failed");
    await logAudit({
      action: "AUTO_CARRY_FORWARD_LEAVE_BALANCES_FAILED",
      module: "Leave",
      newValue: `year=${previousYear} error=${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
  }
}

/**
 * Catch-up guard for missed cron ticks (e.g., service down at 02:00 Jan 1).
 * On startup during January, check whether any 'Carry Forward' history rows
 * exist for the current calendar year; if none and active leave types exist,
 * fire the job. The advisory-locked, idempotent core makes this safe even
 * across multiple concurrent boots.
 */
export async function maybeRunYearEndCarryForwardCatchUp(): Promise<void> {
  const now = new Date();
  if (now.getMonth() !== 0) return;
  const currentYear = now.getFullYear();
  try {
    const [{ count: activeTypes }] = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM leave_types WHERE is_active = TRUE`,
    ).then(r => r.rows);
    if (!activeTypes || activeTypes === 0) return;
    const [{ count: existing }] = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM leave_accrual_history
          WHERE year = ${currentYear} AND accrual_type = 'Carry Forward'`,
    ).then(r => r.rows);
    if (existing > 0) return;
    logger.info({ currentYear }, "[scheduler] year-end carry-forward catch-up triggered on startup");
    await runYearEndCarryForwardJob();
  } catch (err) {
    logger.error({ err }, "[scheduler] year-end carry-forward catch-up check failed");
  }
}
