import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "./db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

type HrmsUser = InferSelectModel<typeof hrmsUsersTable>;
type HrmsRole = HrmsUser["role"];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export async function getCurrentHrmsUser(req: Request): Promise<HrmsUser | null> {
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
  if (!user.isActive) {
    res.status(403).json({ error: "HRMS account is deactivated. Contact your HR administrator." });
    return;
  }
  req.hrmsUser = user;
  next();
}

export function requireRole(...allowedRoles: HrmsRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.hrmsUser?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
    next();
  };
}
