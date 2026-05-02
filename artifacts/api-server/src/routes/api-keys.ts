import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { apiKeysTable, API_KEY_SCOPES } from "@workspace/db/schema";
import { issueApiKey } from "../lib/apiKeys";

const router: ReturnType<typeof Router> = Router();

// Only super admins can mint or revoke API keys.
const ADMIN = ["super_admin"] as const;

router.get("/api-keys", requireHrmsUser, requireRole(...ADMIN), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: apiKeysTable.id,
        name: apiKeysTable.name,
        prefix: apiKeysTable.prefix,
        scopes: apiKeysTable.scopes,
        createdById: apiKeysTable.createdById,
        createdAt: apiKeysTable.createdAt,
        lastUsedAt: apiKeysTable.lastUsedAt,
        expiresAt: apiKeysTable.expiresAt,
        revokedAt: apiKeysTable.revokedAt,
      })
      .from(apiKeysTable)
      .orderBy(desc(apiKeysTable.createdAt));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api-keys", requireHrmsUser, requireRole(...ADMIN), async (req, res) => {
  try {
    const { name, scopes, expiresAt } = req.body as {
      name?: string;
      scopes?: string[];
      expiresAt?: string | null;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Field 'name' is required." });
      return;
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json({ error: "At least one scope must be selected." });
      return;
    }
    const invalid = scopes.filter((s) => !API_KEY_SCOPES.includes(s as any));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown scope(s): ${invalid.join(", ")}` });
      return;
    }

    let expiresAtDate: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "Invalid 'expiresAt' — must be a valid ISO date." });
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        res.status(400).json({ error: "'expiresAt' must be in the future." });
        return;
      }
      expiresAtDate = parsed;
    }

    const issued = issueApiKey();
    const [row] = await db
      .insert(apiKeysTable)
      .values({
        name: name.trim(),
        prefix: issued.prefix,
        hashedSecret: issued.hashedSecret,
        scopes,
        createdById: req.hrmsUser?.id ?? null,
        expiresAt: expiresAtDate,
      })
      .returning();

    await logAudit({
      user: req.hrmsUser,
      action: "API_KEY_CREATE",
      module: "ApiKeys",
      recordId: row.id,
      newValue: `${row.name} (${row.prefix}) scopes=${scopes.join(",")}`,
      ipAddress: req.ip,
    });

    // The full key is shown ONCE — never persisted in plaintext, never returned again.
    res.status(201).json({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      key: issued.fullKey,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api-keys/:id/revoke", requireHrmsUser, requireRole(...ADMIN), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [updated] = await db
      .update(apiKeysTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeysTable.id, id), isNull(apiKeysTable.revokedAt)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Key not found or already revoked" });
      return;
    }
    await logAudit({
      user: req.hrmsUser,
      action: "API_KEY_REVOKE",
      module: "ApiKeys",
      recordId: updated.id,
      newValue: `${updated.name} (${updated.prefix})`,
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
