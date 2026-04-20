import { db } from "./db";
import { payrollLocksTable, payrollLockExceptionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export type LockExceptionType = "edit_salary" | "edit_attendance" | "edit_leave_balance" | "edit_bank_account";

/**
 * Check whether the current payroll period is locked for writes.
 * Returns an error string if locked (and no approved exception exists),
 * or null if the operation is allowed.
 *
 * @param userId    The hrmsUser.id of the requesting user
 * @param exType    The kind of exception that would permit this operation
 */
export async function checkPayrollLock(
  userId: number,
  exType: LockExceptionType,
): Promise<string | null> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

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

  if (exception) return null;

  return "Payroll is locked for the current period. Raise a lock exception to proceed.";
}
