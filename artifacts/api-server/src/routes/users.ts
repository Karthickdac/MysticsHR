import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get(
  "/users",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const users = await db.select().from(hrmsUsersTable).orderBy(hrmsUsersTable.name);
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/users",
  requireHrmsUser,
  requireRole("super_admin"),
  async (req, res) => {
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
      await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Users", recordId: user.id, ipAddress: req.ip });
      res.status(201).json(user);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        res.status(409).json({ error: "User already exists" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/users/me", requireHrmsUser, async (req, res) => {
  res.json(req.hrmsUser);
});

router.get(
  "/users/:id",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
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
  }
);

router.patch(
  "/users/:id",
  requireHrmsUser,
  requireRole("super_admin"),
  async (req, res) => {
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
      await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Users", recordId: id, ipAddress: req.ip });
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
