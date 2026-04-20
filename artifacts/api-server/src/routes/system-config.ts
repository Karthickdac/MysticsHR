import { Router } from "express";
import { db } from "../lib/db";
import { systemSettingsTable, approvalChainConfigsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireHrmsUser, requireRole } from "../lib/auth";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager"] as const;
const SUPER_ADMIN = ["super_admin"] as const;

// ─── System Settings ──────────────────────────────────────────────────────────

router.get("/system-settings/:category", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const category = req.params.category as string;
    const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.category, category));
    const result: Record<string, unknown> = {};
    for (const r of rows) result[r.key] = r.value;
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/system-settings/:category", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
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

export default router;
