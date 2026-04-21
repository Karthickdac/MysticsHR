import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { attendanceRecordsTable } from "@workspace/db/schema";

type Tx = Parameters<Parameters<typeof import("./db").db.transaction>[0]>[0];

function* iterateDates(fromDate: string, toDate: string): Generator<string> {
  const start = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  const cur = new Date(start);
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function autoNote(leaveAppId: number): string {
  return `Auto: leave application #${leaveAppId}`;
}

/**
 * When a leave is approved, mark each day in [fromDate, toDate] as "On Leave".
 * - Existing "Absent" or "Regularization Pending" rows are upgraded to "On Leave".
 * - Missing rows are inserted with status "On Leave".
 * - Rows with other statuses (Present, Half-Day, Holiday, Week Off, On Permission)
 *   and HR-overridden rows are left untouched.
 */
export async function applyLeaveToAttendance(
  tx: Tx,
  leaveAppId: number,
  employeeId: number,
  fromDate: string,
  toDate: string,
): Promise<{ inserted: number; updated: number }> {
  const note = autoNote(leaveAppId);
  const existing = await tx
    .select({
      id: attendanceRecordsTable.id,
      attendanceDate: attendanceRecordsTable.attendanceDate,
      status: attendanceRecordsTable.status,
      isHrOverride: attendanceRecordsTable.isHrOverride,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.employeeId, employeeId),
        gte(attendanceRecordsTable.attendanceDate, fromDate),
        lte(attendanceRecordsTable.attendanceDate, toDate),
      ),
    );
  const byDate = new Map(existing.map((r) => [String(r.attendanceDate), r]));

  const toUpdate: number[] = [];
  const toInsert: { employeeId: number; attendanceDate: string; status: "On Leave"; notes: string }[] = [];

  for (const day of iterateDates(fromDate, toDate)) {
    const row = byDate.get(day);
    if (!row) {
      toInsert.push({ employeeId, attendanceDate: day, status: "On Leave", notes: note });
    } else if (!row.isHrOverride && (row.status === "Absent" || row.status === "Regularization Pending")) {
      toUpdate.push(row.id);
    }
  }

  if (toUpdate.length > 0) {
    await tx
      .update(attendanceRecordsTable)
      .set({ status: "On Leave", notes: note, updatedAt: new Date() })
      .where(inArray(attendanceRecordsTable.id, toUpdate));
  }
  if (toInsert.length > 0) {
    await tx.insert(attendanceRecordsTable).values(toInsert);
  }
  return { inserted: toInsert.length, updated: toUpdate.length };
}

/**
 * When an approved leave is cancelled, undo the attendance changes that were
 * auto-applied for it. Only rows whose notes still reference this leave
 * application are reverted, so manual HR edits made after the fact are
 * preserved.
 */
export async function revertLeaveFromAttendance(
  tx: Tx,
  leaveAppId: number,
  employeeId: number,
  fromDate: string,
  toDate: string,
): Promise<void> {
  const note = autoNote(leaveAppId);
  const rows = await tx
    .select({
      id: attendanceRecordsTable.id,
      signInTime: attendanceRecordsTable.signInTime,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.employeeId, employeeId),
        gte(attendanceRecordsTable.attendanceDate, fromDate),
        lte(attendanceRecordsTable.attendanceDate, toDate),
        eq(attendanceRecordsTable.status, "On Leave"),
        eq(attendanceRecordsTable.notes, note),
      ),
    );
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await tx
    .update(attendanceRecordsTable)
    .set({ status: "Absent", notes: null, updatedAt: new Date() })
    .where(inArray(attendanceRecordsTable.id, ids));
}

/**
 * Like {@link revertLeaveFromAttendance} but operates on an explicit list of
 * dates (used when an HR edit shrinks a leave's date range and only specific
 * days need to be reverted, not a contiguous sub-range). Same safety rules:
 * only rows that are still status "On Leave" with the auto-note for this
 * leave application are reverted to "Absent".
 */
export async function revertLeaveDaysFromAttendance(
  tx: Tx,
  leaveAppId: number,
  employeeId: number,
  dates: string[],
): Promise<void> {
  if (dates.length === 0) return;
  const note = autoNote(leaveAppId);
  const rows = await tx
    .select({ id: attendanceRecordsTable.id })
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.employeeId, employeeId),
        inArray(attendanceRecordsTable.attendanceDate, dates),
        eq(attendanceRecordsTable.status, "On Leave"),
        eq(attendanceRecordsTable.notes, note),
      ),
    );
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await tx
    .update(attendanceRecordsTable)
    .set({ status: "Absent", notes: null, updatedAt: new Date() })
    .where(inArray(attendanceRecordsTable.id, ids));
}

/** Enumerate all YYYY-MM-DD dates in [from, to] inclusive. */
export function listDatesInRange(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (const d of iterateDates(fromDate, toDate)) out.push(d);
  return out;
}
