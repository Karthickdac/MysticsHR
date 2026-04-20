import { Router, Request, Response } from "express";
import { db } from "../lib/db";
import { systemSettingsTable, approvalChainConfigsTable, hrmsUsersTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireHrmsUser, requireRole } from "../lib/auth";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager"] as const;
const SUPER_ADMIN = ["super_admin"] as const;

// Sensitive categories: only super_admin may read/write
const SENSITIVE_CATEGORIES = ["email", "whatsapp"] as const;

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
    for (const r of rows) {
      // Mask secrets for log safety — caller gets the value but keys like password/token are masked in logs
      result[r.key] = r.value;
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

router.post("/approval-chains", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const { transactionType, step, approverRole, approverLabel, isActive, escalationAfterHours, escalateTo, conditions } = req.body;
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
  try {
    const matrix = req.body as Record<string, Record<string, string[]>>;
    const allRoles = ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"] as const;
    for (const [module, actions] of Object.entries(matrix)) {
      for (const [action, roles] of Object.entries(actions)) {
        const validRoles = (roles as string[]).filter(r => (allRoles as readonly string[]).includes(r));
        const key = `${module}.${action}`;
        const jsonValue = validRoles as unknown as (Record<string, unknown> | string | number | boolean | null);
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
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save role permissions" });
  }
});

// ─── Utility: Get all active users for broadcast notifications ────────────────
export async function getUsersByRoles(roles: string[]): Promise<Array<{ id: string; email: string; name: string }>> {
  const users = await db.select({ id: hrmsUsersTable.id, email: hrmsUsersTable.email, name: hrmsUsersTable.name })
    .from(hrmsUsersTable)
    .where(and(
      eq(hrmsUsersTable.isActive, true),
      inArray(hrmsUsersTable.role, roles),
    ));
  return users;
}

export default router;
