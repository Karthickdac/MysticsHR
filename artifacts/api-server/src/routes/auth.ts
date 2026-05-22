import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { db } from "../lib/db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.post("/auth/provision", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser.emailAddresses[0]?.emailAddress;

    if (!email) {
      res.status(400).json({ error: "Clerk account has no verified email address" });
      return;
    }

    const [hrmsUser] = await db
      .select()
      .from(hrmsUsersTable)
      .where(eq(hrmsUsersTable.email, email))
      .limit(1);

    if (!hrmsUser) {
      // Bootstrap: if there are no HRMS users at all, the first signed-in
      // user becomes the initial super_admin so the app is usable.
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(hrmsUsersTable);

      if (Number(count) === 0) {
        const displayName =
          [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
          email.split("@")[0];
        const [created] = await db
          .insert(hrmsUsersTable)
          .values({
            email,
            name: displayName,
            role: "super_admin",
            clerkUserId: userId,
            isActive: true,
          })
          .returning();
        res.json({ user: created, linked: true, bootstrapped: true });
        return;
      }

      res.status(404).json({
        error: "No HRMS account found for your email address. Contact your HR administrator.",
      });
      return;
    }

    if (!hrmsUser.isActive) {
      res.status(403).json({ error: "Your HRMS account is deactivated. Contact your HR administrator." });
      return;
    }

    if (hrmsUser.clerkUserId !== userId) {
      const [updated] = await db
        .update(hrmsUsersTable)
        .set({ clerkUserId: userId, updatedAt: new Date() })
        .where(eq(hrmsUsersTable.id, hrmsUser.id))
        .returning();
      res.json({ user: updated, linked: true });
      return;
    }

    res.json({ user: hrmsUser, linked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
