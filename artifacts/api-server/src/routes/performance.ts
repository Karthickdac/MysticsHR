import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import {
  performanceCyclesTable, performanceGoalsTable, goalProgressTable,
  selfAppraisalsTable, managerEvaluationsTable, appraisalOutcomesTable,
  employeesTable, hrmsUsersTable, departmentsTable, designationsTable,
  employeeProfilesTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const MANAGER_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

const STAGES = [
  "Goal Setting", "Mid Review", "Self Appraisal",
  "Manager Evaluation", "Calibration", "Completed",
] as const;

function getOutcomeLabel(score: number): string {
  if (score >= 4.5) return "Outstanding";
  if (score >= 3.5) return "Exceeds Expectations";
  if (score >= 2.5) return "Meets Expectations";
  if (score >= 1.5) return "Needs Improvement";
  return "Unsatisfactory";
}

// ─── PERFORMANCE CYCLES ──────────────────────────────────────────────────────

router.get("/performance/cycles", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { status } = req.query as { status?: string };
    const rows = await db.select().from(performanceCyclesTable)
      .where(status ? eq(performanceCyclesTable.status, status as "Draft" | "Active" | "Closed") : undefined)
      .orderBy(desc(performanceCyclesTable.createdAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/cycles", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { title, cycleType, startDate, endDate, description, status } = req.body;
    if (!title || !cycleType || !startDate || !endDate) {
      res.status(400).json({ error: "title, cycleType, startDate, and endDate are required" });
      return;
    }
    const [cycle] = await db.insert(performanceCyclesTable).values({
      title, cycleType, startDate, endDate, description: description ?? null,
      status: status ?? "Draft",
      createdBy: u.id,
    }).returning();
    res.status(201).json(cycle);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/performance/cycles/:id", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const [cycle] = await db.select().from(performanceCyclesTable)
      .where(eq(performanceCyclesTable.id, Number(req.params.id)));
    if (!cycle) { res.status(404).json({ error: "Not found" }); return; }
    res.json(cycle);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/performance/cycles/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { title, cycleType, startDate, endDate, description, status } = req.body;
    const [updated] = await db.update(performanceCyclesTable)
      .set({ title, cycleType, startDate, endDate, description: description ?? null, status: status ?? "Draft", updatedAt: new Date() })
      .where(eq(performanceCyclesTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/cycles/:id/advance-stage", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const [cycle] = await db.select().from(performanceCyclesTable)
      .where(eq(performanceCyclesTable.id, Number(req.params.id)));
    if (!cycle) { res.status(404).json({ error: "Not found" }); return; }

    const currentIdx = STAGES.indexOf(cycle.currentStage as typeof STAGES[number]);
    if (currentIdx === -1 || currentIdx === STAGES.length - 1) {
      res.status(400).json({ error: "Cycle is already at the final stage" });
      return;
    }
    const nextStage = STAGES[currentIdx + 1];
    const newStatus = nextStage === "Completed" ? "Closed" : (cycle.status === "Draft" ? "Active" : cycle.status);

    const [updated] = await db.update(performanceCyclesTable)
      .set({ currentStage: nextStage, status: newStatus as "Draft" | "Active" | "Closed", updatedAt: new Date() })
      .where(eq(performanceCyclesTable.id, Number(req.params.id)))
      .returning();
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PERFORMANCE GOALS (KRA/KPI) ──────────────────────────────────────────────

router.get("/performance/goals", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { cycleId, employeeId } = req.query as { cycleId?: string; employeeId?: string };
    const u = req.hrmsUser!;

    const conds = [];
    if (cycleId) conds.push(eq(performanceGoalsTable.cycleId, Number(cycleId)));
    if (employeeId) conds.push(eq(performanceGoalsTable.employeeId, Number(employeeId)));

    // Employees can only see their own goals — fail closed if no linked employee
    if (u.role === "employee") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!emp) {
        res.json([]); // No linked employee record: return empty, not all goals
        return;
      }
      conds.push(eq(performanceGoalsTable.employeeId, emp.id));
    }

    const goals = await db.select({
      id: performanceGoalsTable.id,
      cycleId: performanceGoalsTable.cycleId,
      employeeId: performanceGoalsTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      title: performanceGoalsTable.title,
      description: performanceGoalsTable.description,
      weightage: performanceGoalsTable.weightage,
      targetValue: performanceGoalsTable.targetValue,
      measurementMethod: performanceGoalsTable.measurementMethod,
      status: performanceGoalsTable.status,
      assignedBy: performanceGoalsTable.assignedBy,
      createdAt: performanceGoalsTable.createdAt,
    }).from(performanceGoalsTable)
      .leftJoin(employeesTable, eq(performanceGoalsTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(performanceGoalsTable.createdAt));

    // Enrich with latest progress
    const goalIds = goals.map(g => g.id);
    let progressMap: Record<number, number> = {};
    if (goalIds.length > 0) {
      const latestProgress = await db.select({
        goalId: goalProgressTable.goalId,
        progressPercent: goalProgressTable.progressPercent,
      }).from(goalProgressTable)
        .where(inArray(goalProgressTable.goalId, goalIds))
        .orderBy(desc(goalProgressTable.updatedAt));
      for (const p of latestProgress) {
        if (!progressMap[p.goalId]) progressMap[p.goalId] = p.progressPercent;
      }
    }

    res.json(goals.map(g => ({ ...g, progressPercent: progressMap[g.id] ?? 0 })));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/goals", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { cycleId, employeeId, title, description, weightage, targetValue, measurementMethod, status } = req.body;
    if (!cycleId || !employeeId || !title || weightage === undefined) {
      res.status(400).json({ error: "cycleId, employeeId, title, and weightage are required" });
      return;
    }
    const [goal] = await db.insert(performanceGoalsTable).values({
      cycleId: Number(cycleId),
      employeeId: Number(employeeId),
      title, description: description ?? null,
      weightage: String(weightage),
      targetValue: targetValue ?? null,
      measurementMethod: measurementMethod ?? null,
      status: status ?? "Active",
      assignedBy: u.id,
    }).returning();
    res.status(201).json(goal);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/performance/goals/:id", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { title, description, weightage, targetValue, measurementMethod, status } = req.body;
    const [updated] = await db.update(performanceGoalsTable)
      .set({ title, description: description ?? null, weightage: String(weightage), targetValue: targetValue ?? null, measurementMethod: measurementMethod ?? null, status: status ?? "Active", updatedAt: new Date() })
      .where(eq(performanceGoalsTable.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/performance/goals/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    await db.delete(performanceGoalsTable).where(eq(performanceGoalsTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GOAL PROGRESS ────────────────────────────────────────────────────────────

router.get("/performance/goals/:id/progress", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const goalId = Number(req.params.id);

    // Verify goal exists
    const [goal] = await db.select({ id: performanceGoalsTable.id, employeeId: performanceGoalsTable.employeeId })
      .from(performanceGoalsTable).where(eq(performanceGoalsTable.id, goalId));
    if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }

    // Employees can only see progress for their own goals
    if (u.role === "employee") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!emp || emp.id !== goal.employeeId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const rows = await db.select().from(goalProgressTable)
      .where(eq(goalProgressTable.goalId, goalId))
      .orderBy(desc(goalProgressTable.updatedAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/goals/:id/progress", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const goalId = Number(req.params.id);
    const { progressPercent, commentary } = req.body;
    if (progressPercent === undefined) {
      res.status(400).json({ error: "progressPercent is required" });
      return;
    }

    // Verify goal exists
    const [goal] = await db.select({ id: performanceGoalsTable.id, employeeId: performanceGoalsTable.employeeId })
      .from(performanceGoalsTable).where(eq(performanceGoalsTable.id, goalId));
    if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }

    // Employees can only update progress for their own goals
    if (u.role === "employee") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!emp || emp.id !== goal.employeeId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const [row] = await db.insert(goalProgressTable).values({
      goalId,
      progressPercent: Math.min(100, Math.max(0, Number(progressPercent))),
      commentary: commentary ?? null,
      updatedBy: u.id,
    }).returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SELF APPRAISALS ──────────────────────────────────────────────────────────

router.get("/performance/self-appraisals", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { cycleId, employeeId } = req.query as { cycleId?: string; employeeId?: string };
    const u = req.hrmsUser!;

    const conds = [];
    if (employeeId) conds.push(eq(selfAppraisalsTable.employeeId, Number(employeeId)));

    if (u.role === "employee") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (emp) conds.push(eq(selfAppraisalsTable.employeeId, emp.id));
    }

    let query = db.select({
      id: selfAppraisalsTable.id,
      goalId: selfAppraisalsTable.goalId,
      employeeId: selfAppraisalsTable.employeeId,
      rating: selfAppraisalsTable.rating,
      commentary: selfAppraisalsTable.commentary,
      submittedAt: selfAppraisalsTable.submittedAt,
    }).from(selfAppraisalsTable);

    if (cycleId) {
      query = (query as typeof query).leftJoin(performanceGoalsTable, eq(selfAppraisalsTable.goalId, performanceGoalsTable.id))
        .where(and(...conds, eq(performanceGoalsTable.cycleId, Number(cycleId)))) as typeof query;
    } else if (conds.length) {
      query = (query as typeof query).where(and(...conds)) as typeof query;
    }

    res.json(await query);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/self-appraisals", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { goalId, rating, commentary } = req.body;
    if (!goalId || rating === undefined) {
      res.status(400).json({ error: "goalId and rating are required" });
      return;
    }
    if (rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be between 1 and 5" });
      return;
    }

    // Get employee for this user — required for all roles; fail closed
    const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(hrmsUsersTable.id, u.id));

    if (!emp) {
      res.status(403).json({ error: "No employee record linked to your account" });
      return;
    }

    const employeeId = emp.id;

    // Verify that the goalId belongs to this employee — prevent appraisal of others' goals
    const [goal] = await db.select({ id: performanceGoalsTable.id, empId: performanceGoalsTable.employeeId })
      .from(performanceGoalsTable).where(eq(performanceGoalsTable.id, Number(goalId)));
    if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
    if (goal.empId !== employeeId) {
      res.status(403).json({ error: "You can only self-appraise your own goals" });
      return;
    }

    // Upsert: delete existing and re-insert
    await db.delete(selfAppraisalsTable).where(
      and(eq(selfAppraisalsTable.goalId, Number(goalId)), eq(selfAppraisalsTable.employeeId, employeeId))
    );
    const [row] = await db.insert(selfAppraisalsTable).values({
      goalId: Number(goalId),
      employeeId,
      rating: Number(rating),
      commentary: commentary ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── MANAGER EVALUATIONS ──────────────────────────────────────────────────────

router.get("/performance/manager-evaluations", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { cycleId, employeeId } = req.query as { cycleId?: string; employeeId?: string };
    const conds = [];
    if (employeeId) conds.push(eq(managerEvaluationsTable.employeeId, Number(employeeId)));

    let rows;
    if (cycleId) {
      rows = await db.select({
        id: managerEvaluationsTable.id,
        goalId: managerEvaluationsTable.goalId,
        employeeId: managerEvaluationsTable.employeeId,
        rating: managerEvaluationsTable.rating,
        commentary: managerEvaluationsTable.commentary,
        evaluatedBy: managerEvaluationsTable.evaluatedBy,
        evaluatedAt: managerEvaluationsTable.evaluatedAt,
      }).from(managerEvaluationsTable)
        .leftJoin(performanceGoalsTable, eq(managerEvaluationsTable.goalId, performanceGoalsTable.id))
        .where(and(...conds, eq(performanceGoalsTable.cycleId, Number(cycleId))));
    } else {
      rows = await db.select().from(managerEvaluationsTable)
        .where(conds.length ? and(...conds) : undefined);
    }
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/manager-evaluations", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { goalId, employeeId, rating, commentary } = req.body;
    if (!goalId || !employeeId || rating === undefined) {
      res.status(400).json({ error: "goalId, employeeId, and rating are required" });
      return;
    }
    if (rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be between 1 and 5" });
      return;
    }

    const targetEmployeeId = Number(employeeId);

    // Scope enforcement: HOD can only evaluate their direct reports;
    // HR roles and super_admin have unrestricted scope.
    const isHrRole = (["super_admin", "hr_manager", "hr_executive"] as string[]).includes(u.role);
    if (!isHrRole) {
      // Get HOD's own employee record to compare with target employee's managerId
      const [hodEmp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (!hodEmp) {
        res.status(403).json({ error: "No employee record linked to your account" });
        return;
      }
      const [targetEmp] = await db.select({ managerId: employeesTable.managerId }).from(employeesTable)
        .where(eq(employeesTable.id, targetEmployeeId));
      if (!targetEmp || targetEmp.managerId !== hodEmp.id) {
        res.status(403).json({ error: "You can only evaluate your direct reports" });
        return;
      }
    }

    // Verify goal belongs to the target employee
    const [goal] = await db.select({ id: performanceGoalsTable.id, empId: performanceGoalsTable.employeeId })
      .from(performanceGoalsTable).where(eq(performanceGoalsTable.id, Number(goalId)));
    if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
    if (goal.empId !== targetEmployeeId) {
      res.status(400).json({ error: "Goal does not belong to the specified employee" });
      return;
    }

    // Upsert
    await db.delete(managerEvaluationsTable).where(
      and(eq(managerEvaluationsTable.goalId, Number(goalId)), eq(managerEvaluationsTable.employeeId, targetEmployeeId))
    );
    const [row] = await db.insert(managerEvaluationsTable).values({
      goalId: Number(goalId),
      employeeId: targetEmployeeId,
      rating: Number(rating),
      commentary: commentary ?? null,
      evaluatedBy: u.id,
    }).returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CALIBRATION VIEW ─────────────────────────────────────────────────────────

router.get("/performance/calibration/:cycleId", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const cycleId = Number(req.params.cycleId);

    // Get all goals for this cycle
    const goals = await db.select({
      id: performanceGoalsTable.id,
      employeeId: performanceGoalsTable.employeeId,
      weightage: performanceGoalsTable.weightage,
    }).from(performanceGoalsTable)
      .where(eq(performanceGoalsTable.cycleId, cycleId));

    if (!goals.length) { res.json([]); return; }

    // Get all self appraisals for these goals
    const goalIds = goals.map(g => g.id);
    const selfAppraisals = await db.select().from(selfAppraisalsTable)
      .where(inArray(selfAppraisalsTable.goalId, goalIds));
    const managerEvals = await db.select().from(managerEvaluationsTable)
      .where(inArray(managerEvaluationsTable.goalId, goalIds));

    // Get employee info
    const employeeIds = [...new Set(goals.map(g => g.employeeId))];
    const employees = await db.select({
      id: employeesTable.id,
      name: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      code: employeesTable.employeeId,
      department: departmentsTable.name,
    }).from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(inArray(employeesTable.id, employeeIds));

    const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

    // Compute weighted scores per employee
    const results = employeeIds.map(empId => {
      const empGoals = goals.filter(g => g.employeeId === empId);
      const totalWeight = empGoals.reduce((s, g) => s + Number(g.weightage), 0);

      let selfScore: number | null = null;
      let managerScore: number | null = null;

      if (empGoals.length > 0) {
        const selfRatings = empGoals.map(g => {
          const s = selfAppraisals.find(a => a.goalId === g.id);
          return s ? { rating: s.rating, weight: Number(g.weightage) } : null;
        }).filter(Boolean) as { rating: number; weight: number }[];

        const mgrRatings = empGoals.map(g => {
          const m = managerEvals.find(a => a.goalId === g.id && a.employeeId === empId);
          return m ? { rating: m.rating, weight: Number(g.weightage) } : null;
        }).filter(Boolean) as { rating: number; weight: number }[];

        if (selfRatings.length > 0 && totalWeight > 0) {
          selfScore = selfRatings.reduce((s, r) => s + r.rating * r.weight / totalWeight, 0);
        }
        if (mgrRatings.length > 0 && totalWeight > 0) {
          managerScore = mgrRatings.reduce((s, r) => s + r.rating * r.weight / totalWeight, 0);
        }
      }

      const weightedScore = managerScore !== null ? managerScore : selfScore;
      const emp = empMap[empId];

      return {
        employeeId: empId,
        employeeName: emp?.name ?? null,
        employeeCode: emp?.code ?? null,
        department: emp?.department ?? null,
        selfScore: selfScore !== null ? Math.round(selfScore * 100) / 100 : null,
        managerScore: managerScore !== null ? Math.round(managerScore * 100) / 100 : null,
        weightedScore: weightedScore !== null ? Math.round(weightedScore * 100) / 100 : null,
        goalCount: empGoals.length,
      };
    });

    res.json(results.sort((a, b) => (b.weightedScore ?? 0) - (a.weightedScore ?? 0)));
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── APPRAISAL OUTCOMES ───────────────────────────────────────────────────────

router.get("/performance/outcomes", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { cycleId, employeeId } = req.query as { cycleId?: string; employeeId?: string };
    const u = req.hrmsUser!;

    const conds = [];
    if (cycleId) conds.push(eq(appraisalOutcomesTable.cycleId, Number(cycleId)));
    if (employeeId) conds.push(eq(appraisalOutcomesTable.employeeId, Number(employeeId)));

    if (u.role === "employee") {
      const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
        .where(eq(hrmsUsersTable.id, u.id));
      if (emp) conds.push(eq(appraisalOutcomesTable.employeeId, emp.id));
    }

    const rows = await db.select({
      id: appraisalOutcomesTable.id,
      cycleId: appraisalOutcomesTable.cycleId,
      employeeId: appraisalOutcomesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
      finalScore: appraisalOutcomesTable.finalScore,
      outcomLabel: appraisalOutcomesTable.outcomLabel,
      calibrationNote: appraisalOutcomesTable.calibrationNote,
      normalizedScore: appraisalOutcomesTable.normalizedScore,
      calculatedAt: appraisalOutcomesTable.calculatedAt,
    }).from(appraisalOutcomesTable)
      .leftJoin(employeesTable, eq(appraisalOutcomesTable.employeeId, employeesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(appraisalOutcomesTable.calculatedAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/performance/outcomes", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { cycleId, calibrationNotes } = req.body;
    if (!cycleId) { res.status(400).json({ error: "cycleId is required" }); return; }

    // Get calibration data
    const cycleIdNum = Number(cycleId);
    const goals = await db.select({
      id: performanceGoalsTable.id,
      employeeId: performanceGoalsTable.employeeId,
      weightage: performanceGoalsTable.weightage,
    }).from(performanceGoalsTable)
      .where(eq(performanceGoalsTable.cycleId, cycleIdNum));

    const goalIds = goals.map(g => g.id);
    const managerEvals = goalIds.length
      ? await db.select().from(managerEvaluationsTable).where(inArray(managerEvaluationsTable.goalId, goalIds))
      : [];
    const selfAppraisals = goalIds.length
      ? await db.select().from(selfAppraisalsTable).where(inArray(selfAppraisalsTable.goalId, goalIds))
      : [];

    const employeeIds = [...new Set(goals.map(g => g.employeeId))];

    // Compute outcomes
    const outcomes = employeeIds.map(empId => {
      const empGoals = goals.filter(g => g.employeeId === empId);
      const totalWeight = empGoals.reduce((s, g) => s + Number(g.weightage), 0);

      const mgrRatings = empGoals.map(g => {
        const m = managerEvals.find(a => a.goalId === g.id && a.employeeId === empId);
        const s = selfAppraisals.find(a => a.goalId === g.id && a.employeeId === empId);
        const rating = m?.rating ?? s?.rating ?? null;
        return rating !== null ? { rating, weight: Number(g.weightage) } : null;
      }).filter(Boolean) as { rating: number; weight: number }[];

      const finalScore = totalWeight > 0 && mgrRatings.length > 0
        ? mgrRatings.reduce((s, r) => s + r.rating * r.weight / totalWeight, 0)
        : null;

      return {
        cycleId: cycleIdNum,
        employeeId: empId,
        finalScore: finalScore !== null ? String(Math.round(finalScore * 100) / 100) : null,
        outcomLabel: finalScore !== null ? getOutcomeLabel(finalScore) as "Outstanding" | "Exceeds Expectations" | "Meets Expectations" | "Needs Improvement" | "Unsatisfactory" : null,
        calibrationNote: (calibrationNotes?.[empId] as string) ?? null,
        normalizedScore: finalScore !== null ? String(Math.round(finalScore * 100) / 100) : null,
        calculatedBy: u.id,
      };
    });

    // Upsert outcomes
    await db.delete(appraisalOutcomesTable).where(eq(appraisalOutcomesTable.cycleId, cycleIdNum));
    const inserted = outcomes.length
      ? await db.insert(appraisalOutcomesTable).values(outcomes).returning()
      : [];

    res.json(inserted);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── ESS PORTAL ───────────────────────────────────────────────────────────────

router.get("/ess/me", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const [emp] = await db.select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      employeeCode: employeesTable.employeeId,
      phone: employeesTable.phone,
      dateOfJoining: employeesTable.dateOfJoining,
      designation: designationsTable.name,
      department: departmentsTable.name,
      currentAddress: employeeProfilesTable.currentAddress,
      emergencyContactName: employeeProfilesTable.emergencyContactName,
      emergencyContactPhone: employeeProfilesTable.emergencyContactPhone,
      emergencyContactRelation: employeeProfilesTable.emergencyContactRelation,
    }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(employeeProfilesTable, eq(employeeProfilesTable.employeeId, employeesTable.id))
      .where(eq(hrmsUsersTable.id, u.id));

    if (!emp) {
      // Return basic user info if no employee linked
      res.json({ employeeId: 0, name: u.name, email: u.email });
      return;
    }

    res.json({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      email: emp.email ?? u.email,
      employeeCode: emp.employeeCode,
      designation: emp.designation ?? null,
      department: emp.department ?? null,
      dateOfJoining: emp.dateOfJoining ?? null,
      phone: emp.phone ?? null,
      currentAddress: emp.currentAddress ?? null,
      emergencyContactName: emp.emergencyContactName ?? null,
      emergencyContactPhone: emp.emergencyContactPhone ?? null,
      emergencyContactRelation: emp.emergencyContactRelation ?? null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/ess/me", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const {
      phone, personalEmail, currentAddress,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
    } = req.body;

    const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(hrmsUsersTable.id, u.id));

    if (!emp) { res.status(404).json({ error: "No employee record linked" }); return; }

    // Update phone on employees table
    if (phone !== undefined) {
      await db.update(employeesTable).set({ phone, updatedAt: new Date() })
        .where(eq(employeesTable.id, emp.id));
    }

    // Upsert employee profile fields
    const profileUpdate: Record<string, string | null> = {};
    if (currentAddress !== undefined) profileUpdate.currentAddress = currentAddress;
    if (emergencyContactName !== undefined) profileUpdate.emergencyContactName = emergencyContactName;
    if (emergencyContactPhone !== undefined) profileUpdate.emergencyContactPhone = emergencyContactPhone;
    if (emergencyContactRelation !== undefined) profileUpdate.emergencyContactRelation = emergencyContactRelation;

    if (Object.keys(profileUpdate).length > 0) {
      const existing = await db.select({ id: employeeProfilesTable.id })
        .from(employeeProfilesTable).where(eq(employeeProfilesTable.employeeId, emp.id));
      if (existing.length > 0) {
        await db.update(employeeProfilesTable)
          .set({ ...profileUpdate, updatedAt: new Date() })
          .where(eq(employeeProfilesTable.employeeId, emp.id));
      } else {
        await db.insert(employeeProfilesTable).values({ employeeId: emp.id, ...profileUpdate });
      }
    }

    // Return updated profile
    const [updated] = await db.select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phone: employeesTable.phone,
      currentAddress: employeeProfilesTable.currentAddress,
      emergencyContactName: employeeProfilesTable.emergencyContactName,
      emergencyContactPhone: employeeProfilesTable.emergencyContactPhone,
      emergencyContactRelation: employeeProfilesTable.emergencyContactRelation,
    }).from(employeesTable)
      .leftJoin(employeeProfilesTable, eq(employeeProfilesTable.employeeId, employeesTable.id))
      .where(eq(employeesTable.id, emp.id));

    res.json({
      employeeId: updated.id,
      name: `${updated.firstName} ${updated.lastName}`,
      email: updated.email ?? u.email,
      phone: updated.phone,
      currentAddress: updated.currentAddress,
      emergencyContactName: updated.emergencyContactName,
      emergencyContactPhone: updated.emergencyContactPhone,
      emergencyContactRelation: updated.emergencyContactRelation,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/ess/dashboard", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(hrmsUsersTable.id, u.id));

    if (!emp) {
      res.json({ attendance: { presentDays: 0, absentDays: 0, lateDays: 0, month: "" }, leaveBalances: [], performanceGoals: [], pendingActions: [] });
      return;
    }

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Attendance this month
    const { attendanceRecordsTable } = await import("@workspace/db/schema");
    const attRows = await db.select({ status: attendanceRecordsTable.status })
      .from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.employeeId, emp.id),
        sql`to_char(${attendanceRecordsTable.date}, 'YYYY-MM') = ${yearMonth}`
      ));
    const presentDays = attRows.filter(r => ["Present", "Half-Day", "On Leave"].includes(r.status ?? "")).length;
    const absentDays = attRows.filter(r => r.status === "Absent").length;
    const lateDays = attRows.filter(r => r.status === "Late").length;

    // Leave balances
    const { leaveBalancesTable, leaveTypesTable } = await import("@workspace/db/schema");
    const balances = await db.select({
      leaveTypeName: leaveTypesTable.name,
      balance: leaveBalancesTable.allocated,
      used: leaveBalancesTable.used,
    }).from(leaveBalancesTable)
      .leftJoin(leaveTypesTable, eq(leaveBalancesTable.leaveTypeId, leaveTypesTable.id))
      .where(and(eq(leaveBalancesTable.employeeId, emp.id), eq(leaveBalancesTable.year, now.getFullYear())));

    // Active performance goals
    const { payslipsTable } = await import("@workspace/db/schema");
    const activeGoals = await db.select({
      id: performanceGoalsTable.id,
      title: performanceGoalsTable.title,
      weightage: performanceGoalsTable.weightage,
      cycleId: performanceGoalsTable.cycleId,
    }).from(performanceGoalsTable)
      .leftJoin(performanceCyclesTable, eq(performanceGoalsTable.cycleId, performanceCyclesTable.id))
      .where(and(
        eq(performanceGoalsTable.employeeId, emp.id),
        eq(performanceCyclesTable.status, "Active")
      ))
      .limit(5);

    // Recent payslip
    const [recentPayslip] = await db.select({
      id: payslipsTable.id,
      periodYear: payslipsTable.periodYear,
      periodMonth: payslipsTable.periodMonth,
    }).from(payslipsTable)
      .where(eq(payslipsTable.employeeId, emp.id))
      .orderBy(desc(payslipsTable.periodYear), desc(payslipsTable.periodMonth))
      .limit(1);

    res.json({
      attendance: { presentDays, absentDays, lateDays, month: yearMonth },
      leaveBalances: balances,
      recentPayslip: recentPayslip ?? null,
      performanceGoals: activeGoals,
      pendingActions: [],
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
