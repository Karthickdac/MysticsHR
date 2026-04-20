import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { designationsTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const router = Router();

router.get("/designations", requireHrmsUser, async (req, res) => {
  try {
    const departmentId = req.query.departmentId
      ? parseInt(String(req.query.departmentId), 10)
      : undefined;

    const where = departmentId
      ? and(isNull(designationsTable.deletedAt), eq(designationsTable.departmentId, departmentId))
      : isNull(designationsTable.deletedAt);

    const rows = await db
      .select()
      .from(designationsTable)
      .where(where)
      .orderBy(designationsTable.title);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/designations",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const { title, code, departmentId, level } = req.body;
      if (!title || !code) {
        res.status(400).json({ error: "title and code are required" });
        return;
      }
      const [desig] = await db
        .insert(designationsTable)
        .values({ title, code, departmentId, level })
        .returning();
      await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Designations", recordId: desig.id, ipAddress: req.ip });
      res.status(201).json(desig);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        res.status(409).json({ error: "Designation code already exists" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/designations/:id", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [desig] = await db
      .select()
      .from(designationsTable)
      .where(and(eq(designationsTable.id, id), isNull(designationsTable.deletedAt)))
      .limit(1);
    if (!desig) {
      res.status(404).json({ error: "Designation not found" });
      return;
    }
    res.json(desig);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/designations/:id",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const { title, code, departmentId, level, isActive } = req.body;
      const [desig] = await db
        .update(designationsTable)
        .set({ title, code, departmentId, level, isActive, updatedAt: new Date() })
        .where(and(eq(designationsTable.id, id), isNull(designationsTable.deletedAt)))
        .returning();
      if (!desig) {
        res.status(404).json({ error: "Designation not found" });
        return;
      }
      await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Designations", recordId: id, ipAddress: req.ip });
      res.json(desig);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        res.status(409).json({ error: "Designation code already exists" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.delete(
  "/designations/:id",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const [desig] = await db
        .update(designationsTable)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(designationsTable.id, id), isNull(designationsTable.deletedAt)))
        .returning();
      if (!desig) {
        res.status(404).json({ error: "Designation not found" });
        return;
      }
      await logAudit({ user: req.hrmsUser, action: "DELETE", module: "Designations", recordId: id, ipAddress: req.ip });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
