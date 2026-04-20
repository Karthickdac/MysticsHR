import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { departmentsTable, employeesTable } from "@workspace/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

const router = Router();

const deptSelect = {
  id: departmentsTable.id,
  name: departmentsTable.name,
  code: departmentsTable.code,
  description: departmentsTable.description,
  headId: departmentsTable.headId,
  isActive: departmentsTable.isActive,
  employeeCount: sql<number>`count(${employeesTable.id})::int`,
  createdAt: departmentsTable.createdAt,
  updatedAt: departmentsTable.updatedAt,
};

const deptGroupBy = [
  departmentsTable.id,
  departmentsTable.name,
  departmentsTable.code,
  departmentsTable.description,
  departmentsTable.headId,
  departmentsTable.isActive,
  departmentsTable.createdAt,
  departmentsTable.updatedAt,
] as const;

const activeEmployeesJoin = sql`${employeesTable.departmentId} = ${departmentsTable.id} AND ${employeesTable.deletedAt} IS NULL AND ${employeesTable.status} != 'Separated'`;

router.get("/departments", requireHrmsUser, async (req, res) => {
  try {
    const rows = await db
      .select(deptSelect)
      .from(departmentsTable)
      .leftJoin(employeesTable, activeEmployeesJoin)
      .where(isNull(departmentsTable.deletedAt))
      .groupBy(...deptGroupBy)
      .orderBy(departmentsTable.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/departments",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
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
      await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Departments", recordId: dept.id, ipAddress: req.ip });
      res.status(201).json({ ...dept, employeeCount: 0 });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        res.status(409).json({ error: "Department code already exists" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/departments/:id", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [dept] = await db
      .select(deptSelect)
      .from(departmentsTable)
      .leftJoin(employeesTable, activeEmployeesJoin)
      .where(and(eq(departmentsTable.id, id), isNull(departmentsTable.deletedAt)))
      .groupBy(...deptGroupBy)
      .limit(1);
    if (!dept) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json(dept);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/departments/:id",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const { name, code, description, headId, isActive } = req.body;
      const [dept] = await db
        .update(departmentsTable)
        .set({ name, code, description, headId, isActive, updatedAt: new Date() })
        .where(and(eq(departmentsTable.id, id), isNull(departmentsTable.deletedAt)))
        .returning();
      if (!dept) {
        res.status(404).json({ error: "Department not found" });
        return;
      }
      await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Departments", recordId: id, ipAddress: req.ip });
      res.json({ ...dept, employeeCount: 0 });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        res.status(409).json({ error: "Department code already exists" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.delete(
  "/departments/:id",
  requireHrmsUser,
  requireRole("super_admin", "hr_manager"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const [dept] = await db
        .update(departmentsTable)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(departmentsTable.id, id), isNull(departmentsTable.deletedAt)))
        .returning();
      if (!dept) {
        res.status(404).json({ error: "Department not found" });
        return;
      }
      await logAudit({ user: req.hrmsUser, action: "DELETE", module: "Departments", recordId: id, ipAddress: req.ip });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
