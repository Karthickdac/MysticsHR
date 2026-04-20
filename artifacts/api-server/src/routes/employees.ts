import { Router } from "express";
import { requireAuth, getCurrentHrmsUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { employeesTable, departmentsTable, designationsTable } from "@workspace/db/schema";
import { eq, isNull, ilike, and, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/employees", requireAuth, async (req, res) => {
  try {
    const { status, departmentId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [isNull(employeesTable.deletedAt)];

    if (status) conditions.push(eq(employeesTable.status, status as any));
    if (departmentId) conditions.push(eq(employeesTable.departmentId, parseInt(departmentId, 10)));
    if (search) {
      conditions.push(
        sql`(${employeesTable.firstName} ilike ${`%${search}%`} OR ${employeesTable.lastName} ilike ${`%${search}%`} OR ${employeesTable.email} ilike ${`%${search}%`} OR ${employeesTable.employeeId} ilike ${`%${search}%`})`
      );
    }

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(whereClause);

    const employees = await db
      .select({
        id: employeesTable.id,
        employeeId: employeesTable.employeeId,
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        email: employeesTable.email,
        phone: employeesTable.phone,
        dateOfBirth: employeesTable.dateOfBirth,
        gender: employeesTable.gender,
        departmentId: employeesTable.departmentId,
        departmentName: departmentsTable.name,
        designationId: employeesTable.designationId,
        designationTitle: designationsTable.title,
        employmentType: employeesTable.employmentType,
        status: employeesTable.status,
        dateOfJoining: employeesTable.dateOfJoining,
        ctc: employeesTable.ctc,
        managerId: employeesTable.managerId,
        location: employeesTable.location,
        avatarUrl: employeesTable.avatarUrl,
        isActive: employeesTable.isActive,
        createdAt: employeesTable.createdAt,
        updatedAt: employeesTable.updatedAt,
      })
      .from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .where(whereClause)
      .orderBy(desc(employeesTable.createdAt))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    res.json({
      data: employees,
      total: countRow?.count ?? 0,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees", requireAuth, async (req, res) => {
  try {
    const {
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      gender,
      departmentId,
      designationId,
      employmentType,
      status,
      dateOfJoining,
      ctc,
      managerId,
      location,
      avatarUrl,
    } = req.body;

    if (!employeeId || !firstName || !lastName || !email) {
      res.status(400).json({ error: "employeeId, firstName, lastName, and email are required" });
      return;
    }

    const [emp] = await db
      .insert(employeesTable)
      .values({
        employeeId,
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth,
        gender,
        departmentId,
        designationId,
        employmentType,
        status,
        dateOfJoining,
        ctc,
        managerId,
        location,
        avatarUrl,
      })
      .returning();

    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "CREATE", module: "Employees", recordId: emp.id, ipAddress: req.ip });
    res.status(201).json(emp);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Employee ID or email already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [emp] = await db
      .select({
        id: employeesTable.id,
        employeeId: employeesTable.employeeId,
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        email: employeesTable.email,
        phone: employeesTable.phone,
        dateOfBirth: employeesTable.dateOfBirth,
        gender: employeesTable.gender,
        departmentId: employeesTable.departmentId,
        departmentName: departmentsTable.name,
        designationId: employeesTable.designationId,
        designationTitle: designationsTable.title,
        employmentType: employeesTable.employmentType,
        status: employeesTable.status,
        dateOfJoining: employeesTable.dateOfJoining,
        ctc: employeesTable.ctc,
        managerId: employeesTable.managerId,
        location: employeesTable.location,
        avatarUrl: employeesTable.avatarUrl,
        isActive: employeesTable.isActive,
        createdAt: employeesTable.createdAt,
        updatedAt: employeesTable.updatedAt,
      })
      .from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .where(and(eq(employeesTable.id, id), isNull(employeesTable.deletedAt)))
      .limit(1);

    if (!emp) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json(emp);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/employees/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const {
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      gender,
      departmentId,
      designationId,
      employmentType,
      status,
      dateOfJoining,
      ctc,
      managerId,
      location,
      avatarUrl,
      isActive,
    } = req.body;

    const [emp] = await db
      .update(employeesTable)
      .set({
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth,
        gender,
        departmentId,
        designationId,
        employmentType,
        status,
        dateOfJoining,
        ctc,
        managerId,
        location,
        avatarUrl,
        isActive,
        updatedAt: new Date(),
      })
      .where(and(eq(employeesTable.id, id), isNull(employeesTable.deletedAt)))
      .returning();

    if (!emp) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "UPDATE", module: "Employees", recordId: id, ipAddress: req.ip });
    res.json(emp);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Email already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employees/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [emp] = await db
      .update(employeesTable)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(employeesTable.id, id), isNull(employeesTable.deletedAt)))
      .returning();
    if (!emp) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "DELETE", module: "Employees", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employees/:id/status", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: "status is required" });
      return;
    }
    const [emp] = await db
      .update(employeesTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(employeesTable.id, id), isNull(employeesTable.deletedAt)))
      .returning();
    if (!emp) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const user = await getCurrentHrmsUser(req);
    await logAudit({ user, action: "STATUS_CHANGE", module: "Employees", recordId: id, newValue: status, ipAddress: req.ip });
    res.json(emp);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
