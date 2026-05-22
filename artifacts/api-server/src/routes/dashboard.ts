import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";

const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
import { db } from "../lib/db";
import {
  employeesTable,
  departmentsTable,
  auditLogsTable,
  employeeCertificationsTable,
} from "@workspace/db/schema";
import { eq, and, sql, desc, asc, isNull, isNotNull, lte } from "drizzle-orm";

const router = Router();

router.get("/dashboard/kpis", requireHrmsUser, async (req, res) => {
  try {
    const notDeleted = isNull(employeesTable.deletedAt);

    const [headcountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(notDeleted);

    const [activeRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(notDeleted, eq(employeesTable.status, "Active")));

    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const [newJoinersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(
        and(
          notDeleted,
          sql`${employeesTable.dateOfJoining} >= ${firstOfMonth.toISOString().split("T")[0]}`
        )
      );

    const [separatedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(notDeleted, eq(employeesTable.status, "Separated")));

    const [onLeaveRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(notDeleted, eq(employeesTable.status, "On Leave of Absence")));

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
      .where(and(eq(departmentsTable.isActive, true), isNull(departmentsTable.deletedAt)))
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

router.get("/dashboard/expiring-certifications", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const daysParam = parseInt(String(req.query.days ?? "60"), 10);
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 60;

    const rows = await db
      .select({
        id: employeeCertificationsTable.id,
        name: employeeCertificationsTable.name,
        issuingOrganization: employeeCertificationsTable.issuingOrganization,
        expiryDate: employeeCertificationsTable.expiryDate,
        employeeId: employeesTable.id,
        employeeCode: employeesTable.employeeId,
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        departmentName: departmentsTable.name,
      })
      .from(employeeCertificationsTable)
      .innerJoin(employeesTable, eq(employeeCertificationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(
        and(
          isNotNull(employeeCertificationsTable.expiryDate),
          isNull(employeesTable.deletedAt),
          lte(
            employeeCertificationsTable.expiryDate,
            sql`(CURRENT_DATE + (${days} || ' days')::interval)::date`
          )
        )
      )
      .orderBy(asc(employeeCertificationsTable.expiryDate));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = rows.map((r) => {
      const expiry = r.expiryDate ? new Date(r.expiryDate) : null;
      const daysUntilExpiry = expiry
        ? Math.floor((expiry.getTime() - today.getTime()) / 86400000)
        : 0;
      const bucket: "expired" | "7" | "30" | "60" =
        daysUntilExpiry < 0 ? "expired" : daysUntilExpiry <= 7 ? "7" : daysUntilExpiry <= 30 ? "30" : "60";
      return {
        id: r.id,
        name: r.name,
        issuingOrganization: r.issuingOrganization,
        expiryDate: r.expiryDate ?? "",
        daysUntilExpiry,
        bucket,
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        employeeName: `${r.firstName} ${r.lastName}`.trim(),
        departmentName: r.departmentName ?? null,
      };
    });

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
