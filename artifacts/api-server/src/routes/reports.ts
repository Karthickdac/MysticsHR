import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { db } from "../lib/db";
import {
  employeesTable,
  departmentsTable,
  designationsTable,
  hrmsUsersTable,
  attendanceRecordsTable,
  leaveApplicationsTable,
  leaveTypesTable,
  payrollRecordsTable,
  payrollRunsTable,
  performanceCyclesTable,
  appraisalOutcomesTable,
  jobRequisitionsTable,
  candidatesTable,
  exitRequestsTable,
  helpdeskTicketsTable,
  reportSchedulesTable,
  savedReportTemplatesTable,
  permissionApplicationsTable,
  permissionRegistersTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, sql, desc, count, or } from "drizzle-orm";

const router = Router();
const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const MANAGER_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;

// ─── ANALYTICS DASHBOARD ──────────────────────────────────────────────────────
router.get("/analytics/dashboard", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStr = now.toISOString().split("T")[0];

    const [totalHeadcount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(employeesTable).where(eq(employeesTable.isActive, true));

    const [newJoiners] = await db.select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(
        eq(employeesTable.isActive, true),
        gte(employeesTable.dateOfJoining, firstOfMonth.toISOString().split("T")[0]),
      ));

    const [separatedThisMonth] = await db.select({ count: sql<number>`count(*)::int` })
      .from(exitRequestsTable)
      .where(and(
        eq(exitRequestsTable.status, "Separated"),
        gte(exitRequestsTable.separatedAt, firstOfMonth),
      ));

    const [openPositions] = await db.select({ count: sql<number>`count(*)::int` })
      .from(jobRequisitionsTable)
      .where(eq(jobRequisitionsTable.status, "Open"));

    const [pendingLeave] = await db.select({ count: sql<number>`count(*)::int` })
      .from(leaveApplicationsTable)
      .where(eq(leaveApplicationsTable.status, "Pending"));

    const [openTickets] = await db.select({ count: sql<number>`count(*)::int` })
      .from(helpdeskTicketsTable)
      .where(eq(helpdeskTicketsTable.status, "Open"));

    const pendingApprovals = (pendingLeave?.count ?? 0) + (openTickets?.count ?? 0);

    const total = totalHeadcount?.count ?? 0;
    const separated = separatedThisMonth?.count ?? 0;
    const attritionRate = total > 0 ? Math.round((separated / total) * 100 * 10) / 10 : 0;

    // Attendance rate today
    const [presentToday] = await db.select({ count: sql<number>`count(*)::int` })
      .from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.attendanceDate, todayStr),
        or(
          eq(attendanceRecordsTable.status, "Present"),
          eq(attendanceRecordsTable.status, "Half-Day"),
        ),
      ));

    const attendanceTodayRate = total > 0
      ? Math.round(((presentToday?.count ?? 0) / total) * 100 * 10) / 10
      : 0;

    // Headcount by department
    const byDepartment = await db.select({
      departmentName: departmentsTable.name,
      headcount: sql<number>`count(${employeesTable.id})::int`,
    }).from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(eq(employeesTable.isActive, true))
      .groupBy(departmentsTable.name)
      .orderBy(desc(sql<number>`count(${employeesTable.id})`));

    // Headcount trend (last 6 months)
    const headcountTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const label = d.toLocaleString("default", { month: "short", year: "2-digit" });

      const [hc] = await db.select({ count: sql<number>`count(*)::int` })
        .from(employeesTable)
        .where(and(
          eq(employeesTable.isActive, true),
          lte(employeesTable.dateOfJoining, monthEnd.toISOString().split("T")[0]),
        ));

      const [joiners] = await db.select({ count: sql<number>`count(*)::int` })
        .from(employeesTable)
        .where(and(
          gte(employeesTable.dateOfJoining, d.toISOString().split("T")[0]),
          lte(employeesTable.dateOfJoining, monthEnd.toISOString().split("T")[0]),
        ));

      const [leavers] = await db.select({ count: sql<number>`count(*)::int` })
        .from(exitRequestsTable)
        .where(and(
          eq(exitRequestsTable.status, "Separated"),
          gte(exitRequestsTable.separatedAt, d),
          lte(exitRequestsTable.separatedAt, monthEnd),
        ));

      headcountTrend.push({
        month: label,
        headcount: hc?.count ?? 0,
        joiners: joiners?.count ?? 0,
        leavers: leavers?.count ?? 0,
      });
    }

    res.json({
      totalHeadcount: total,
      newJoinersThisMonth: newJoiners?.count ?? 0,
      attritionRate,
      attendanceTodayRate,
      openPositions: openPositions?.count ?? 0,
      pendingApprovals,
      separatedThisMonth: separated,
      byDepartment: byDepartment.map(r => ({ departmentName: r.departmentName ?? "Unassigned", headcount: r.headcount })),
      headcountTrend,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── EMPLOYEE DIRECTORY REPORT ────────────────────────────────────────────────
router.get("/reports/employee-directory", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { departmentId, designationId, employmentType, status, location } = req.query as Record<string, string>;

    const conds: any[] = [];
    if (departmentId) conds.push(eq(employeesTable.departmentId, Number(departmentId)));
    if (designationId) conds.push(eq(employeesTable.designationId, Number(designationId)));
    if (employmentType) conds.push(eq(employeesTable.employmentType, employmentType as any));
    if (status) conds.push(eq(employeesTable.status, status as any));
    if (location) conds.push(eq(employeesTable.location, location));

    const rows = await db.select({
      id: employeesTable.id,
      employeeCode: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phone: employeesTable.phone,
      department: departmentsTable.name,
      designation: designationsTable.name,
      employmentType: employeesTable.employmentType,
      status: employeesTable.status,
      dateOfJoining: employeesTable.dateOfJoining,
      location: employeesTable.location,
    }).from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(employeesTable.firstName);

    const data = rows.map(r => ({
      ...r,
      employeeName: `${r.firstName} ${r.lastName}`,
    }));

    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── ATTENDANCE SUMMARY REPORT ─────────────────────────────────────────────────
router.get("/reports/attendance-summary", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId, employeeId } = req.query as Record<string, string>;

    const conds: any[] = [];
    if (fromDate) conds.push(gte(attendanceRecordsTable.attendanceDate, fromDate));
    if (toDate) conds.push(lte(attendanceRecordsTable.attendanceDate, toDate));
    if (employeeId) conds.push(eq(attendanceRecordsTable.employeeId, Number(employeeId)));

    const rows = await db.select({
      employeeId: attendanceRecordsTable.employeeId,
      date: attendanceRecordsTable.attendanceDate,
      status: attendanceRecordsTable.status,
      checkIn: attendanceRecordsTable.signInTime,
      checkOut: attendanceRecordsTable.signOutTime,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      department: departmentsTable.name,
    }).from(attendanceRecordsTable)
      .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        ...(conds.length ? conds : [sql`1=1`]),
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(desc(attendanceRecordsTable.attendanceDate));

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    }));

    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LEAVE UTILIZATION REPORT ─────────────────────────────────────────────────
router.get("/reports/leave-utilization", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId, leaveType } = req.query as Record<string, string>;

    const conds: any[] = [eq(leaveApplicationsTable.status, "Approved")];
    if (fromDate) conds.push(gte(leaveApplicationsTable.fromDate, fromDate));
    if (toDate) conds.push(lte(leaveApplicationsTable.toDate, toDate));

    const rows = await db.select({
      employeeId: leaveApplicationsTable.employeeId,
      leaveType: leaveTypesTable.name,
      fromDate: leaveApplicationsTable.fromDate,
      toDate: leaveApplicationsTable.toDate,
      totalDays: leaveApplicationsTable.totalDays,
      reason: leaveApplicationsTable.reason,
      status: leaveApplicationsTable.status,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      department: departmentsTable.name,
    }).from(leaveApplicationsTable)
      .leftJoin(employeesTable, eq(leaveApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(leaveTypesTable, eq(leaveApplicationsTable.leaveTypeId, leaveTypesTable.id))
      .where(and(
        ...conds,
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
        ...(leaveType ? [eq(leaveTypesTable.name, leaveType)] : []),
      ))
      .orderBy(desc(leaveApplicationsTable.fromDate));

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    }));

    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PAYROLL REGISTER REPORT ──────────────────────────────────────────────────
router.get("/reports/payroll-register", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const { month, year, departmentId } = req.query as Record<string, string>;

    const conds: any[] = [];
    if (month) conds.push(eq(payrollRunsTable.month, Number(month)));
    if (year) conds.push(eq(payrollRunsTable.year, Number(year)));

    const runs = await db.select().from(payrollRunsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payrollRunsTable.year), desc(payrollRunsTable.month));

    if (runs.length === 0) { res.json({ data: [], total: 0 }); return; }

    const runId = runs[0].id;
    const rows = await db.select({
      employeeId: payrollRecordsTable.employeeId,
      grossSalary: payrollRecordsTable.grossEarnings,
      netSalary: payrollRecordsTable.netPay,
      totalDeductions: payrollRecordsTable.totalDeductions,
      presentDays: payrollRecordsTable.presentDays,
      lossOfPayDays: payrollRecordsTable.lopDays,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      department: departmentsTable.name,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        eq(payrollRecordsTable.payrollRunId, runId),
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(employeesTable.firstName);

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    }));

    res.json({ data, total: data.length, runId, month: runs[0].month, year: runs[0].year });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── HEADCOUNT REPORT ────────────────────────────────────────────────────────
router.get("/reports/headcount", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId } = req.query as Record<string, string>;

    const conds: any[] = [eq(employeesTable.isActive, true)];
    if (departmentId) conds.push(eq(employeesTable.departmentId, Number(departmentId)));
    if (toDate) conds.push(lte(employeesTable.dateOfJoining, toDate));

    const byDept = await db.select({
      department: departmentsTable.name,
      employmentType: employeesTable.employmentType,
      count: sql<number>`count(${employeesTable.id})::int`,
    }).from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(...conds))
      .groupBy(departmentsTable.name, employeesTable.employmentType);

    const data = byDept.map(r => ({
      department: r.department ?? "Unassigned",
      employmentType: r.employmentType,
      count: r.count,
    }));

    res.json({ data, total: data.reduce((s, r) => s + r.count, 0) });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── ATTRITION REPORT ─────────────────────────────────────────────────────────
router.get("/reports/attrition", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId } = req.query as Record<string, string>;

    const conds: any[] = [eq(exitRequestsTable.status, "Separated")];
    if (fromDate) conds.push(gte(exitRequestsTable.separatedAt, new Date(fromDate)));
    if (toDate) conds.push(lte(exitRequestsTable.separatedAt, new Date(toDate)));

    const rows = await db.select({
      id: exitRequestsTable.id,
      employeeId: exitRequestsTable.employeeId,
      exitType: exitRequestsTable.exitType,
      reason: exitRequestsTable.reason,
      requestedLwd: exitRequestsTable.requestedLwd,
      actualLwd: exitRequestsTable.actualLwd,
      separatedAt: exitRequestsTable.separatedAt,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      dateOfJoining: employeesTable.dateOfJoining,
      department: departmentsTable.name,
    }).from(exitRequestsTable)
      .leftJoin(employeesTable, eq(exitRequestsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        ...conds,
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(desc(exitRequestsTable.separatedAt));

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
      tenureYears: r.dateOfJoining && r.actualLwd
        ? Math.round((new Date(r.actualLwd).getTime() - new Date(r.dateOfJoining).getTime()) / (1000 * 60 * 60 * 24 * 365) * 10) / 10
        : null,
    }));

    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PERFORMANCE SUMMARY REPORT ───────────────────────────────────────────────
router.get("/reports/performance-summary", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { cycleId, departmentId } = req.query as Record<string, string>;

    const conds: any[] = [];
    if (cycleId) conds.push(eq(appraisalOutcomesTable.cycleId, Number(cycleId)));

    const rows = await db.select({
      appraisalId: appraisalOutcomesTable.id,
      employeeId: appraisalOutcomesTable.employeeId,
      cycleId: appraisalOutcomesTable.cycleId,
      finalScore: appraisalOutcomesTable.finalScore,
      outcomeLabel: appraisalOutcomesTable.outcomLabel,
      normalizedScore: appraisalOutcomesTable.normalizedScore,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      department: departmentsTable.name,
    }).from(appraisalOutcomesTable)
      .leftJoin(employeesTable, eq(appraisalOutcomesTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        ...conds,
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(desc(appraisalOutcomesTable.finalScore));

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    }));

    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── RECRUITMENT PIPELINE REPORT ──────────────────────────────────────────────
router.get("/reports/recruitment-pipeline", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId } = req.query as Record<string, string>;

    const conds: any[] = [];
    if (departmentId) conds.push(eq(jobRequisitionsTable.departmentId, Number(departmentId)));
    if (fromDate) conds.push(gte(jobRequisitionsTable.createdAt, new Date(fromDate)));
    if (toDate) conds.push(lte(jobRequisitionsTable.createdAt, new Date(toDate)));

    const reqs = await db.select({
      id: jobRequisitionsTable.id,
      title: jobRequisitionsTable.title,
      status: jobRequisitionsTable.status,
      numberOfPositions: jobRequisitionsTable.numberOfPositions,
      department: departmentsTable.name,
      designation: designationsTable.name,
      createdAt: jobRequisitionsTable.createdAt,
    }).from(jobRequisitionsTable)
      .leftJoin(departmentsTable, eq(jobRequisitionsTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(jobRequisitionsTable.designationId, designationsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobRequisitionsTable.createdAt));

    const data = reqs;
    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── PERMISSION USAGE REPORT ──────────────────────────────────────────────────
router.get("/reports/permission-usage", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, departmentId, status } = req.query as Record<string, string>;

    const conds: ReturnType<typeof eq>[] = [];
    if (fromDate) conds.push(gte(permissionApplicationsTable.permissionDate, fromDate));
    if (toDate) conds.push(lte(permissionApplicationsTable.permissionDate, toDate));
    if (status) conds.push(eq(permissionApplicationsTable.status, status as "Pending" | "Approved" | "Rejected"));

    const rows = await db.select({
      id: permissionApplicationsTable.id,
      employeeId: permissionApplicationsTable.employeeId,
      permissionDate: permissionApplicationsTable.permissionDate,
      startTime: permissionApplicationsTable.startTime,
      endTime: permissionApplicationsTable.endTime,
      durationMinutes: permissionApplicationsTable.durationMinutes,
      reason: permissionApplicationsTable.reason,
      status: permissionApplicationsTable.status,
      isOverride: permissionApplicationsTable.isOverride,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      department: departmentsTable.name,
    }).from(permissionApplicationsTable)
      .leftJoin(employeesTable, eq(permissionApplicationsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        ...(conds.length ? conds : [sql`1=1`]),
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(desc(permissionApplicationsTable.permissionDate));

    const data = rows.map(r => ({
      ...r,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
      durationHours: Number((r.durationMinutes / 60).toFixed(2)),
    }));

    // Monthly register summary
    const register = await db.select({
      employeeId: permissionRegistersTable.employeeId,
      year: permissionRegistersTable.year,
      month: permissionRegistersTable.month,
      usedMinutes: permissionRegistersTable.usedMinutes,
      limitMinutes: permissionRegistersTable.limitMinutes,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      department: departmentsTable.name,
    }).from(permissionRegistersTable)
      .leftJoin(employeesTable, eq(permissionRegistersTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(departmentId ? eq(employeesTable.departmentId, Number(departmentId)) : sql`1=1`)
      .orderBy(desc(permissionRegistersTable.year), desc(permissionRegistersTable.month));

    res.json({ data, total: data.length, registerSummary: register });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── HELPDESK SLA REPORT ──────────────────────────────────────────────────────
router.get("/reports/helpdesk-sla", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { fromDate, toDate, priority, status } = req.query as Record<string, string>;

    const conds: ReturnType<typeof eq>[] = [];
    if (fromDate) conds.push(gte(helpdeskTicketsTable.createdAt, new Date(fromDate)));
    if (toDate) conds.push(lte(helpdeskTicketsTable.createdAt, new Date(toDate)));
    if (priority) conds.push(eq(helpdeskTicketsTable.priority, priority as "Low" | "Medium" | "High" | "Urgent"));
    if (status) conds.push(eq(helpdeskTicketsTable.status, status as "Open" | "In Progress" | "Resolved" | "Closed"));

    const rows = await db.select({
      id: helpdeskTicketsTable.id,
      subject: helpdeskTicketsTable.subject,
      category: helpdeskTicketsTable.category,
      priority: helpdeskTicketsTable.priority,
      status: helpdeskTicketsTable.status,
      slaBreached: helpdeskTicketsTable.slaBreached,
      slaDeadline: helpdeskTicketsTable.slaDeadline,
      resolvedAt: helpdeskTicketsTable.resolvedAt,
      closedAt: helpdeskTicketsTable.closedAt,
      createdAt: helpdeskTicketsTable.createdAt,
      assigneeName: hrmsUsersTable.name,
      raisedBy: employeesTable.firstName,
      raisedByLast: employeesTable.lastName,
      department: departmentsTable.name,
    }).from(helpdeskTicketsTable)
      .leftJoin(hrmsUsersTable, eq(helpdeskTicketsTable.assignedToUserId, hrmsUsersTable.id))
      .leftJoin(employeesTable, eq(helpdeskTicketsTable.raisedByEmployeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(helpdeskTicketsTable.createdAt));

    const data = rows.map(r => {
      const resolvedMs = r.resolvedAt && r.createdAt
        ? r.resolvedAt.getTime() - r.createdAt.getTime()
        : null;
      return {
        ...r,
        raisedByName: r.raisedBy && r.raisedByLast ? `${r.raisedBy} ${r.raisedByLast}` : null,
        resolutionHours: resolvedMs !== null ? Math.round(resolvedMs / 36000) / 100 : null,
      };
    });

    // Summary: breach counts by priority
    const breachSummary = ["Low", "Medium", "High", "Urgent"].map(p => ({
      priority: p,
      total: data.filter(r => r.priority === p).length,
      breached: data.filter(r => r.priority === p && r.slaBreached).length,
      avgResolutionHours: (() => {
        const resolved = data.filter(r => r.priority === p && r.resolutionHours !== null);
        return resolved.length > 0 ? Math.round(resolved.reduce((s, r) => s + (r.resolutionHours ?? 0), 0) / resolved.length * 100) / 100 : null;
      })(),
    }));

    const totalTickets = data.length;
    const openTickets = data.filter(r => r.status === "Open" || r.status === "In Progress").length;
    const resolvedTickets = data.filter(r => r.status === "Resolved" || r.status === "Closed").length;
    const slaBreachedCount = data.filter(r => r.slaBreached).length;
    const resolvedWithHours = data.filter(r => r.resolutionHours !== null);
    const avgResolutionHours = resolvedWithHours.length > 0
      ? Math.round(resolvedWithHours.reduce((s, r) => s + (r.resolutionHours ?? 0), 0) / resolvedWithHours.length * 100) / 100
      : null;
    const byPriority = breachSummary;
    const categories = [...new Set(data.map(r => r.category))];
    const byCategory = categories.map(cat => ({
      category: cat,
      total: data.filter(r => r.category === cat).length,
      breached: data.filter(r => r.category === cat && r.slaBreached).length,
    }));

    res.json({ data, total: totalTickets, totalTickets, openTickets, resolvedTickets, slaBreachedCount, avgResolutionHours, byPriority, byCategory });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── STATUTORY COMPLIANCE REPORT ──────────────────────────────────────────────
// Summarizes PF (12% employer + 12% employee) and ESI (3.25% employer + 0.75% employee) contributions from payroll data
router.get("/reports/statutory-compliance", requireHrmsUser, requireRole(...HR_ROLES, "payroll_admin"), async (req, res) => {
  try {
    const { month, year, departmentId } = req.query as Record<string, string>;

    const PF_WAGE_CEILING = 15000; // INR — PF computed on min(basic, 15000)
    const EPF_EMPLOYER_RATE = 0.12;
    const EPF_EMPLOYEE_RATE = 0.12;
    const ESI_WAGE_CEILING = 21000;
    const ESI_EMPLOYER_RATE = 0.0325;
    const ESI_EMPLOYEE_RATE = 0.0075;

    const runConds: ReturnType<typeof eq>[] = [];
    if (month) runConds.push(eq(payrollRunsTable.month, Number(month)));
    if (year) runConds.push(eq(payrollRunsTable.year, Number(year)));

    const runs = await db.select().from(payrollRunsTable)
      .where(runConds.length ? and(...runConds) : undefined)
      .orderBy(desc(payrollRunsTable.year), desc(payrollRunsTable.month));

    if (runs.length === 0) { res.json({ data: [], total: 0, summary: {} }); return; }

    const runId = runs[0].id;
    const rows = await db.select({
      employeeId: payrollRecordsTable.employeeId,
      grossEarnings: payrollRecordsTable.grossEarnings,
      netPay: payrollRecordsTable.netPay,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      department: departmentsTable.name,
      ctc: employeesTable.ctc,
    }).from(payrollRecordsTable)
      .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(and(
        eq(payrollRecordsTable.payrollRunId, runId),
        ...(departmentId ? [eq(employeesTable.departmentId, Number(departmentId))] : []),
      ))
      .orderBy(employeesTable.firstName);

    const data = rows.map(r => {
      const gross = Number(r.grossEarnings ?? 0);
      // Approximate basic as 40% of gross for PF purposes (customize per salary structure)
      const basicForPf = Math.min(gross * 0.4, PF_WAGE_CEILING);
      const pfEmployer = Math.round(basicForPf * EPF_EMPLOYER_RATE);
      const pfEmployee = Math.round(basicForPf * EPF_EMPLOYEE_RATE);

      const esiEligible = gross <= ESI_WAGE_CEILING;
      const esiEmployer = esiEligible ? Math.round(gross * ESI_EMPLOYER_RATE) : 0;
      const esiEmployee = esiEligible ? Math.round(gross * ESI_EMPLOYEE_RATE) : 0;

      return {
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
        department: r.department,
        grossEarnings: gross,
        pfEmployer,
        pfEmployee,
        pfTotal: pfEmployer + pfEmployee,
        esiEligible,
        esiEmployer,
        esiEmployee,
        esiTotal: esiEmployer + esiEmployee,
        totalStatutory: pfEmployer + pfEmployee + esiEmployer + esiEmployee,
      };
    });

    const summary = {
      month: runs[0].month,
      year: runs[0].year,
      totalPfEmployer: data.reduce((s, r) => s + r.pfEmployer, 0),
      totalPfEmployee: data.reduce((s, r) => s + r.pfEmployee, 0),
      totalEsiEmployer: data.reduce((s, r) => s + r.esiEmployer, 0),
      totalEsiEmployee: data.reduce((s, r) => s + r.esiEmployee, 0),
      totalStatutory: data.reduce((s, r) => s + r.totalStatutory, 0),
      headcount: data.length,
      esiEligibleCount: data.filter(r => r.esiEligible).length,
    };

    res.json({ data, total: data.length, summary, runId, month: runs[0].month, year: runs[0].year });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── REPORT SCHEDULES ─────────────────────────────────────────────────────────
router.get("/report-schedules", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const rows = await db.select().from(reportSchedulesTable)
      .orderBy(desc(reportSchedulesTable.createdAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/report-schedules", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { reportType, name, frequency, recipients, filters = {}, isActive = true } = req.body;
    if (!reportType || !name || !frequency || !recipients?.length) {
      res.status(400).json({ error: "reportType, name, frequency, and recipients are required" }); return;
    }

    const [schedule] = await db.insert(reportSchedulesTable).values({
      reportType,
      name,
      frequency,
      recipients,
      filters,
      isActive,
      createdByUserId: u.id,
    }).returning();

    res.status(201).json(schedule);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/report-schedules/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reportType, name, frequency, recipients, filters, isActive } = req.body;

    const [updated] = await db.update(reportSchedulesTable).set({
      reportType,
      name,
      frequency,
      recipients,
      filters: filters ?? {},
      isActive: isActive ?? true,
      updatedAt: new Date(),
    }).where(eq(reportSchedulesTable.id, id)).returning();

    if (!updated) { res.status(404).json({ error: "Schedule not found" }); return; }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/report-schedules/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(reportSchedulesTable).where(eq(reportSchedulesTable.id, id));
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── SAVED REPORT TEMPLATES ────────────────────────────────────────────────────
router.get("/report-templates", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const rows = await db.select().from(savedReportTemplatesTable)
      .orderBy(desc(savedReportTemplatesTable.createdAt));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/report-templates", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { name, reportType, selectedFields, filters = {} } = req.body;
    if (!name || !reportType || !selectedFields?.length) {
      res.status(400).json({ error: "name, reportType, and selectedFields are required" }); return;
    }

    const [template] = await db.insert(savedReportTemplatesTable).values({
      name,
      reportType,
      selectedFields,
      filters,
      createdByUserId: u.id,
    }).returning();

    res.status(201).json(template);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/report-templates/:id", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(savedReportTemplatesTable).where(eq(savedReportTemplatesTable.id, id));
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CUSTOM REPORT RUNNER ─────────────────────────────────────────────────────
// Applies filters from the request body to the underlying employee dataset.
// Supported filters: departmentId, designationId, employmentType, status, location, isActive
router.post("/reports/custom", requireHrmsUser, requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { reportType, selectedFields, filters = {} } = req.body;
    if (!reportType || !selectedFields?.length) {
      res.status(400).json({ error: "reportType and selectedFields are required" }); return;
    }

    const VALID_REPORT_TYPES = new Set([
      "employee-directory", "attendance-summary", "leave-utilization", "headcount",
      "attrition", "performance-summary", "recruitment-pipeline",
      "permission-usage", "helpdesk-sla", "statutory-compliance",
    ]);
    if (!VALID_REPORT_TYPES.has(reportType)) {
      res.status(400).json({ error: `Unknown reportType: ${reportType}` }); return;
    }

    // Build filter conditions from the provided filters object
    const conds: ReturnType<typeof eq>[] = [eq(employeesTable.isActive, true)];
    if (filters.departmentId) conds.push(eq(employeesTable.departmentId, Number(filters.departmentId)));
    if (filters.designationId) conds.push(eq(employeesTable.designationId, Number(filters.designationId)));
    if (filters.employmentType) conds.push(eq(employeesTable.employmentType, filters.employmentType));
    if (filters.status) conds.push(eq(employeesTable.status, filters.status));
    if (filters.location) conds.push(eq(employeesTable.location, filters.location));

    const allEmployees = await db.select({
      id: employeesTable.id,
      employeeCode: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phone: employeesTable.phone,
      gender: employeesTable.gender,
      dateOfBirth: employeesTable.dateOfBirth,
      dateOfJoining: employeesTable.dateOfJoining,
      employmentType: employeesTable.employmentType,
      status: employeesTable.status,
      location: employeesTable.location,
      ctc: employeesTable.ctc,
      department: departmentsTable.name,
      designation: designationsTable.name,
    }).from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .where(and(...conds))
      .orderBy(employeesTable.firstName);

    // Validate selectedFields against available fields to prevent injection
    const availableFields = new Set(Object.keys(allEmployees[0] ?? {}));
    const fields = selectedFields.filter((f: string) => availableFields.has(f));

    const data = allEmployees.map(row => {
      const filtered: Record<string, unknown> = {};
      for (const field of fields) {
        filtered[field] = (row as Record<string, unknown>)[field];
      }
      filtered.employeeName = `${row.firstName} ${row.lastName}`;
      return filtered;
    });

    res.json({ data, total: data.length, appliedFilters: filters, reportType });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
