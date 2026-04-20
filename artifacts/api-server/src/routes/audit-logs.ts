import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import { auditLogsTable } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";

const router = Router();

router.get(
  "/audit-logs",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const { module, userId, limit = "50", offset = "0" } = req.query as Record<string, string>;

      const conditions = [];
      if (module) conditions.push(eq(auditLogsTable.module, module));
      if (userId) conditions.push(eq(auditLogsTable.userId, parseInt(userId, 10)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(whereClause);

      const logs = await db
        .select()
        .from(auditLogsTable)
        .where(whereClause)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(parseInt(limit, 10))
        .offset(parseInt(offset, 10));

      res.json({
        data: logs,
        total: countRow?.count ?? 0,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
