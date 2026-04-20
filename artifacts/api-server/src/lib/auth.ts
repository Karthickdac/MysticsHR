import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "./db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export async function getCurrentHrmsUser(req: Request) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select()
    .from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.clerkUserId, userId))
    .limit(1);
  return user ?? null;
}

export async function requireHrmsUser(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(403).json({ error: "HRMS account not provisioned. Contact your HR administrator." });
    return;
  }
  (req as any).hrmsUser = user;
  next();
}
