import { db } from "./db";
import { payrollLocksTable, payrollLockExceptionsTable, auditLogsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export type LockExceptionType = "edit_salary" | "edit_attendance" | "edit_leave_balance" | "edit_bank_account";

/**
 * Check whether a payroll period is locked for writes.
 * Returns an error string if locked (and no approved exception exists),
 * or null if the operation is allowed.
 *
 * When an approved exception permits the write, an audit log entry is recorded
 * so that all lock overrides are traceable.
 *
 * @param userId      The hrmsUser.id of the requesting user
 * @param exType      The kind of exception that would permit this operation
 * @param targetYear  The payroll period year to check (defaults to current year)
 * @param targetMonth The payroll period month to check (defaults to current month)
 * @param userEmail   Optional email for audit log entry
 */
export async function checkPayrollLock(
  userId: number,
  exType: LockExceptionType,
  targetYear?: number,
  targetMonth?: number,
  userEmail?: string,
): Promise<string | null> {
  const now = new Date();
  const year = targetYear ?? now.getFullYear();
  const month = targetMonth ?? (now.getMonth() + 1);

  const [lock] = await db
    .select()
    .from(payrollLocksTable)
    .where(
      and(
        eq(payrollLocksTable.year, year),
        eq(payrollLocksTable.month, month),
        eq(payrollLocksTable.isLocked, true),
      ),
    );

  if (!lock) return null;

  const [exception] = await db
    .select()
    .from(payrollLockExceptionsTable)
    .where(
      and(
        eq(payrollLockExceptionsTable.payrollLockId, lock.id),
        eq(payrollLockExceptionsTable.requestedById, userId),
        eq(payrollLockExceptionsTable.exceptionType, exType),
        eq(payrollLockExceptionsTable.status, "Approved"),
      ),
    );

  if (exception) {
    // Log the override consumption so all lock bypass events are auditable.
    await db.insert(auditLogsTable).values({
      userId: userId,
      userEmail: userEmail ?? null,
      action: "PAYROLL_LOCK_EXCEPTION_USED",
      module: "Payroll",
      recordId: String(exception.id),
      newValue: JSON.stringify({
        lockId: lock.id,
        period: `${year}-${String(month).padStart(2, "0")}`,
        exceptionType: exType,
        exceptionId: exception.id,
      }),
    }).catch(() => {
      // Audit log failure must never block the actual write operation
    });
    return null;
  }

  return `Payroll is locked for ${year}-${String(month).padStart(2, "0")}. Raise a lock exception to proceed.`;
}
