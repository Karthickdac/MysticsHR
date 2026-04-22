import { Router, Request, Response } from "express";
import { db } from "../lib/db";
import { systemSettingsTable, approvalChainConfigsTable, hrmsUsersTable, storageCleanupRunsTable } from "@workspace/db/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { cleanupOrphanedAttachments } from "../lib/orphan-attachment-cleanup";
import { loadAttendanceSuspicionConfig, saveAttendanceSuspicionConfig } from "../lib/attendance-suspicion";
import { isValidIanaTimezone } from "../lib/timezones";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager"] as const;
const SUPER_ADMIN = ["super_admin"] as const;

// Sensitive categories: only super_admin may read/write
const SENSITIVE_CATEGORIES = ["email", "whatsapp"] as const;

// Known fields per credential category. Used to compute the source ("db" vs
// "default") for every field, even when nothing has been saved yet — so the
// UI can render an accurate badge for fields the admin hasn't touched.
const CREDENTIAL_FIELDS: Record<string, readonly string[]> = {
  email: ["host", "port", "secure", "username", "password", "from"],
  whatsapp: ["phone_number_id", "access_token"],
};

// ─── System Settings ──────────────────────────────────────────────────────────

router.get("/system-settings/:category", requireHrmsUser, requireRole(...HR_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const category = req.params.category as string;
    const user = req.hrmsUser!;

    // Sensitive config (email/whatsapp credentials) is super_admin only
    if ((SENSITIVE_CATEGORIES as readonly string[]).includes(category) && user.role !== "super_admin") {
      res.status(403).json({ error: "Only super admin may view credential settings" }); return;
    }

    const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, category));
    const result: Record<string, unknown> = {};
    const dbKeys = new Set<string>();
    for (const r of rows) {
      result[r.key] = r.value;
      dbKeys.add(r.key);
    }

    // When the client requests source attribution (?withSource=true), return
    // an envelope { values, sources } where each known field is tagged "db"
    // (a row exists in system_settings) or "default" (the runtime falls back
    // to a server env var). We never return the actual default value — only
    // the source label — so server secrets stay on the server.
    if (req.query["withSource"] === "true") {
      const knownFields = CREDENTIAL_FIELDS[category] ?? [];
      const allKeys = new Set<string>([...knownFields, ...dbKeys]);
      const sources: Record<string, "db" | "default"> = {};
      for (const k of allKeys) sources[k] = dbKeys.has(k) ? "db" : "default";
      res.json({ values: result, sources });
      return;
    }

    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/system-settings/:category", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req: Request, res: Response) => {
  try {
    const category = req.params.category as string;
    const data = req.body as Record<string, unknown>;

    if (category === "org_profile" && data.timezone !== undefined && data.timezone !== null && data.timezone !== "") {
      if (!isValidIanaTimezone(data.timezone)) {
        res.status(400).json({ error: "Invalid IANA timezone identifier" });
        return;
      }
    }

    for (const [key, value] of Object.entries(data)) {
      const jsonValue = value as (Record<string, unknown> | string | number | boolean | null);
      const existing = await db.select({ id: systemSettingsTable.id }).from(systemSettingsTable)
        .where(and(eq(systemSettingsTable.category, category), eq(systemSettingsTable.key, key)));
      if (existing.length) {
        await db.update(systemSettingsTable)
          .set({ value: jsonValue, updatedAt: new Date() })
          .where(and(eq(systemSettingsTable.category, category), eq(systemSettingsTable.key, key)));
      } else {
        await db.insert(systemSettingsTable).values({ category, key, value: jsonValue });
      }
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// ─── Approval Chain Configs ───────────────────────────────────────────────────

router.get("/approval-chains", requireHrmsUser, requireRole(...HR_ROLES), async (_req, res) => {
  try {
    const chains = await db.select().from(approvalChainConfigsTable).orderBy(
      approvalChainConfigsTable.transactionType, approvalChainConfigsTable.step
    );
    res.json(chains);
  } catch {
    res.status(500).json({ error: "Failed to list approval chains" });
  }
});

const VALID_ROLES = ["super_admin", "hr_manager", "hod", "payroll_admin", "employee", "auditor"] as const;
const VALID_TRANSACTION_TYPES = ["leave", "helpdesk", "exit", "payroll", "recruitment", "onboarding"] as const;

function validateApprovalChainBody(body: Record<string, unknown>): string | null {
  const { approverRole, escalateTo, transactionType } = body;
  if (approverRole && !VALID_ROLES.includes(approverRole as never)) {
    return `Invalid approverRole "${approverRole}". Must be one of: ${VALID_ROLES.join(", ")}`;
  }
  if (escalateTo && !VALID_ROLES.includes(escalateTo as never)) {
    return `Invalid escalateTo "${escalateTo}". Must be one of: ${VALID_ROLES.join(", ")}`;
  }
  if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType as never)) {
    return `Invalid transactionType "${transactionType}". Must be one of: ${VALID_TRANSACTION_TYPES.join(", ")}`;
  }
  return null;
}

router.post("/approval-chains", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const validationError = validateApprovalChainBody(req.body as Record<string, unknown>);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    const { transactionType, step, approverRole, approverLabel, isActive, escalationAfterHours, escalateTo, conditions } = req.body;
    if (!transactionType || !approverRole || !approverLabel) { res.status(400).json({ error: "transactionType, approverRole, and approverLabel are required" }); return; }
    const [created] = await db.insert(approvalChainConfigsTable).values({
      transactionType, step: step ?? 1, approverRole, approverLabel,
      isActive: isActive ?? true, escalationAfterHours, escalateTo, conditions,
    }).returning();
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create approval chain" });
  }
});

router.put("/approval-chains/:id", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const validationError = validateApprovalChainBody(req.body as Record<string, unknown>);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    const { step, approverRole, approverLabel, isActive, escalationAfterHours, escalateTo, conditions } = req.body;
    const [updated] = await db.update(approvalChainConfigsTable)
      .set({ step, approverRole, approverLabel, isActive, escalationAfterHours, escalateTo, conditions, updatedAt: new Date() })
      .where(eq(approvalChainConfigsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update approval chain" });
  }
});

router.delete("/approval-chains/:id", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, id));
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete approval chain" });
  }
});

// ─── RBAC Role Permissions ────────────────────────────────────────────────────
// Returns a capability matrix: for each module, which roles can do what actions

const DEFAULT_PERMISSIONS: Record<string, Record<string, string[]>> = {
  employees:   { view: ["super_admin","hr_manager","hr_executive","hod"], create: ["super_admin","hr_manager"], edit: ["super_admin","hr_manager","hr_executive"], delete: ["super_admin"] },
  leave:       { view: ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"], approve: ["super_admin","hr_manager","hr_executive","hod"], manage: ["super_admin","hr_manager"] },
  payroll:     { view: ["super_admin","hr_manager","payroll_admin"], run: ["super_admin","payroll_admin"], approve: ["super_admin","hr_manager"], lock: ["super_admin","payroll_admin"] },
  attendance:  { view: ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"], regularize: ["super_admin","hr_manager","hr_executive","hod","employee"] },
  helpdesk:    { view: ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"], manage: ["super_admin","hr_manager","hr_executive"] },
  recruitment: { view: ["super_admin","hr_manager","hr_executive"], manage: ["super_admin","hr_manager","hr_executive"] },
  exit:        { view: ["super_admin","hr_manager","hr_executive","payroll_admin"], approve: ["super_admin","hr_manager"] },
  documents:   { view: ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"], generate: ["super_admin","hr_manager","hr_executive"] },
  performance: { view: ["super_admin","hr_manager","hr_executive","hod","employee"], manage: ["super_admin","hr_manager","hr_executive","hod"] },
  reports:     { view: ["super_admin","hr_manager","hr_executive","payroll_admin"], export: ["super_admin","hr_manager"] },
  system:      { manage: ["super_admin"] },
};

router.get("/role-permissions", requireHrmsUser, requireRole(...HR_ROLES), async (_req, res) => {
  try {
    // Load any overrides from system_settings
    const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, "role_permissions"));
    const overrides: Record<string, Record<string, string[]>> = {};
    for (const r of rows) {
      const [module, action] = r.key.split(".");
      if (module && action) {
        if (!overrides[module]) overrides[module] = {};
        overrides[module][action] = r.value as string[];
      }
    }
    // Merge defaults with DB overrides
    const matrix: Record<string, Record<string, string[]>> = {};
    for (const [mod, actions] of Object.entries(DEFAULT_PERMISSIONS)) {
      matrix[mod] = {};
      for (const [action, roles] of Object.entries(actions)) {
        matrix[mod][action] = overrides[mod]?.[action] ?? roles;
      }
    }
    res.json(matrix);
  } catch {
    res.status(500).json({ error: "Failed to load role permissions" });
  }
});

router.put("/role-permissions", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  const VALID_ROLES = new Set(["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"]);
  try {
    const body = req.body;
    // Validate payload structure: must be an object of objects of string arrays
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be an object (module → action → roles[])" });
      return;
    }
    for (const [module, actions] of Object.entries(body as Record<string, unknown>)) {
      if (typeof actions !== "object" || actions === null || Array.isArray(actions)) {
        res.status(400).json({ error: `Module "${module}" must map to an object of action → roles[]` });
        return;
      }
      for (const [action, roles] of Object.entries(actions as Record<string, unknown>)) {
        if (!Array.isArray(roles) || !roles.every(r => typeof r === "string" && VALID_ROLES.has(r))) {
          res.status(400).json({ error: `"${module}.${action}" must be an array of valid role names` });
          return;
        }
      }
    }
    // Persist to system_settings (category = role_permissions, key = module.action)
    const matrix = body as Record<string, Record<string, string[]>>;
    for (const [module, actions] of Object.entries(matrix)) {
      for (const [action, roles] of Object.entries(actions)) {
        const key = `${module}.${action}`;
        const jsonValue = roles as unknown as (Record<string, unknown> | string | number | boolean | null);
        const existing = await db.select({ id: systemSettingsTable.id }).from(systemSettingsTable)
          .where(and(eq(systemSettingsTable.category, "role_permissions"), eq(systemSettingsTable.key, key)));
        if (existing.length) {
          await db.update(systemSettingsTable)
            .set({ value: jsonValue, updatedAt: new Date() })
            .where(and(eq(systemSettingsTable.category, "role_permissions"), eq(systemSettingsTable.key, key)));
        } else {
          await db.insert(systemSettingsTable).values({ category: "role_permissions", key, value: jsonValue });
        }
      }
    }
    res.json(matrix);
  } catch {
    res.status(500).json({ error: "Failed to save role permissions" });
  }
});

// ─── Custom Employee Fields ───────────────────────────────────────────────────
// Stored in system_settings with category="custom_employee_fields", key=unique ID

router.get("/custom-fields", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (_req, res) => {
  try {
    const rows = await db.select().from(systemSettingsTable)
      .where(eq(systemSettingsTable.category, "custom_employee_fields"))
      .orderBy(systemSettingsTable.key);
    const fields = rows.map(r => {
      const val = r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : {};
      return { id: r.key, ...val };
    });
    res.json(fields);
  } catch { res.status(500).json({ error: "Failed to fetch custom fields" }); }
});

router.post("/custom-fields", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const { name, type, required, options, placeholder } = req.body as { name: string; type: string; required?: boolean; options?: unknown[]; placeholder?: string };
    if (!name || !type) { res.status(400).json({ error: "name and type are required" }); return; }
    const id = `field_${Date.now()}`;
    const payload = { name, type, required: !!required, options: options ?? [], placeholder: placeholder ?? "" };
    await db.insert(systemSettingsTable).values({
      category: "custom_employee_fields", key: id,
      value: payload,
    });
    res.status(201).json({ id, ...payload });
  } catch { res.status(500).json({ error: "Failed to create custom field" }); }
});

router.put("/custom-fields/:id", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const { name, type, required, options, placeholder } = req.body as { name: string; type: string; required?: boolean; options?: unknown[]; placeholder?: string };
    const key = req.params["id"] as string;
    const existing = await db.select({ id: systemSettingsTable.id }).from(systemSettingsTable)
      .where(and(eq(systemSettingsTable.category, "custom_employee_fields"), eq(systemSettingsTable.key, key))).limit(1);
    if (!existing.length) { res.status(404).json({ error: "Field not found" }); return; }
    const payload = { name, type, required: !!required, options: options ?? [], placeholder: placeholder ?? "" };
    await db.update(systemSettingsTable)
      .set({ value: payload })
      .where(and(eq(systemSettingsTable.category, "custom_employee_fields"), eq(systemSettingsTable.key, key)));
    res.json({ id: key, ...payload });
  } catch { res.status(500).json({ error: "Failed to update custom field" }); }
});

router.delete("/custom-fields/:id", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const key = req.params["id"] as string;
    await db.delete(systemSettingsTable)
      .where(and(eq(systemSettingsTable.category, "custom_employee_fields"), eq(systemSettingsTable.key, key)));
    res.status(204).end();
  } catch { res.status(500).json({ error: "Failed to delete custom field" }); }
});

// ─── Leave Blackout Dates ─────────────────────────────────────────────────────
// Stored in system_settings with category="leave_blackout_dates", key=unique ID

router.get("/leave-blackouts", requireHrmsUser, requireRole("super_admin", "hr_manager", "hod", "employee", "payroll_admin"), async (_req, res) => {
  try {
    const rows = await db.select().from(systemSettingsTable)
      .where(eq(systemSettingsTable.category, "leave_blackout_dates"))
      .orderBy(systemSettingsTable.key);
    const blackouts = rows.map(r => {
      const val = r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : {};
      return { id: r.key, ...val };
    });
    res.json(blackouts);
  } catch { res.status(500).json({ error: "Failed to fetch leave blackouts" }); }
});

router.post("/leave-blackouts", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (req, res) => {
  try {
    const { name, startDate, endDate, reason } = req.body as { name: string; startDate: string; endDate: string; reason?: string };
    if (!name || !startDate || !endDate) { res.status(400).json({ error: "name, startDate, and endDate are required" }); return; }
    const id = `blackout_${Date.now()}`;
    const payload = { name, startDate, endDate, reason: reason ?? "" };
    await db.insert(systemSettingsTable).values({
      category: "leave_blackout_dates", key: id,
      value: payload,
    });
    res.status(201).json({ id, ...payload });
  } catch { res.status(500).json({ error: "Failed to create leave blackout" }); }
});

router.delete("/leave-blackouts/:id", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (req, res) => {
  try {
    const key = req.params["id"] as string;
    await db.delete(systemSettingsTable)
      .where(and(eq(systemSettingsTable.category, "leave_blackout_dates"), eq(systemSettingsTable.key, key)));
    res.status(204).end();
  } catch { res.status(500).json({ error: "Failed to delete leave blackout" }); }
});

// ─── Attendance Suspicion Config ──────────────────────────────────────────────
// Thresholds + registered office coordinates that drive the "Suspicious"
// badge on attendance rows. Stored in system_settings under category
// "attendance_suspicion", key "config".

router.get("/attendance-suspicion-config", requireHrmsUser, requireRole("super_admin", "hr_manager", "hr_executive", "hod"), async (_req, res) => {
  try {
    const cfg = await loadAttendanceSuspicionConfig();
    res.json(cfg);
  } catch {
    res.status(500).json({ error: "Failed to load attendance suspicion config" });
  }
});

router.put("/attendance-suspicion-config", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const saved = await saveAttendanceSuspicionConfig({
      maxAccuracyMeters: body.maxAccuracyMeters as number | undefined,
      maxRadiusMeters: body.maxRadiusMeters as number | undefined,
      offices: Array.isArray(body.offices) ? (body.offices as Array<{ name: string; latitude: number; longitude: number }>) : undefined,
    });
    res.json(saved);
  } catch {
    res.status(500).json({ error: "Failed to save attendance suspicion config" });
  }
});

// ─── Storage Cleanup Activity ─────────────────────────────────────────────────

router.get("/storage-cleanup/runs", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query["limit"] ?? "20"), 10) || 20));
    const rows = await db.select().from(storageCleanupRunsTable)
      .orderBy(desc(storageCleanupRunsTable.startedAt))
      .limit(limit);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to load cleanup runs" });
  }
});

router.post("/storage-cleanup/run", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const user = req.hrmsUser!;
    const dryRun = req.body?.dryRun === true;
    const result = await cleanupOrphanedAttachments({
      triggeredBy: `manual:${user.id}`,
      dryRun,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Cleanup run failed", detail: (err as Error).message });
  }
});

// ─── Utility: Get all active users for broadcast notifications ────────────────
export async function getUsersByRoles(roles: string[]): Promise<Array<{ id: number; email: string; name: string; employeeId: number | null }>> {
  const users = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
    .from(hrmsUsersTable)
    .where(and(
      eq(hrmsUsersTable.isActive, true),
      sql`${hrmsUsersTable.role} = ANY(${roles})`,
    ));
  return users;
}

export default router;
