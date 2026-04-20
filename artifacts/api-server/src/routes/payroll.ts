import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { checkPayrollLock } from "../lib/payroll-lock";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  salaryStructuresTable, salaryComponentsTable, payrollRunsTable, payrollRecordsTable,
  payslipsTable, taxRegimeDeclarationsTable, salaryRevisionsTable, payrollLocksTable,
  payrollLockExceptionsTable, loanRepaymentsTable, employeesTable, hrmsUsersTable,
  departmentsTable, designationsTable, attendanceRecordsTable, payrollSettingsTable,
  salaryComponentTypeEnum, lockExceptionTypeEnum, salaryRevisionStatusEnum,
} from "@workspace/db/schema";
import { eq, and, desc, asc, or, gte, lte, sql } from "drizzle-orm";

const router = Router();

const PAYROLL_ADMIN_ROLES = ["super_admin", "payroll_admin"] as const;
const HR_ROLES = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// ─── TDS COMPUTATION ─────────────────────────────────────────────────────────
// FY 2024-25 slab rates

function computeTDS(annualGross: number, regime: "Old" | "New"): number {
  if (regime === "New") {
    const stdDeduction = 75000;
    const taxableIncome = Math.max(0, annualGross - stdDeduction);
    if (taxableIncome <= 700000) return 0; // Rebate u/s 87A
    let tax = 0;
    const slabs = [
      { upto: 300000, rate: 0 },
      { upto: 600000, rate: 0.05 },
      { upto: 900000, rate: 0.10 },
      { upto: 1200000, rate: 0.15 },
      { upto: 1500000, rate: 0.20 },
    ];
    let prev = 0;
    for (const slab of slabs) {
      if (taxableIncome > slab.upto) { tax += (slab.upto - prev) * slab.rate; prev = slab.upto; }
      else { tax += (taxableIncome - prev) * slab.rate; return Math.round(tax / 12); }
    }
    tax += (taxableIncome - 1500000) * 0.30;
    return Math.round(tax / 12);
  } else {
    const stdDeduction = 50000;
    const taxableIncome = Math.max(0, annualGross - stdDeduction);
    if (taxableIncome <= 500000) return 0; // Rebate u/s 87A
    let tax = 0;
    if (taxableIncome > 250000) tax += Math.min(taxableIncome - 250000, 250000) * 0.05;
    if (taxableIncome > 500000) tax += Math.min(taxableIncome - 500000, 500000) * 0.20;
    if (taxableIncome > 1000000) tax += (taxableIncome - 1000000) * 0.30;
    return Math.round(tax / 12);
  }
}

function computeProfessionalTax(monthlyGross: number, month: number): number {
  if (monthlyGross <= 7500) return 0;
  if (monthlyGross <= 10000) return 175;
  return month === 2 ? 300 : 200;
}

function computePF(basic: number): { pfEmployee: number; pfEmployer: number } {
  const cappedBasic = Math.min(basic, 15000);
  return { pfEmployee: Math.round(cappedBasic * 0.12), pfEmployer: Math.round(cappedBasic * 0.12) };
}

function computeESI(grossMonthly: number): { esiEmployee: number; esiEmployer: number } {
  if (grossMonthly > 21000) return { esiEmployee: 0, esiEmployer: 0 };
  return {
    esiEmployee: Math.round(grossMonthly * 0.0075),
    esiEmployer: Math.round(grossMonthly * 0.0325),
  };
}

// ─── SALARY STRUCTURES ────────────────────────────────────────────────────────

router.get("/payroll/salary-structures", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { employeeId, isActive } = req.query as { employeeId?: string; isActive?: string };
    const conds = [];
    if (employeeId) conds.push(eq(salaryStructuresTable.employeeId, Number(employeeId)));
    if (isActive !== undefined) conds.push(eq(salaryStructuresTable.isActive, isActive === "true"));
    const structures = await db
      .select({
        id: salaryStructuresTable.id,
        employeeId: salaryStructuresTable.employeeId,
        name: salaryStructuresTable.name,
        effectiveFrom: salaryStructuresTable.effectiveFrom,
        effectiveTo: salaryStructuresTable.effectiveTo,
        grossCtc: salaryStructuresTable.grossCtc,
        annualCtc: salaryStructuresTable.annualCtc,
        isActive: salaryStructuresTable.isActive,
        notes: salaryStructuresTable.notes,
        createdAt: salaryStructuresTable.createdAt,
        employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
        employeeCode: employeesTable.employeeId,
      })
      .from(salaryStructuresTable)
      .leftJoin(employeesTable, eq(salaryStructuresTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(salaryStructuresTable.createdAt));
    res.json(structures);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/salary-structures/:id", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [structure] = await db.select().from(salaryStructuresTable).where(eq(salaryStructuresTable.id, id));
    if (!structure) { res.status(404).json({ error: "Not found" }); return; }
    const components = await db.select().from(salaryComponentsTable)
      .where(and(eq(salaryComponentsTable.salaryStructureId, id), eq(salaryComponentsTable.isActive, true)))
      .orderBy(asc(salaryComponentsTable.sequence));
    res.json({ ...structure, components });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});


router.post("/payroll/salary-structures", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as {
      employeeId: number; name: string; effectiveFrom: string; grossCtc: string; annualCtc: string;
      notes?: string; components: Array<{
        componentType: string; componentName: string; amount: string;
        percentageOfBasic?: string; isEarning: boolean; sequence?: number;
      }>;
    };

    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_salary");
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const [structure] = await db.insert(salaryStructuresTable).values({
      employeeId: body.employeeId,
      name: body.name,
      effectiveFrom: body.effectiveFrom,
      grossCtc: body.grossCtc,
      annualCtc: body.annualCtc,
      notes: body.notes,
      createdById: req.hrmsUser!.id,
    }).returning();

    if (body.components?.length) {
      await db.insert(salaryComponentsTable).values(
        body.components.map((c, i) => ({
          salaryStructureId: structure.id,
          componentType: c.componentType as (typeof salaryComponentTypeEnum.enumValues)[number],
          componentName: c.componentName,
          amount: c.amount,
          percentageOfBasic: c.percentageOfBasic,
          isEarning: c.isEarning,
          sequence: c.sequence ?? i,
        }))
      );
    }

    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Payroll", recordId: structure.id, newValue: `Salary structure for employee ${body.employeeId}`, ipAddress: req.ip });
    res.status(201).json(structure);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/payroll/salary-structures/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as {
      name?: string; effectiveFrom?: string; effectiveTo?: string;
      grossCtc?: string; annualCtc?: string; isActive?: boolean; notes?: string;
      components?: Array<{
        id?: number; componentType: string; componentName: string; amount: string;
        percentageOfBasic?: string; isEarning: boolean; sequence?: number; isActive?: boolean;
      }>;
    };

    const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_salary");
    if (lockError) { res.status(422).json({ error: lockError }); return; }

    const [updated] = await db.update(salaryStructuresTable).set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.effectiveFrom !== undefined && { effectiveFrom: body.effectiveFrom }),
      ...(body.effectiveTo !== undefined && { effectiveTo: body.effectiveTo }),
      ...(body.grossCtc !== undefined && { grossCtc: body.grossCtc }),
      ...(body.annualCtc !== undefined && { annualCtc: body.annualCtc }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.notes !== undefined && { notes: body.notes }),
      updatedAt: new Date(),
    }).where(eq(salaryStructuresTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    if (body.components) {
      await db.delete(salaryComponentsTable).where(eq(salaryComponentsTable.salaryStructureId, id));
      if (body.components.length) {
        await db.insert(salaryComponentsTable).values(
          body.components.map((c, i) => ({
            salaryStructureId: id,
            componentType: c.componentType as (typeof salaryComponentTypeEnum.enumValues)[number],
            componentName: c.componentName,
            amount: c.amount,
            percentageOfBasic: c.percentageOfBasic,
            isEarning: c.isEarning,
            sequence: c.sequence ?? i,
            isActive: c.isActive !== false,
          }))
        );
      }
    }

    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Payroll", recordId: id, newValue: JSON.stringify(body), ipAddress: req.ip });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LOAN REPAYMENTS ─────────────────────────────────────────────────────────

router.get("/payroll/loans", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { employeeId, isActive } = req.query as { employeeId?: string; isActive?: string };
    const conds = [];
    if (employeeId) conds.push(eq(loanRepaymentsTable.employeeId, Number(employeeId)));
    if (isActive !== undefined) conds.push(eq(loanRepaymentsTable.isActive, isActive === "true"));
    const loans = await db.select({
      id: loanRepaymentsTable.id,
      employeeId: loanRepaymentsTable.employeeId,
      loanType: loanRepaymentsTable.loanType,
      principalAmount: loanRepaymentsTable.principalAmount,
      monthlyDeduction: loanRepaymentsTable.monthlyDeduction,
      outstandingAmount: loanRepaymentsTable.outstandingAmount,
      isActive: loanRepaymentsTable.isActive,
      startDate: loanRepaymentsTable.startDate,
      endDate: loanRepaymentsTable.endDate,
      notes: loanRepaymentsTable.notes,
      createdAt: loanRepaymentsTable.createdAt,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
    }).from(loanRepaymentsTable)
      .leftJoin(employeesTable, eq(loanRepaymentsTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(loanRepaymentsTable.createdAt));
    res.json(loans);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/loans", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as {
      employeeId: number; loanType: string; principalAmount: string;
      monthlyDeduction: string; startDate: string; endDate?: string; notes?: string;
    };
    const [loan] = await db.insert(loanRepaymentsTable).values({
      ...body,
      outstandingAmount: body.principalAmount,
      createdById: req.hrmsUser!.id,
    }).returning();
    res.status(201).json(loan);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/payroll/loans/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as { outstandingAmount?: string; monthlyDeduction?: string; isActive?: boolean; notes?: string };
    const [updated] = await db.update(loanRepaymentsTable).set({
      ...(body.outstandingAmount !== undefined && { outstandingAmount: body.outstandingAmount }),
      ...(body.monthlyDeduction !== undefined && { monthlyDeduction: body.monthlyDeduction }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.notes !== undefined && { notes: body.notes }),
      updatedAt: new Date(),
    }).where(eq(loanRepaymentsTable.id, Number(req.params.id))).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── TAX REGIME DECLARATIONS ──────────────────────────────────────────────────

router.get("/payroll/tax-declarations", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { employeeId, financialYear } = req.query as { employeeId?: string; financialYear?: string };
    const conds = [];

    // Employees and HODs can only see their own tax declarations
    if (u.role === "employee" || u.role === "hod") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!emp) { res.status(403).json({ error: "No employee record found for current user." }); return; }
      conds.push(eq(taxRegimeDeclarationsTable.employeeId, emp.id));
    } else if (employeeId) {
      conds.push(eq(taxRegimeDeclarationsTable.employeeId, Number(employeeId)));
    }
    if (financialYear) conds.push(eq(taxRegimeDeclarationsTable.financialYear, financialYear));

    const declarations = await db.select({
      id: taxRegimeDeclarationsTable.id,
      employeeId: taxRegimeDeclarationsTable.employeeId,
      financialYear: taxRegimeDeclarationsTable.financialYear,
      regime: taxRegimeDeclarationsTable.regime,
      investmentDeclarations: taxRegimeDeclarationsTable.investmentDeclarations,
      declarationDate: taxRegimeDeclarationsTable.declarationDate,
      isCurrent: taxRegimeDeclarationsTable.isCurrent,
      createdAt: taxRegimeDeclarationsTable.createdAt,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
    }).from(taxRegimeDeclarationsTable)
      .leftJoin(employeesTable, eq(taxRegimeDeclarationsTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(taxRegimeDeclarationsTable.createdAt));
    res.json(declarations);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/tax-declarations", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const body = req.body as {
      employeeId?: number; financialYear: string; regime: "Old" | "New";
      investmentDeclarations?: Record<string, number>; declarationDate: string;
    };

    let resolvedEmployeeId: number;

    const selfOnlyRoles = ["employee", "hod"] as const;
    if ((selfOnlyRoles as readonly string[]).includes(u.role)) {
      // Employee and HOD can only declare for themselves — derive from auth, ignore body value
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!emp) { res.status(403).json({ error: "No employee record found for current user." }); return; }
      resolvedEmployeeId = emp.id;

      // Employees and HODs are subject to declaration window enforcement.
      // HR/Super Admin/Payroll Admin can always submit declarations.
      const [windowStart] = await db.select({ settingValue: payrollSettingsTable.settingValue })
        .from(payrollSettingsTable)
        .where(eq(payrollSettingsTable.settingKey, `declaration_window_start_${body.financialYear}`));
      const [windowEnd] = await db.select({ settingValue: payrollSettingsTable.settingValue })
        .from(payrollSettingsTable)
        .where(eq(payrollSettingsTable.settingKey, `declaration_window_end_${body.financialYear}`));
      if (windowStart && windowEnd) {
        const today = new Date().toISOString().split("T")[0];
        if (today < windowStart.settingValue || today > windowEnd.settingValue) {
          res.status(422).json({
            error: `Tax declarations are only accepted between ${windowStart.settingValue} and ${windowEnd.settingValue} for FY ${body.financialYear}.`,
          });
          return;
        }
      }
    } else {
      // HR/payroll_admin/super_admin roles must supply employeeId
      if (!body.employeeId) { res.status(400).json({ error: "employeeId is required." }); return; }
      resolvedEmployeeId = body.employeeId;
    }

    await db.update(taxRegimeDeclarationsTable).set({ isCurrent: false, updatedAt: new Date() })
      .where(and(
        eq(taxRegimeDeclarationsTable.employeeId, resolvedEmployeeId),
        eq(taxRegimeDeclarationsTable.financialYear, body.financialYear),
      ));
    const [decl] = await db.insert(taxRegimeDeclarationsTable).values({
      employeeId: resolvedEmployeeId,
      financialYear: body.financialYear,
      regime: body.regime,
      investmentDeclarations: body.investmentDeclarations,
      declarationDate: body.declarationDate,
      isCurrent: true,
    }).returning();
    res.status(201).json(decl);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYROLL SETTINGS ─────────────────────────────────────────────────────────
// Key-value config for the payroll module (e.g. declaration window per FY).
// Setting keys for tax declaration window:
//   declaration_window_start_<FY>  e.g. declaration_window_start_2024-25  → "2024-04-01"
//   declaration_window_end_<FY>    e.g. declaration_window_end_2024-25    → "2024-06-30"

router.get("/payroll/settings", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const settings = await db.select().from(payrollSettingsTable).orderBy(asc(payrollSettingsTable.settingKey));
    res.json(settings);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/payroll/settings/:key", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const key = req.params.key;
    const { value, description } = req.body as { value: string; description?: string };
    if (!value) { res.status(400).json({ error: "value is required." }); return; }
    const u = req.hrmsUser!;
    const existing = await db.select().from(payrollSettingsTable).where(eq(payrollSettingsTable.settingKey, key));
    if (existing.length) {
      const [updated] = await db.update(payrollSettingsTable)
        .set({ settingValue: value, description: description ?? existing[0].description, updatedById: u.id, updatedAt: new Date() })
        .where(eq(payrollSettingsTable.settingKey, key))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(payrollSettingsTable)
        .values({ settingKey: key, settingValue: value, description, updatedById: u.id })
        .returning();
      res.status(201).json(created);
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYROLL LOCKS ────────────────────────────────────────────────────────────

router.get("/payroll/locks", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year?: string; month?: string };
    const conds = [];
    if (year) conds.push(eq(payrollLocksTable.year, Number(year)));
    if (month) conds.push(eq(payrollLocksTable.month, Number(month)));
    const locks = await db.select().from(payrollLocksTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payrollLocksTable.year), desc(payrollLocksTable.month));
    res.json(locks);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/locks/:year/:month/lock", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const [existing] = await db.select().from(payrollLocksTable).where(and(eq(payrollLocksTable.year, year), eq(payrollLocksTable.month, month)));
    let lock;
    if (existing) {
      [lock] = await db.update(payrollLocksTable).set({ isLocked: true, lockedById: req.hrmsUser!.id, lockedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollLocksTable.id, existing.id)).returning();
    } else {
      [lock] = await db.insert(payrollLocksTable).values({ year, month, isLocked: true, lockedById: req.hrmsUser!.id, lockedAt: new Date() }).returning();
    }
    await logAudit({ user: req.hrmsUser, action: "PAYROLL_LOCK", module: "Payroll", recordId: lock.id, newValue: `${year}-${month}`, ipAddress: req.ip });
    res.json(lock);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/locks/:year/:month/unlock", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const [existing] = await db.select().from(payrollLocksTable).where(and(eq(payrollLocksTable.year, year), eq(payrollLocksTable.month, month)));
    if (!existing) { res.status(404).json({ error: "Lock record not found" }); return; }
    const [lock] = await db.update(payrollLocksTable).set({ isLocked: false, unlockedById: req.hrmsUser!.id, unlockedAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollLocksTable.id, existing.id)).returning();
    await logAudit({ user: req.hrmsUser, action: "PAYROLL_UNLOCK", module: "Payroll", recordId: lock.id, newValue: `${year}-${month}`, ipAddress: req.ip });
    res.json(lock);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Lock Exceptions
router.get("/payroll/lock-exceptions", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const exceptions = await db.select({
      id: payrollLockExceptionsTable.id,
      payrollLockId: payrollLockExceptionsTable.payrollLockId,
      requestedById: payrollLockExceptionsTable.requestedById,
      reason: payrollLockExceptionsTable.reason,
      exceptionType: payrollLockExceptionsTable.exceptionType,
      status: payrollLockExceptionsTable.status,
      approvedById: payrollLockExceptionsTable.approvedById,
      approvalRemarks: payrollLockExceptionsTable.approvalRemarks,
      approvedAt: payrollLockExceptionsTable.approvedAt,
      createdAt: payrollLockExceptionsTable.createdAt,
      requesterName: hrmsUsersTable.name,
      lockYear: payrollLocksTable.year,
      lockMonth: payrollLocksTable.month,
    }).from(payrollLockExceptionsTable)
      .leftJoin(hrmsUsersTable, eq(payrollLockExceptionsTable.requestedById, hrmsUsersTable.id))
      .leftJoin(payrollLocksTable, eq(payrollLockExceptionsTable.payrollLockId, payrollLocksTable.id))
      .orderBy(desc(payrollLockExceptionsTable.createdAt));
    res.json(exceptions);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/lock-exceptions", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as { payrollLockId: number; reason: string; exceptionType: string };
    const [exc] = await db.insert(payrollLockExceptionsTable).values({
      payrollLockId: body.payrollLockId,
      requestedById: req.hrmsUser!.id,
      reason: body.reason,
      exceptionType: body.exceptionType as (typeof lockExceptionTypeEnum.enumValues)[number],
    }).returning();
    res.status(201).json(exc);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/lock-exceptions/:id/action", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const { action, approvalRemarks } = req.body as { action: "approve" | "reject"; approvalRemarks?: string };
    const [exc] = await db.update(payrollLockExceptionsTable).set({
      status: action === "approve" ? "Approved" : "Rejected",
      approvedById: req.hrmsUser!.id,
      approvalRemarks,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(payrollLockExceptionsTable.id, Number(req.params.id))).returning();
    if (!exc) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ user: req.hrmsUser, action: `LOCK_EXCEPTION_${action.toUpperCase()}`, module: "Payroll", recordId: exc.id, newValue: action, ipAddress: req.ip });
    res.json(exc);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SALARY REVISIONS ─────────────────────────────────────────────────────────

router.get("/payroll/salary-revisions", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { employeeId, status } = req.query as { employeeId?: string; status?: string };
    const conds = [];
    if (employeeId) conds.push(eq(salaryRevisionsTable.employeeId, Number(employeeId)));
    if (status) conds.push(eq(salaryRevisionsTable.status, status as (typeof salaryRevisionStatusEnum.enumValues)[number]));
    const revisions = await db.select({
      id: salaryRevisionsTable.id,
      employeeId: salaryRevisionsTable.employeeId,
      oldStructureId: salaryRevisionsTable.oldStructureId,
      newStructureId: salaryRevisionsTable.newStructureId,
      effectiveDate: salaryRevisionsTable.effectiveDate,
      reason: salaryRevisionsTable.reason,
      status: salaryRevisionsTable.status,
      requestedById: salaryRevisionsTable.requestedById,
      approvedById: salaryRevisionsTable.approvedById,
      approvalRemarks: salaryRevisionsTable.approvalRemarks,
      approvedAt: salaryRevisionsTable.approvedAt,
      createdAt: salaryRevisionsTable.createdAt,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
    }).from(salaryRevisionsTable)
      .leftJoin(employeesTable, eq(salaryRevisionsTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(salaryRevisionsTable.createdAt));
    res.json(revisions);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/salary-revisions", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const body = req.body as {
      employeeId: number; oldStructureId?: number; newStructureId: number; effectiveDate: string; reason: string;
    };
    const [revision] = await db.insert(salaryRevisionsTable).values({
      ...body,
      requestedById: req.hrmsUser!.id,
      status: "Pending",
    }).returning();
    await logAudit({ user: req.hrmsUser, action: "SALARY_REVISION_REQUEST", module: "Payroll", recordId: revision.id, newValue: `Employee ${body.employeeId}`, ipAddress: req.ip });
    res.status(201).json(revision);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/salary-revisions/:id/action", requireHrmsUser, requireRole("super_admin"), async (req, res) => {
  try {
    const { action, approvalRemarks } = req.body as { action: "approve" | "reject"; approvalRemarks?: string };

    // Fetch the revision before mutation so we can read effectiveDate for lock check
    const [existing] = await db.select().from(salaryRevisionsTable).where(eq(salaryRevisionsTable.id, Number(req.params.id)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Salary revision approval mutates salary structures — enforce payroll lock for effective month
    if (action === "approve" && existing.effectiveDate) {
      const d = new Date(existing.effectiveDate as string);
      const lockErr = await checkPayrollLock(req.hrmsUser!.id, "edit_salary", d.getFullYear(), d.getMonth() + 1, req.hrmsUser!.email ?? undefined);
      if (lockErr) { res.status(423).json({ error: lockErr }); return; }
    }

    const [revision] = await db.update(salaryRevisionsTable).set({
      status: action === "approve" ? "Approved" : "Rejected",
      approvedById: req.hrmsUser!.id,
      approvalRemarks,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(salaryRevisionsTable.id, Number(req.params.id))).returning();
    if (!revision) { res.status(404).json({ error: "Not found" }); return; }

    if (action === "approve") {
      await db.update(salaryStructuresTable).set({ isActive: false, effectiveTo: revision.effectiveDate, updatedAt: new Date() })
        .where(and(eq(salaryStructuresTable.employeeId, revision.employeeId), eq(salaryStructuresTable.isActive, true)));
      if (revision.newStructureId) {
        await db.update(salaryStructuresTable).set({ isActive: true, effectiveFrom: revision.effectiveDate, updatedAt: new Date() })
          .where(eq(salaryStructuresTable.id, revision.newStructureId));
      }
    }

    await logAudit({ user: req.hrmsUser, action: `SALARY_REVISION_${action.toUpperCase()}`, module: "Payroll", recordId: revision.id, newValue: action, ipAddress: req.ip });
    res.json(revision);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYROLL RUNS ─────────────────────────────────────────────────────────────

router.get("/payroll/runs", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const runs = await db.select({
      id: payrollRunsTable.id,
      periodYear: payrollRunsTable.periodYear,
      periodMonth: payrollRunsTable.periodMonth,
      status: payrollRunsTable.status,
      totalEmployees: payrollRunsTable.totalEmployees,
      totalGross: payrollRunsTable.totalGross,
      totalDeductions: payrollRunsTable.totalDeductions,
      totalNet: payrollRunsTable.totalNet,
      notes: payrollRunsTable.notes,
      runAt: payrollRunsTable.runAt,
      approvedAt: payrollRunsTable.approvedAt,
      createdAt: payrollRunsTable.createdAt,
      initiatorName: sql<string>`u1.name`,
    }).from(payrollRunsTable)
      .leftJoin(sql`hrms_users u1`, sql`u1.id = ${payrollRunsTable.initiatedById}`)
      .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth));
    res.json(runs);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/runs", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const body = req.body as { periodYear: number; periodMonth: number; notes?: string };
    const [existing] = await db.select().from(payrollRunsTable).where(
      and(eq(payrollRunsTable.periodYear, body.periodYear), eq(payrollRunsTable.periodMonth, body.periodMonth))
    );
    if (existing) { res.status(422).json({ error: "A payroll run already exists for this period." }); return; }

    const [lock] = await db.insert(payrollLocksTable).values({
      year: body.periodYear, month: body.periodMonth, isLocked: true,
      lockedById: req.hrmsUser!.id, lockedAt: new Date(),
    }).onConflictDoNothing().returning();

    const [run] = await db.insert(payrollRunsTable).values({
      periodYear: body.periodYear,
      periodMonth: body.periodMonth,
      initiatedById: req.hrmsUser!.id,
      notes: body.notes,
      status: "Draft",
    }).returning();

    if (!lock) {
      await db.update(payrollLocksTable).set({ isLocked: true, lockedById: req.hrmsUser!.id, lockedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(payrollLocksTable.year, body.periodYear), eq(payrollLocksTable.month, body.periodMonth)));
    }

    await logAudit({ user: req.hrmsUser, action: "PAYROLL_RUN_INITIATE", module: "Payroll", recordId: run.id, newValue: `${body.periodYear}-${body.periodMonth}`, ipAddress: req.ip });
    res.status(201).json(run);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/runs/:id", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id));
    if (!run) { res.status(404).json({ error: "Not found" }); return; }
    res.json(run);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/runs/:id/compute", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const runId = Number(req.params.id);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, runId));
    if (!run) { res.status(404).json({ error: "Not found" }); return; }
    if (!["Draft", "Computed"].includes(run.status)) { res.status(422).json({ error: "Payroll run cannot be recomputed in current status." }); return; }

    await db.update(payrollRunsTable).set({ status: "Processing", updatedAt: new Date() }).where(eq(payrollRunsTable.id, runId));

    const year = run.periodYear;
    const month = run.periodMonth;
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const employees = await db.select({
      id: employeesTable.id,
      employeeCode: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      dateOfJoining: employeesTable.dateOfJoining,
    }).from(employeesTable).where(eq(employeesTable.isActive, true));

    let totalGross = 0, totalDeductions = 0, totalNet = 0;
    const records: Array<typeof payrollRecordsTable.$inferInsert> = [];

    await db.delete(payrollRecordsTable).where(eq(payrollRecordsTable.payrollRunId, runId));

    for (const emp of employees) {
      // Resolve salary structure: prefer an approved revision effective within the pay period
      // over the generic active structure, so mid-period revisions are honoured correctly.
      const approvedRevisions = await db
        .select({ newStructureId: salaryRevisionsTable.newStructureId, effectiveDate: salaryRevisionsTable.effectiveDate })
        .from(salaryRevisionsTable)
        .where(and(
          eq(salaryRevisionsTable.employeeId, emp.id),
          eq(salaryRevisionsTable.status, "Approved"),
          lte(salaryRevisionsTable.effectiveDate, periodEnd),
        ))
        .orderBy(desc(salaryRevisionsTable.effectiveDate));

      // Pick the most recent approved revision whose effective date is on/before the period end.
      // If the revision falls mid-period we still apply it for the whole period (standard practice
      // for monthly payroll; the revision record itself documents the effective date).
      let structureId: number | null = approvedRevisions[0]?.newStructureId ?? null;

      let structure;
      if (structureId) {
        [structure] = await db.select().from(salaryStructuresTable).where(eq(salaryStructuresTable.id, structureId));
      }
      if (!structure) {
        [structure] = await db.select().from(salaryStructuresTable).where(
          and(eq(salaryStructuresTable.employeeId, emp.id), eq(salaryStructuresTable.isActive, true))
        );
      }
      if (!structure) continue;

      const components = await db.select().from(salaryComponentsTable).where(
        and(eq(salaryComponentsTable.salaryStructureId, structure.id), eq(salaryComponentsTable.isActive, true))
      );

      const workingDays = lastDay;
      const attendanceRows = await db.select({
        status: attendanceRecordsTable.status,
        overtimeMinutes: attendanceRecordsTable.overtimeMinutes,
      }).from(attendanceRecordsTable).where(
        and(eq(attendanceRecordsTable.employeeId, emp.id), gte(attendanceRecordsTable.attendanceDate, periodStart), lte(attendanceRecordsTable.attendanceDate, periodEnd))
      );

      const presentStatuses = ["Present", "On Leave", "On Permission", "Work From Home", "Late", "Half-Day"];
      const presentDays = attendanceRows.filter(a => presentStatuses.includes(a.status ?? "")).length +
        attendanceRows.filter(a => a.status === "Half-Day").length * 0.5 -
        attendanceRows.filter(a => a.status === "Half-Day").length;

      const absences = attendanceRows.filter(a => a.status === "Absent").length;
      const lopDays = absences;
      const leaveDays = attendanceRows.filter(a => a.status === "On Leave").length;
      const totalOvertimeMins = attendanceRows.reduce((s, a) => s + (a.overtimeMinutes ?? 0), 0);
      const overtimeHours = totalOvertimeMins / 60;

      const factor = workingDays > 0 ? presentDays / workingDays : 0;

      let basic = 0, hra = 0, specialAllowance = 0, travelAllowance = 0, medicalAllowance = 0;
      let performanceBonus = 0, shiftAllowance = 0, nightDifferential = 0, otherEarnings = 0;

      for (const comp of components.filter(c => c.isEarning)) {
        const amt = Number(comp.amount) * factor;
        switch (comp.componentType) {
          case "Basic": basic = amt; break;
          case "HRA": hra = amt; break;
          case "Special Allowance": specialAllowance = amt; break;
          case "Travel Allowance": travelAllowance = amt; break;
          case "Medical Allowance": medicalAllowance = amt; break;
          case "Performance Bonus": performanceBonus = amt; break;
          case "Shift Allowance": shiftAllowance = amt; break;
          case "Night Differential Pay": nightDifferential = amt; break;
          default: otherEarnings += amt; break;
        }
      }

      // Monetise overtime: daily rate = (monthly basic / working days), overtime factor = 2×
      const dailyRate = workingDays > 0 ? Number(structure.grossCtc) / 12 / workingDays : 0;
      const hourlyRate = dailyRate / 8;
      const overtimePay = Math.round(overtimeHours * hourlyRate * 2);
      otherEarnings += overtimePay;

      const grossEarnings = basic + hra + specialAllowance + travelAllowance + medicalAllowance +
        performanceBonus + shiftAllowance + nightDifferential + otherEarnings;

      // LOP amount withheld = difference between full-factor and prorated earnings.
      // This is a display-only field on payslips — the reduction is already embedded in grossEarnings
      // (which is prorated by presentDays/workingDays). Do NOT add lopDeduction to totalDeductions
      // or it will double-count the absence impact.
      const fullGross = workingDays > 0
        ? components.filter(c => c.isEarning).reduce((s, c) => s + Number(c.amount), 0) + overtimePay
        : 0;
      const lopDeduction = Math.round((fullGross - grossEarnings) * 100) / 100;

      const { pfEmployee, pfEmployer } = computePF(basic);
      const { esiEmployee, esiEmployer } = computeESI(grossEarnings);
      const professionalTax = computeProfessionalTax(grossEarnings, month);

      const [taxDecl] = await db.select().from(taxRegimeDeclarationsTable).where(
        and(eq(taxRegimeDeclarationsTable.employeeId, emp.id), eq(taxRegimeDeclarationsTable.isCurrent, true))
      );
      const regime: "Old" | "New" = (taxDecl?.regime as "Old" | "New") ?? "New";
      // Annual CTC for TDS: use annualCtc from the resolved structure (handles revisions correctly)
      const annualGross = Number(structure.annualCtc);
      const tds = computeTDS(annualGross, regime);

      const [activeLoan] = await db.select().from(loanRepaymentsTable).where(
        and(eq(loanRepaymentsTable.employeeId, emp.id), eq(loanRepaymentsTable.isActive, true))
      );
      const loanDeduction = activeLoan ? Number(activeLoan.monthlyDeduction) : 0;

      // lopDeduction is display-only (already reflected in prorated grossEarnings); exclude from totalDeductions
      const totalDeductionsAmt = pfEmployee + esiEmployee + professionalTax + tds + loanDeduction;
      const netPay = Math.max(0, grossEarnings - totalDeductionsAmt);

      totalGross += grossEarnings;
      totalDeductions += totalDeductionsAmt;
      totalNet += netPay;

      const record = {
        payrollRunId: runId,
        employeeId: emp.id,
        salaryStructureId: structure.id,
        workingDays: String(workingDays),
        presentDays: String(presentDays),
        leaveDays: String(leaveDays),
        lopDays: String(lopDays),
        overtimeHours: String(overtimeHours.toFixed(2)),
        basic: String(basic.toFixed(2)),
        hra: String(hra.toFixed(2)),
        specialAllowance: String(specialAllowance.toFixed(2)),
        travelAllowance: String(travelAllowance.toFixed(2)),
        medicalAllowance: String(medicalAllowance.toFixed(2)),
        performanceBonus: String(performanceBonus.toFixed(2)),
        shiftAllowance: String(shiftAllowance.toFixed(2)),
        nightDifferential: String(nightDifferential.toFixed(2)),
        otherEarnings: String(otherEarnings.toFixed(2)),
        grossEarnings: String(grossEarnings.toFixed(2)),
        pfEmployee: String(pfEmployee.toFixed(2)),
        pfEmployer: String(pfEmployer.toFixed(2)),
        esiEmployee: String(esiEmployee.toFixed(2)),
        esiEmployer: String(esiEmployer.toFixed(2)),
        professionalTax: String(professionalTax.toFixed(2)),
        tds: String(tds.toFixed(2)),
        lopDeduction: String(lopDeduction.toFixed(2)),
        loanDeduction: String(loanDeduction.toFixed(2)),
        otherDeductions: "0",
        totalDeductions: String(totalDeductionsAmt.toFixed(2)),
        netPay: String(netPay.toFixed(2)),
        taxRegime: regime,
        status: "Pending" as const,
        componentBreakdown: {
          components: components.map(c => ({ name: c.componentName, type: c.componentType, amount: c.amount, isEarning: c.isEarning })),
          overtimePay,
          overtimeHours: parseFloat(overtimeHours.toFixed(2)),
        },
      };
      records.push(record);
    }

    if (records.length) await db.insert(payrollRecordsTable).values(records);

    await db.update(payrollRunsTable).set({
      status: "Computed",
      runAt: new Date(),
      totalEmployees: records.length,
      totalGross: String(totalGross.toFixed(2)),
      totalDeductions: String(totalDeductions.toFixed(2)),
      totalNet: String(totalNet.toFixed(2)),
      updatedAt: new Date(),
    }).where(eq(payrollRunsTable.id, runId));

    await logAudit({ user: req.hrmsUser, action: "PAYROLL_COMPUTE", module: "Payroll", recordId: runId, newValue: `${year}-${month}: ${records.length} records`, ipAddress: req.ip });
    res.json({ message: "Payroll computed", totalEmployees: records.length, totalGross, totalNet });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/runs/:id/approve", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const runId = Number(req.params.id);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, runId));
    if (!run) { res.status(404).json({ error: "Not found" }); return; }
    if (run.status !== "Computed") { res.status(422).json({ error: "Payroll must be in Computed status to approve." }); return; }

    await db.update(payrollRunsTable).set({ status: "Approved", approvedById: req.hrmsUser!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollRunsTable.id, runId));

    await db.update(payrollRecordsTable).set({ status: "Approved", updatedAt: new Date() }).where(eq(payrollRecordsTable.payrollRunId, runId));

    const records = await db.select().from(payrollRecordsTable).where(eq(payrollRecordsTable.payrollRunId, runId));
    for (const record of records) {
      const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, record.employeeId));
      const [dept] = emp?.departmentId ? await db.select({ name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, emp.departmentId)) : [null];
      const [desig] = await db.select({ name: designationsTable.title }).from(designationsTable).where(eq(designationsTable.id, emp?.designationId ?? 0));

      const payslipData = {
        employee: { name: `${emp?.firstName ?? ""} ${emp?.lastName ?? ""}`, code: emp?.employeeId, department: dept?.name ?? "", designation: desig?.name ?? "" },
        period: { year: run.periodYear, month: run.periodMonth },
        earnings: {
          basic: record.basic, hra: record.hra, specialAllowance: record.specialAllowance,
          travelAllowance: record.travelAllowance, medicalAllowance: record.medicalAllowance,
          performanceBonus: record.performanceBonus, shiftAllowance: record.shiftAllowance,
          nightDifferential: record.nightDifferential, otherEarnings: record.otherEarnings,
          grossEarnings: record.grossEarnings,
        },
        deductions: {
          pfEmployee: record.pfEmployee, esiEmployee: record.esiEmployee,
          professionalTax: record.professionalTax, tds: record.tds,
          lopDeduction: record.lopDeduction, loanDeduction: record.loanDeduction,
          otherDeductions: record.otherDeductions, totalDeductions: record.totalDeductions,
        },
        attendance: { workingDays: record.workingDays, presentDays: record.presentDays, lopDays: record.lopDays, overtimeHours: record.overtimeHours },
        netPay: record.netPay,
        taxRegime: record.taxRegime,
      };

      const monthName = new Date(run.periodYear, run.periodMonth - 1).toLocaleString("en-IN", { month: "long" });
      const html = generatePayslipHtml(payslipData, monthName, run.periodYear);

      const [existingSlip] = await db.select().from(payslipsTable).where(eq(payslipsTable.payrollRecordId, record.id));
      if (existingSlip) {
        await db.update(payslipsTable).set({ payslipData, htmlContent: html, generatedAt: new Date() }).where(eq(payslipsTable.id, existingSlip.id));
      } else {
        await db.insert(payslipsTable).values({
          payrollRecordId: record.id,
          employeeId: record.employeeId,
          periodYear: run.periodYear,
          periodMonth: run.periodMonth,
          payslipData,
          htmlContent: html,
        });
      }
    }

    await logAudit({ user: req.hrmsUser, action: "PAYROLL_APPROVE", module: "Payroll", recordId: runId, newValue: `${run.periodYear}-${run.periodMonth}`, ipAddress: req.ip });
    res.json({ message: "Payroll approved and payslips generated." });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/payroll/runs/:id/finalize", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const runId = Number(req.params.id);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, runId));
    if (!run) { res.status(404).json({ error: "Not found" }); return; }
    if (run.status !== "Approved") { res.status(422).json({ error: "Payroll must be Approved to finalize." }); return; }
    await db.update(payrollRunsTable).set({ status: "Locked", updatedAt: new Date() }).where(eq(payrollRunsTable.id, runId));
    await db.update(payrollRecordsTable).set({ status: "Paid", updatedAt: new Date() }).where(eq(payrollRecordsTable.payrollRunId, runId));
    const activeLoans = await db.select().from(loanRepaymentsTable).where(eq(loanRepaymentsTable.isActive, true));
    for (const loan of activeLoans) {
      const newOutstanding = Math.max(0, Number(loan.outstandingAmount) - Number(loan.monthlyDeduction));
      await db.update(loanRepaymentsTable).set({
        outstandingAmount: String(newOutstanding),
        ...(newOutstanding <= 0 && { isActive: false }),
        updatedAt: new Date(),
      }).where(eq(loanRepaymentsTable.id, loan.id));
    }

    // Auto-release the payroll lock for this period once finalized so that
    // normal operations (attendance corrections, leave accruals, etc.) can resume.
    await db.update(payrollLocksTable)
      .set({ isLocked: false, updatedAt: new Date() })
      .where(and(eq(payrollLocksTable.year, run.periodYear), eq(payrollLocksTable.month, run.periodMonth)));

    res.json({ message: "Payroll finalized and marked as Locked." });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/runs/:id/records", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const runId = Number(req.params.id);
    const records = await db.select({
      id: payrollRecordsTable.id,
      payrollRunId: payrollRecordsTable.payrollRunId,
      employeeId: payrollRecordsTable.employeeId,
      workingDays: payrollRecordsTable.workingDays,
      presentDays: payrollRecordsTable.presentDays,
      lopDays: payrollRecordsTable.lopDays,
      grossEarnings: payrollRecordsTable.grossEarnings,
      totalDeductions: payrollRecordsTable.totalDeductions,
      netPay: payrollRecordsTable.netPay,
      tds: payrollRecordsTable.tds,
      pfEmployee: payrollRecordsTable.pfEmployee,
      professionalTax: payrollRecordsTable.professionalTax,
      loanDeduction: payrollRecordsTable.loanDeduction,
      taxRegime: payrollRecordsTable.taxRegime,
      status: payrollRecordsTable.status,
      basic: payrollRecordsTable.basic,
      hra: payrollRecordsTable.hra,
      createdAt: payrollRecordsTable.createdAt,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      departmentId: employeesTable.departmentId,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .where(eq(payrollRecordsTable.payrollRunId, runId))
      .orderBy(asc(employeesTable.employeeId));
    res.json(records);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYSLIPS ─────────────────────────────────────────────────────────────────

router.get("/payroll/payslips", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { employeeId, year, month } = req.query as { employeeId?: string; year?: string; month?: string };
    const conds = [];

    // Employees and HODs can only view their own payslips
    if (u.role === "employee" || u.role === "hod") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id)).where(eq(hrmsUsersTable.id, u.id));
      if (!emp) { res.status(403).json({ error: "No employee record found for current user." }); return; }
      conds.push(eq(payslipsTable.employeeId, emp.id));
    } else if (employeeId) {
      conds.push(eq(payslipsTable.employeeId, Number(employeeId)));
    }
    if (year) conds.push(eq(payslipsTable.periodYear, Number(year)));
    if (month) conds.push(eq(payslipsTable.periodMonth, Number(month)));

    const payslips = await db.select({
      id: payslipsTable.id,
      payrollRecordId: payslipsTable.payrollRecordId,
      employeeId: payslipsTable.employeeId,
      periodYear: payslipsTable.periodYear,
      periodMonth: payslipsTable.periodMonth,
      generatedAt: payslipsTable.generatedAt,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      netPay: payrollRecordsTable.netPay,
    }).from(payslipsTable)
      .leftJoin(employeesTable, eq(payslipsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRecordsTable, eq(payslipsTable.payrollRecordId, payrollRecordsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payslipsTable.periodYear), desc(payslipsTable.periodMonth));
    res.json(payslips);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/payslips/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [payslip] = await db.select().from(payslipsTable).where(eq(payslipsTable.id, Number(req.params.id)));
    if (!payslip) { res.status(404).json({ error: "Not found" }); return; }

    const u = req.hrmsUser!;
    // Employees and HODs may only access their own payslip
    if (u.role === "employee" || u.role === "hod") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id)).where(eq(hrmsUsersTable.id, u.id));
      if (!emp || emp.id !== payslip.employeeId) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    res.json(payslip);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── STATUTORY REPORTS ────────────────────────────────────────────────────────

router.get("/payroll/reports/pf-ecr", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year: string; month: string };
    const records = await db.select({
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      basic: payrollRecordsTable.basic,
      pfEmployee: payrollRecordsTable.pfEmployee,
      pfEmployer: payrollRecordsTable.pfEmployer,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(eq(payrollRunsTable.periodYear, Number(year)), eq(payrollRunsTable.periodMonth, Number(month))));

    const totalPfEmployee = records.reduce((s, r) => s + Number(r.pfEmployee), 0);
    const totalPfEmployer = records.reduce((s, r) => s + Number(r.pfEmployer), 0);
    res.json({ period: `${year}-${month}`, records, summary: { totalPfEmployee, totalPfEmployer, totalPf: totalPfEmployee + totalPfEmployer } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/reports/esi", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year: string; month: string };
    const records = await db.select({
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      grossEarnings: payrollRecordsTable.grossEarnings,
      esiEmployee: payrollRecordsTable.esiEmployee,
      esiEmployer: payrollRecordsTable.esiEmployer,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(eq(payrollRunsTable.periodYear, Number(year)), eq(payrollRunsTable.periodMonth, Number(month))));

    const eligible = records.filter(r => Number(r.grossEarnings) <= 21000);
    res.json({ period: `${year}-${month}`, records: eligible, summary: { eligibleCount: eligible.length, totalEsiEmployee: eligible.reduce((s, r) => s + Number(r.esiEmployee), 0), totalEsiEmployer: eligible.reduce((s, r) => s + Number(r.esiEmployer), 0) } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/reports/pt", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year: string; month: string };
    const records = await db.select({
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      grossEarnings: payrollRecordsTable.grossEarnings,
      professionalTax: payrollRecordsTable.professionalTax,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(eq(payrollRunsTable.periodYear, Number(year)), eq(payrollRunsTable.periodMonth, Number(month))));
    res.json({ period: `${year}-${month}`, records, summary: { totalPT: records.reduce((s, r) => s + Number(r.professionalTax), 0) } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/reports/tds-summary", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year: string; month: string };
    const records = await db.select({
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      grossEarnings: payrollRecordsTable.grossEarnings,
      tds: payrollRecordsTable.tds,
      taxRegime: payrollRecordsTable.taxRegime,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(eq(payrollRunsTable.periodYear, Number(year)), eq(payrollRunsTable.periodMonth, Number(month))));
    res.json({ period: `${year}-${month}`, records, summary: { totalTDS: records.reduce((s, r) => s + Number(r.tds), 0), newRegimeCount: records.filter(r => r.taxRegime === "New").length, oldRegimeCount: records.filter(r => r.taxRegime === "Old").length } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/reports/bank-transfer", requireHrmsUser, requireRole(...PAYROLL_ADMIN_ROLES), async (req, res) => {
  try {
    const { year, month } = req.query as { year: string; month: string };
    const records = await db.select({
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      netPay: payrollRecordsTable.netPay,
      status: payrollRecordsTable.status,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(eq(payrollRunsTable.periodYear, Number(year)), eq(payrollRunsTable.periodMonth, Number(month))));
    const totalNetPay = records.reduce((s, r) => s + Number(r.netPay), 0);
    res.json({ period: `${year}-${month}`, records, summary: { totalNetPay, recordCount: records.length } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/payroll/reports/form-16/:employeeId/:year", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const empId = Number(req.params.employeeId);
    const year = Number(req.params.year);
    const records = await db.select({
      periodMonth: payrollRunsTable.periodMonth,
      periodYear: payrollRunsTable.periodYear,
      grossEarnings: payrollRecordsTable.grossEarnings,
      tds: payrollRecordsTable.tds,
      taxRegime: payrollRecordsTable.taxRegime,
      netPay: payrollRecordsTable.netPay,
      basic: payrollRecordsTable.basic,
      pfEmployee: payrollRecordsTable.pfEmployee,
    }).from(payrollRecordsTable)
      .leftJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(
        eq(payrollRecordsTable.employeeId, empId),
        or(
          and(eq(payrollRunsTable.periodYear, year), gte(payrollRunsTable.periodMonth, 4)),
          and(eq(payrollRunsTable.periodYear, year + 1), lte(payrollRunsTable.periodMonth, 3)),
        )
      ))
      .orderBy(asc(payrollRunsTable.periodYear), asc(payrollRunsTable.periodMonth));

    const [emp] = await db.select({
      name: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      code: employeesTable.employeeId,
    }).from(employeesTable).where(eq(employeesTable.id, empId));

    const totalGross = records.reduce((s, r) => s + Number(r.grossEarnings), 0);
    const totalTDS = records.reduce((s, r) => s + Number(r.tds), 0);
    const totalPF = records.reduce((s, r) => s + Number(r.pfEmployee), 0);

    res.json({
      employee: emp,
      financialYear: `${year}-${String(year + 1).slice(2)}`,
      records,
      summary: { totalGross, totalTDS, totalPF, taxableIncome: totalGross - 75000, regime: records[0]?.taxRegime ?? "New" }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYSLIP HTML GENERATOR ──────────────────────────────────────────────────

interface PayslipData {
  employee: { name: string; code: string | null | undefined; department: string; designation: string };
  period: { year: number; month: number };
  earnings: {
    basic: string | null; hra: string | null; specialAllowance: string | null;
    travelAllowance: string | null; medicalAllowance: string | null;
    performanceBonus: string | null; shiftAllowance: string | null;
    nightDifferential: string | null; otherEarnings: string | null; grossEarnings: string | null;
  };
  deductions: {
    pfEmployee: string | null; esiEmployee: string | null; professionalTax: string | null;
    tds: string | null; lopDeduction: string | null; loanDeduction: string | null;
    otherDeductions: string | null; totalDeductions: string | null;
  };
  attendance: { workingDays: string | null; presentDays: string | null; lopDays: string | null; overtimeHours: string | null };
  netPay: string | null;
  taxRegime: string | null;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generatePayslipHtml(data: PayslipData, monthName: string, year: number): string {
  const fmt = (n: string | number | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const e = data.earnings;
  const d = data.deductions;
  const a = data.attendance;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; margin: 0; padding: 20px; }
  .header { background: #1e293b; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { margin: 0; font-size: 18px; }
  .header p { margin: 2px 0; font-size: 11px; opacity: 0.85; }
  .badge { background: #3b82f6; color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .emp-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 16px; background: #f8fafc; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }
  .emp-info .field { display: flex; flex-direction: column; }
  .emp-info .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .emp-info .value { font-size: 13px; font-weight: 600; color: #1e293b; }
  .attendance-bar { display: flex; gap: 16px; padding: 12px 16px; background: #eff6ff; border-left: 1px solid #bfdbfe; border-right: 1px solid #bfdbfe; }
  .att-item { text-align: center; }
  .att-item .val { font-size: 20px; font-weight: 700; color: #1d4ed8; }
  .att-item .lbl { font-size: 10px; color: #64748b; }
  .salary-table { width: 100%; border-collapse: collapse; }
  .salary-table th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  .salary-table td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; }
  .salary-table .total-row td { font-weight: 700; background: #f8fafc; border-top: 2px solid #e2e8f0; }
  .net-pay-box { background: #1e293b; color: white; padding: 16px; text-align: center; border-radius: 0 0 8px 8px; }
  .net-pay-box .label { font-size: 11px; opacity: 0.75; }
  .net-pay-box .amount { font-size: 28px; font-weight: 700; }
  .regime-badge { display: inline-block; background: ${data.taxRegime === "New" ? "#10b981" : "#8b5cf6"}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>Automystics Technologies</h1>
    <p>Salary Slip — ${monthName} ${year}</p>
  </div>
  <div class="badge">PAYSLIP</div>
</div>
<div class="emp-info">
  <div class="field"><span class="label">Employee Name</span><span class="value">${escapeHtml(data.employee.name)}</span></div>
  <div class="field"><span class="label">Employee Code</span><span class="value">${escapeHtml(data.employee.code) || "—"}</span></div>
  <div class="field"><span class="label">Department</span><span class="value">${escapeHtml(data.employee.department)}</span></div>
  <div class="field"><span class="label">Designation</span><span class="value">${escapeHtml(data.employee.designation)}</span></div>
  <div class="field"><span class="label">Tax Regime</span><span class="value"><span class="regime-badge">${escapeHtml(data.taxRegime) || "New"}</span></span></div>
</div>
<div class="attendance-bar">
  <div class="att-item"><div class="val">${a.workingDays}</div><div class="lbl">Working Days</div></div>
  <div class="att-item"><div class="val">${a.presentDays}</div><div class="lbl">Days Present</div></div>
  <div class="att-item"><div class="val" style="color:#ef4444">${a.lopDays}</div><div class="lbl">LOP Days</div></div>
  <div class="att-item"><div class="val">${a.overtimeHours}</div><div class="lbl">OT Hours</div></div>
</div>
<table class="salary-table">
<thead><tr><th>Earnings</th><th style="text-align:right">Amount</th><th>Deductions</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>
<tr><td>Basic Pay</td><td style="text-align:right">${fmt(e.basic)}</td><td>PF (Employee)</td><td style="text-align:right">${fmt(d.pfEmployee)}</td></tr>
<tr><td>HRA</td><td style="text-align:right">${fmt(e.hra)}</td><td>ESI (Employee)</td><td style="text-align:right">${fmt(d.esiEmployee)}</td></tr>
<tr><td>Special Allowance</td><td style="text-align:right">${fmt(e.specialAllowance)}</td><td>Professional Tax</td><td style="text-align:right">${fmt(d.professionalTax)}</td></tr>
<tr><td>Travel Allowance</td><td style="text-align:right">${fmt(e.travelAllowance)}</td><td>TDS</td><td style="text-align:right">${fmt(d.tds)}</td></tr>
<tr><td>Medical Allowance</td><td style="text-align:right">${fmt(e.medicalAllowance)}</td><td>LOP Deduction</td><td style="text-align:right">${fmt(d.lopDeduction)}</td></tr>
<tr><td>Performance Bonus</td><td style="text-align:right">${fmt(e.performanceBonus)}</td><td>Loan Repayment</td><td style="text-align:right">${fmt(d.loanDeduction)}</td></tr>
<tr><td>Shift / Night Allowance</td><td style="text-align:right">${fmt(Number(e.shiftAllowance) + Number(e.nightDifferential))}</td><td>Other Deductions</td><td style="text-align:right">${fmt(d.otherDeductions)}</td></tr>
<tr class="total-row"><td>Gross Earnings</td><td style="text-align:right">${fmt(e.grossEarnings)}</td><td>Total Deductions</td><td style="text-align:right">${fmt(d.totalDeductions)}</td></tr>
</tbody>
</table>
<div class="net-pay-box">
  <div class="label">Net Pay (Take Home)</div>
  <div class="amount">${fmt(data.netPay)}</div>
</div>
</body>
</html>`;
}

// ─── PDF PAYSLIP GENERATOR ───────────────────────────────────────────────────

async function generatePayslipPdf(data: PayslipData, monthName: string, year: number): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { height } = page.getSize();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fmt = (n: string | number | null | undefined) =>
    `INR ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const e = data.earnings;
  const d = data.deductions;
  const a = data.attendance;
  const navy = rgb(0.118, 0.176, 0.235);
  const white = rgb(1, 1, 1);
  const light = rgb(0.95, 0.97, 0.99);
  const gray = rgb(0.39, 0.47, 0.56);
  const margin = 40;
  let y = height - 40;

  // Header band
  page.drawRectangle({ x: 0, y: height - 80, width: 595, height: 80, color: navy });
  page.drawText("Automystics Technologies", { x: margin, y: height - 35, size: 16, font: bold, color: white });
  page.drawText(`Salary Slip — ${monthName} ${year}`, { x: margin, y: height - 55, size: 11, font: regular, color: rgb(0.75, 0.82, 0.9) });
  page.drawText(`Tax Regime: ${data.taxRegime ?? "New"}`, { x: margin, y: height - 72, size: 9, font: regular, color: rgb(0.75, 0.82, 0.9) });

  y = height - 100;

  // Employee info row
  page.drawRectangle({ x: 0, y: y - 50, width: 595, height: 55, color: light });
  const infoItems = [
    ["Employee Name", data.employee.name],
    ["Employee Code", data.employee.code ?? "—"],
    ["Department", data.employee.department || "—"],
    ["Designation", data.employee.designation || "—"],
  ];
  const colW = 148;
  infoItems.forEach(([label, val], i) => {
    const x = margin + i * colW;
    page.drawText(label, { x, y: y - 18, size: 7, font: regular, color: gray });
    page.drawText(String(val).slice(0, 20), { x, y: y - 32, size: 10, font: bold, color: navy });
  });

  y -= 70;

  // Attendance bar
  page.drawRectangle({ x: 0, y: y - 40, width: 595, height: 45, color: rgb(0.94, 0.97, 1) });
  const attItems = [
    ["Working Days", a.workingDays ?? "0"],
    ["Days Present", a.presentDays ?? "0"],
    ["LOP Days", a.lopDays ?? "0"],
    ["Overtime Hours", a.overtimeHours ?? "0.00"],
  ];
  attItems.forEach(([label, val], i) => {
    const x = margin + i * 130;
    page.drawText(String(val), { x, y: y - 22, size: 14, font: bold, color: navy });
    page.drawText(label, { x, y: y - 36, size: 8, font: regular, color: gray });
  });

  y -= 60;

  // Table header
  page.drawRectangle({ x: margin, y: y - 18, width: 515, height: 20, color: rgb(0.94, 0.95, 0.97) });
  page.drawText("Earnings", { x: margin + 4, y: y - 13, size: 9, font: bold, color: gray });
  page.drawText("Amount", { x: margin + 200, y: y - 13, size: 9, font: bold, color: gray });
  page.drawText("Deductions", { x: margin + 265, y: y - 13, size: 9, font: bold, color: gray });
  page.drawText("Amount", { x: margin + 445, y: y - 13, size: 9, font: bold, color: gray });
  y -= 22;

  const rows = [
    ["Basic Pay", fmt(e.basic), "PF (Employee)", fmt(d.pfEmployee)],
    ["HRA", fmt(e.hra), "ESI (Employee)", fmt(d.esiEmployee)],
    ["Special Allowance", fmt(e.specialAllowance), "Professional Tax", fmt(d.professionalTax)],
    ["Travel Allowance", fmt(e.travelAllowance), "TDS", fmt(d.tds)],
    ["Medical Allowance", fmt(e.medicalAllowance), "LOP Deduction", fmt(d.lopDeduction)],
    ["Performance Bonus", fmt(e.performanceBonus), "Loan Repayment", fmt(d.loanDeduction)],
    ["Shift/Night Allowance", fmt(Number(e.shiftAllowance ?? 0) + Number(e.nightDifferential ?? 0)), "Other Deductions", fmt(d.otherDeductions)],
    ["Other Earnings", fmt(e.otherEarnings), "", ""],
  ];

  rows.forEach((row, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: margin, y: y - 14, width: 515, height: 16, color: rgb(0.98, 0.99, 1) });
    page.drawText(row[0], { x: margin + 4, y: y - 10, size: 9, font: regular, color: navy });
    page.drawText(row[1], { x: margin + 160, y: y - 10, size: 9, font: regular, color: navy });
    page.drawText(row[2], { x: margin + 268, y: y - 10, size: 9, font: regular, color: navy });
    page.drawText(row[3], { x: margin + 405, y: y - 10, size: 9, font: regular, color: navy });
    y -= 17;
  });

  // Totals row
  page.drawRectangle({ x: margin, y: y - 16, width: 515, height: 18, color: rgb(0.92, 0.94, 0.96) });
  page.drawText("Gross Earnings", { x: margin + 4, y: y - 11, size: 9, font: bold, color: navy });
  page.drawText(fmt(e.grossEarnings), { x: margin + 160, y: y - 11, size: 9, font: bold, color: navy });
  page.drawText("Total Deductions", { x: margin + 268, y: y - 11, size: 9, font: bold, color: navy });
  page.drawText(fmt(d.totalDeductions), { x: margin + 405, y: y - 11, size: 9, font: bold, color: navy });
  y -= 30;

  // Net pay box
  page.drawRectangle({ x: margin, y: y - 40, width: 515, height: 45, color: navy });
  page.drawText("NET PAY (TAKE HOME)", { x: margin + 180, y: y - 16, size: 9, font: regular, color: rgb(0.75, 0.82, 0.9) });
  page.drawText(fmt(data.netPay), { x: margin + 170, y: y - 33, size: 18, font: bold, color: white });

  return pdfDoc.save();
}

// PDF download endpoint
router.get("/payroll/payslips/:id/pdf", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [payslip] = await db.select().from(payslipsTable).where(eq(payslipsTable.id, Number(req.params.id)));
    if (!payslip) { res.status(404).json({ error: "Not found" }); return; }

    const u = req.hrmsUser!;
    if (u.role === "employee" || u.role === "hod") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id)).where(eq(hrmsUsersTable.id, u.id));
      if (!emp || emp.id !== payslip.employeeId) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    const [run] = await db.select().from(payrollRunsTable)
      .leftJoin(payrollRecordsTable, eq(payrollRecordsTable.id, payslip.payrollRecordId))
      .where(eq(payrollRunsTable.id, payrollRecordsTable.payrollRunId));

    const data = payslip.payslipData as PayslipData;
    const monthName = new Date(payslip.periodYear, payslip.periodMonth - 1).toLocaleString("en-IN", { month: "long" });
    const pdfBytes = await generatePayslipPdf(data, monthName, payslip.periodYear);

    const empName = (data?.employee?.name ?? "payslip").replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${empName}_${payslip.periodYear}_${payslip.periodMonth}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
