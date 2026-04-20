import { db } from "./db";
import { employeeHistoryTable } from "@workspace/db/schema";

export async function recordHistory(
  employeeId: number,
  module: string,
  fieldName: string,
  oldValue: string | null,
  newValue: string | null,
  changedById: number | null | undefined
) {
  if (oldValue !== newValue) {
    await db.insert(employeeHistoryTable).values({
      employeeId,
      module,
      fieldName,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      changedById: changedById ?? null,
    });
  }
}
