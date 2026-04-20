import { Router } from "express";
import { requireAuth, getCurrentHrmsUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router = Router();

router.get("/users", requireAuth, async (req, res) => {
  try {
    const users = await db.select().from(hrmsUsersTable).orderBy(hrmsUsersTable.name);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", requireAuth, async (req, res) => {
  try {
    const { clerkUserId, employeeId, email, name, role } = req.body;
    if (!clerkUserId || !email || !name) {
      res.status(400).json({ error: "clerkUserId, email, and name are required" });
      return;
    }
    const [user] = await db
      .insert(hrmsUsersTable)
      .values({ clerkUserId, employeeId, email, name, role })
      .returning();
    const actor = await getCurrentHrmsUser(req);
    await logAudit({ user: actor, action: "CREATE", module: "Users", recordId: user.id, ipAddress: req.ip });
    res.status(201).json(user);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "User already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/me", requireAuth, async (req, res) => {
  try {
    const user = await getCurrentHrmsUser(req);
    if (!user) {
      res.status(404).json({ error: "HRMS user not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [user] = await db
      .select()
      .from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.id, id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { employeeId, email, name, role, isActive } = req.body;
    const [user] = await db
      .update(hrmsUsersTable)
      .set({ employeeId, email, name, role, isActive, updatedAt: new Date() })
      .where(eq(hrmsUsersTable.id, id))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const actor = await getCurrentHrmsUser(req);
    await logAudit({ user: actor, action: "UPDATE", module: "Users", recordId: id, ipAddress: req.ip });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
