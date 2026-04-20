import { Router } from "express";
import { requireAuth, getCurrentHrmsUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { departmentsTable } from "@workspace/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

const router = Router();

router.get("/departments", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(departmentsTable)
      .where(isNull(departmentsTable.deletedAt))
      .orderBy(departmentsTable.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/departments", requireAuth, async (req, res) => {
  try {
    const { name, code, description, headId } = req.body;
    if (!name || !code) {
      res.status(400).json({ error: "name and code are required" });
      return;
    }
    const [dept] = await db
      .insert(departmentsTable)
      .values({ name, code, description, headId })
      .returning();
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "CREATE", module: "Departments", recordId: dept.id, ipAddress: req.ip });
    res.status(201).json(dept);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Department code already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/departments/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [dept] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, id))
      .limit(1);
    if (!dept || dept.deletedAt) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json(dept);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/departments/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, code, description, headId, isActive } = req.body;
    const [dept] = await db
      .update(departmentsTable)
      .set({ name, code, description, headId, isActive, updatedAt: new Date() })
      .where(eq(departmentsTable.id, id))
      .returning();
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "UPDATE", module: "Departments", recordId: id, ipAddress: req.ip });
    res.json(dept);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Department code already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/departments/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [dept] = await db
      .update(departmentsTable)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(departmentsTable.id, id))
      .returning();
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "DELETE", module: "Departments", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
