import { db } from "./db";
import { auditLogsTable } from "@workspace/db/schema";
import type { HrmsUser } from "@workspace/db/schema";

export async function logAudit(params: {
  user?: HrmsUser | null;
  action: string;
  module: string;
  recordId?: string | number;
  fieldName?: string;
  previousValue?: string;
  newValue?: string;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogsTable).values({
      userId: params.user?.id ?? null,
      userEmail: params.user?.email ?? null,
      action: params.action,
      module: params.module,
      recordId: params.recordId !== undefined ? String(params.recordId) : null,
      fieldName: params.fieldName ?? null,
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch (err) {
    console.warn("[audit] Failed to write audit log entry:", err);
  }
}
