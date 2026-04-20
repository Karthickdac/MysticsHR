import { Router } from "express";
import { requireAuth, getCurrentHrmsUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { designationsTable } from "@workspace/db/schema";
import { eq, isNull } from "drizzle-orm";

const router = Router();

router.get("/designations", requireAuth, async (req, res) => {
  try {
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId), 10) : undefined;
    const query = db
      .select()
      .from(designationsTable)
      .where(isNull(designationsTable.deletedAt))
      .orderBy(designationsTable.title);

    const rows = departmentId
      ? await db.select().from(designationsTable).where(eq(designationsTable.departmentId, departmentId)).orderBy(designationsTable.title)
      : await query;

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/designations", requireAuth, async (req, res) => {
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
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "CREATE", module: "Designations", recordId: desig.id, ipAddress: req.ip });
    res.status(201).json(desig);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Designation code already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/designations/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [desig] = await db
      .select()
      .from(designationsTable)
      .where(eq(designationsTable.id, id))
      .limit(1);
    if (!desig || desig.deletedAt) {
      res.status(404).json({ error: "Designation not found" });
      return;
    }
    res.json(desig);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/designations/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { title, code, departmentId, level, isActive } = req.body;
    const [desig] = await db
      .update(designationsTable)
      .set({ title, code, departmentId, level, isActive, updatedAt: new Date() })
      .where(eq(designationsTable.id, id))
      .returning();
    if (!desig) {
      res.status(404).json({ error: "Designation not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "UPDATE", module: "Designations", recordId: id, ipAddress: req.ip });
    res.json(desig);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Designation code already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/designations/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [desig] = await db
      .update(designationsTable)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(designationsTable.id, id))
      .returning();
    if (!desig) {
      res.status(404).json({ error: "Designation not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "DELETE", module: "Designations", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
