import { Router } from "express";
import { requireHrmsUser } from "../lib/auth";
import { db } from "../lib/db";
import {
  employeesTable,
  departmentsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { eq, sql, desc, gte, isNull } from "drizzle-orm";

const router = Router();

router.get("/dashboard/kpis", requireHrmsUser, async (req, res) => {
  try {
    const [headcountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(isNull(employeesTable.deletedAt));

    const [activeRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "Active"));

    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const [newJoinersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(
        sql`${employeesTable.dateOfJoining} >= ${firstOfMonth.toISOString().split("T")[0]} AND ${employeesTable.deletedAt} IS NULL`
      );

    const [separatedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "Separated"));

    const [onLeaveRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "On Leave of Absence"));

    const totalHeadcount = headcountRow?.count ?? 0;
    const activeEmployees = activeRow?.count ?? 0;
    const newJoinersThisMonth = newJoinersRow?.count ?? 0;
    const separated = separatedRow?.count ?? 0;
    const onLeaveToday = onLeaveRow?.count ?? 0;

    const attritionRate =
      totalHeadcount > 0
        ? parseFloat(((separated / totalHeadcount) * 100).toFixed(2))
        : 0;

    res.json({
      totalHeadcount,
      newJoinersThisMonth,
      attritionRate,
      attendanceRateToday: totalHeadcount > 0 ? parseFloat(((activeEmployees / totalHeadcount) * 100).toFixed(2)) : 0,
      openPositions: 0,
      pendingApprovals: 0,
      activeEmployees,
      onLeaveToday,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/recent-activity", requireHrmsUser, async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "10"), 10);
    const logs = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    res.json(
      logs.map((l) => ({
        id: l.id,
        type: l.action,
        description: `${l.action} on ${l.module}${l.recordId ? ` #${l.recordId}` : ""}`,
        module: l.module,
        actorName: l.userEmail ?? "System",
        createdAt: l.createdAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/headcount-by-department", requireHrmsUser, async (req, res) => {
  try {
    const rows = await db
      .select({
        departmentId: departmentsTable.id,
        departmentName: departmentsTable.name,
        count: sql<number>`count(${employeesTable.id})::int`,
      })
      .from(departmentsTable)
      .leftJoin(
        employeesTable,
        sql`${employeesTable.departmentId} = ${departmentsTable.id} AND ${employeesTable.deletedAt} IS NULL AND ${employeesTable.status} != 'Separated'`
      )
      .where(eq(departmentsTable.isActive, true))
      .groupBy(departmentsTable.id, departmentsTable.name)
      .orderBy(desc(sql`count(${employeesTable.id})`));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/employee-status-breakdown", requireHrmsUser, async (req, res) => {
  try {
    const rows = await db
      .select({
        status: employeesTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(employeesTable)
      .where(isNull(employeesTable.deletedAt))
      .groupBy(employeesTable.status)
      .orderBy(desc(sql`count(*)`));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
