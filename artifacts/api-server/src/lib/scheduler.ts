import cron from "node-cron";
import nodemailer from "nodemailer";
import { db } from "./db";
import {
  reportSchedulesTable,
  employeesTable,
  hrmsUsersTable,
  departmentsTable,
  designationsTable,
  attendanceRecordsTable,
  leaveApplicationsTable,
  leaveTypesTable,
  exitRequestsTable,
  payrollRecordsTable,
  payrollRunsTable,
  helpdeskTicketsTable,
  appraisalOutcomesTable,
  jobRequisitionsTable,
  permissionApplicationsTable,
  preOnboardingRecordsTable,
  preOnboardingDocumentsTable,
  approvalChainConfigsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNotNull, ne, sql, lt, count, inArray } from "drizzle-orm";
import { generateTablePdf } from "./pdf";
import { logger } from "./logger";

// ─── SMTP transport (optional — only sends if SMTP_HOST is configured) ────────
function createTransport() {
  const host = process.env["SMTP_HOST"];
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env["SMTP_PORT"] ?? 587),
    secure: process.env["SMTP_SECURE"] === "true",
    auth: process.env["SMTP_USER"]
      ? { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] ?? "" }
      : undefined,
  });
}

// ─── Due-check helpers ────────────────────────────────────────────────────────
function isDue(frequency: string, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return true;
  const freq = frequency.toLowerCase();
  const now = Date.now();
  const last = lastRunAt.getTime();
  if (freq === "daily") return now - last >= 24 * 60 * 60 * 1000;
  if (freq === "weekly") return now - last >= 7 * 24 * 60 * 60 * 1000;
  if (freq === "monthly") {
    const n = new Date();
    const l = new Date(last);
    return n.getFullYear() > l.getFullYear() || n.getMonth() > l.getMonth();
  }
  if (freq === "quarterly") {
    const n = new Date();
    const l = new Date(last);
    const nQ = Math.floor(n.getMonth() / 3) + n.getFullYear() * 4;
    const lQ = Math.floor(l.getMonth() / 3) + l.getFullYear() * 4;
    return nQ > lQ;
  }
  return false;
}

// ─── Report data fetchers (direct DB queries) ─────────────────────────────────
async function fetchReportData(reportType: string, filters: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const deptId = filters["departmentId"] ? Number(filters["departmentId"]) : undefined;
  const fromDate = filters["fromDate"] ? String(filters["fromDate"]) : undefined;
  const toDate = filters["toDate"] ? String(filters["toDate"]) : undefined;

  try {
    switch (reportType) {
      case "employee-directory": {
        const conds = [eq(employeesTable.isActive, true)];
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeName: employeesTable.firstName,
          lastName: employeesTable.lastName,
          employeeCode: employeesTable.employeeId,
          email: employeesTable.email,
          designation: employeesTable.designationId,
          employmentType: employeesTable.employmentType,
          dateOfJoining: employeesTable.dateOfJoining,
        }).from(employeesTable).where(and(...conds));
        return rows.map((r) => ({ ...r, employeeName: `${r.employeeName} ${r.lastName}`, lastName: undefined }));
      }
      case "headcount": {
        const rows = await db.select({
          departmentName: departmentsTable.name,
          count: db.$count(employeesTable.id),
        }).from(employeesTable)
          .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
          .where(eq(employeesTable.isActive, true))
          .groupBy(departmentsTable.name);
        return rows as Record<string, unknown>[];
      }
      case "attendance-summary": {
        const conds = [];
        if (fromDate) conds.push(gte(attendanceRecordsTable.attendanceDate, fromDate));
        if (toDate) conds.push(lte(attendanceRecordsTable.attendanceDate, toDate));
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeName: employeesTable.firstName,
          attendanceDate: attendanceRecordsTable.attendanceDate,
          status: attendanceRecordsTable.status,
          signInTime: attendanceRecordsTable.signInTime,
          signOutTime: attendanceRecordsTable.signOutTime,
          totalMinutes: attendanceRecordsTable.totalMinutesWorked,
        }).from(attendanceRecordsTable)
          .leftJoin(employeesTable, eq(attendanceRecordsTable.employeeId, employeesTable.id))
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "leave-utilization": {
        const conds = [];
        if (fromDate) conds.push(gte(leaveApplicationsTable.fromDate, fromDate));
        if (toDate) conds.push(lte(leaveApplicationsTable.toDate, toDate));
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeName: employeesTable.firstName,
          leaveType: leaveTypesTable.name,
          fromDate: leaveApplicationsTable.fromDate,
          toDate: leaveApplicationsTable.toDate,
          days: leaveApplicationsTable.totalDays,
          status: leaveApplicationsTable.status,
        }).from(leaveApplicationsTable)
          .leftJoin(employeesTable, eq(leaveApplicationsTable.employeeId, employeesTable.id))
          .leftJoin(leaveTypesTable, eq(leaveApplicationsTable.leaveTypeId, leaveTypesTable.id))
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "payroll-register": {
        const month = filters["month"] ? Number(filters["month"]) : new Date().getMonth() + 1;
        const year = filters["year"] ? Number(filters["year"]) : new Date().getFullYear();
        const conds = [
          eq(payrollRunsTable.periodMonth, month),
          eq(payrollRunsTable.periodYear, year),
        ];
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeCode: employeesTable.employeeId,
          employeeName: employeesTable.firstName,
          grossPay: payrollRecordsTable.grossEarnings,
          totalDeductions: payrollRecordsTable.totalDeductions,
          netPay: payrollRecordsTable.netPay,
          month: payrollRunsTable.periodMonth,
          year: payrollRunsTable.periodYear,
        }).from(payrollRecordsTable)
          .innerJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
          .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
          .where(and(...conds))
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "attrition": {
        const conds = [isNotNull(exitRequestsTable.actualLwd)];
        if (fromDate) conds.push(gte(exitRequestsTable.actualLwd, fromDate));
        if (toDate) conds.push(lte(exitRequestsTable.actualLwd, toDate));
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeName: employeesTable.firstName,
          employeeCode: employeesTable.employeeId,
          dateOfJoining: employeesTable.dateOfJoining,
          lastWorkingDay: exitRequestsTable.actualLwd,
          exitType: exitRequestsTable.exitType,
          status: exitRequestsTable.status,
        }).from(exitRequestsTable)
          .leftJoin(employeesTable, eq(exitRequestsTable.employeeId, employeesTable.id))
          .where(and(...conds))
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "helpdesk-sla": {
        const conds = [];
        if (fromDate) conds.push(gte(helpdeskTicketsTable.createdAt, new Date(fromDate)));
        if (toDate) conds.push(lte(helpdeskTicketsTable.createdAt, new Date(toDate)));
        const rows = await db.select({
          category: helpdeskTicketsTable.category,
          priority: helpdeskTicketsTable.priority,
          status: helpdeskTicketsTable.status,
          createdAt: helpdeskTicketsTable.createdAt,
          resolvedAt: helpdeskTicketsTable.resolvedAt,
        }).from(helpdeskTicketsTable)
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "performance-summary": {
        const conds = [];
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeCode: employeesTable.employeeId,
          employeeName: employeesTable.firstName,
          department: departmentsTable.name,
          finalScore: appraisalOutcomesTable.finalScore,
          outcomeLabel: appraisalOutcomesTable.outcomLabel,
          normalizedScore: appraisalOutcomesTable.normalizedScore,
        }).from(appraisalOutcomesTable)
          .leftJoin(employeesTable, eq(appraisalOutcomesTable.employeeId, employeesTable.id))
          .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "recruitment-pipeline": {
        const conds = [];
        if (fromDate) conds.push(gte(jobRequisitionsTable.createdAt, new Date(fromDate)));
        if (toDate) conds.push(lte(jobRequisitionsTable.createdAt, new Date(toDate)));
        if (deptId) conds.push(eq(jobRequisitionsTable.departmentId, deptId));
        const rows = await db.select({
          title: jobRequisitionsTable.title,
          status: jobRequisitionsTable.status,
          numberOfPositions: jobRequisitionsTable.numberOfPositions,
          department: departmentsTable.name,
          designation: designationsTable.title,
          createdAt: jobRequisitionsTable.createdAt,
        }).from(jobRequisitionsTable)
          .leftJoin(departmentsTable, eq(jobRequisitionsTable.departmentId, departmentsTable.id))
          .leftJoin(designationsTable, eq(jobRequisitionsTable.designationId, designationsTable.id))
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "permission-usage": {
        const conds = [];
        if (fromDate) conds.push(gte(permissionApplicationsTable.permissionDate, fromDate));
        if (toDate) conds.push(lte(permissionApplicationsTable.permissionDate, toDate));
        if (deptId) conds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeCode: employeesTable.employeeId,
          employeeName: employeesTable.firstName,
          permissionDate: permissionApplicationsTable.permissionDate,
          startTime: permissionApplicationsTable.startTime,
          endTime: permissionApplicationsTable.endTime,
          durationMinutes: permissionApplicationsTable.durationMinutes,
          reason: permissionApplicationsTable.reason,
          status: permissionApplicationsTable.status,
        }).from(permissionApplicationsTable)
          .leftJoin(employeesTable, eq(permissionApplicationsTable.employeeId, employeesTable.id))
          .where(conds.length ? and(...conds) : undefined)
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      case "statutory-compliance": {
        const month = filters["month"] ? Number(filters["month"]) : new Date().getMonth() + 1;
        const year = filters["year"] ? Number(filters["year"]) : new Date().getFullYear();
        const runConds = [
          eq(payrollRunsTable.periodMonth, month),
          eq(payrollRunsTable.periodYear, year),
        ];
        const [run] = await db.select().from(payrollRunsTable).where(and(...runConds)).limit(1);
        if (!run) return [];
        const recConds = [eq(payrollRecordsTable.payrollRunId, run.id)];
        if (deptId) recConds.push(eq(employeesTable.departmentId, deptId));
        const rows = await db.select({
          employeeCode: employeesTable.employeeId,
          employeeName: employeesTable.firstName,
          grossEarnings: payrollRecordsTable.grossEarnings,
          netPay: payrollRecordsTable.netPay,
          department: departmentsTable.name,
        }).from(payrollRecordsTable)
          .leftJoin(employeesTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
          .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
          .where(and(...recConds))
          .limit(500);
        return rows as Record<string, unknown>[];
      }
      default:
        logger.info({ reportType }, "[scheduler] no direct query for this report type; sending empty report");
        return [];
    }
  } catch (err) {
    logger.error({ err, reportType }, "[scheduler] error fetching report data");
    return [];
  }
}

// ─── Build CSV from rows ──────────────────────────────────────────────────────
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "No data available.";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
  ].join("\n");
}

// ─── Send scheduled report email ─────────────────────────────────────────────
async function sendScheduledReport(
  schedule: { id: number; name: string; reportType: string; recipients: string[] },
  rows: Record<string, unknown>[],
) {
  const transport = createTransport();
  const from = process.env["SMTP_FROM"] ?? "noreply@automystics.com";
  const reportLabel = schedule.reportType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `${schedule.name} — ${reportLabel} Report`;
  const date = new Date().toLocaleDateString("en-IN");

  if (!transport) {
    logger.info({ scheduleId: schedule.id, recipients: schedule.recipients }, "[scheduler] SMTP not configured; email send skipped");
    return;
  }

  let pdfBuffer: Buffer | null = null;
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]).filter((k) => k !== undefined);
    const tableRows = rows.map((r) => headers.map((h) => r[h] as string | number | null | undefined));
    try {
      pdfBuffer = await generateTablePdf({ title, subtitle: `Generated on ${date}`, headers, rows: tableRows });
    } catch (err) {
      logger.error({ err }, "[scheduler] failed to generate PDF attachment");
    }
  }

  const htmlBody = `
    <h3>Scheduled Report: ${title}</h3>
    <p>Date: <strong>${date}</strong></p>
    <p>${rows.length} record(s) included. Attachments: CSV${pdfBuffer ? " + PDF" : ""}.</p>
    <hr>
    <p style="font-size:11px;color:#888">Automated report from MysticsHR — Automystics Technologies.</p>
  `;

  const attachments: nodemailer.SendMailOptions["attachments"] = [
    { filename: `${schedule.reportType}-report-${date}.csv`, content: toCsv(rows), contentType: "text/csv" },
  ];
  if (pdfBuffer) {
    attachments.push({ filename: `${schedule.reportType}-report-${date}.pdf`, content: pdfBuffer, contentType: "application/pdf" });
  }

  await transport.sendMail({
    from,
    to: schedule.recipients.join(", "),
    subject: `[MysticsHR] ${title} — ${date}`,
    html: htmlBody,
    attachments,
  });

  logger.info({ scheduleId: schedule.id, recipients: schedule.recipients }, "[scheduler] report email sent");
}

// ─── LWD+1 automatic access revocation ────────────────────────────────────────
async function revokeAccessForPastLwd() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    // Find FnF-Approved or Separated exit requests where LWD < today (meaning LWD+1 has passed)
    // Key off hrmsUsersTable.isActive=true — catches users whose employees.isActive was already set
    // to false by exit.ts but whose HRMS login account was not yet deactivated.
    const pending = await db.select({
      employeeId: exitRequestsTable.employeeId,
      actualLwd: exitRequestsTable.actualLwd,
      requestedLwd: exitRequestsTable.requestedLwd,
    }).from(exitRequestsTable)
      .innerJoin(employeesTable, eq(exitRequestsTable.employeeId, employeesTable.id))
      .innerJoin(hrmsUsersTable, and(
        eq(hrmsUsersTable.employeeId, employeesTable.id),
        eq(hrmsUsersTable.isActive, true),
      ))
      .where(and(
        sql`${exitRequestsTable.status} IN ('FnF Approved', 'Separated')`,
        sql`COALESCE(${exitRequestsTable.actualLwd}, ${exitRequestsTable.requestedLwd}) < ${today}`,
      ));

    for (const row of pending) {
      // Mark employee as inactive
      await db.update(employeesTable)
        .set({ status: "Separated", isActive: false, updatedAt: new Date() })
        .where(eq(employeesTable.id, row.employeeId));
      // Also deactivate linked HRMS user account to revoke system login
      await db.update(hrmsUsersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(hrmsUsersTable.employeeId, row.employeeId));
      logger.info({ employeeId: row.employeeId, lwd: row.actualLwd ?? row.requestedLwd }, "[scheduler] auto-revoked system access and HRMS login (LWD+1 passed)");
    }
  } catch (err) {
    logger.error({ err }, "[scheduler] LWD+1 access revocation failed");
  }
}

// ─── Main scheduler tick ──────────────────────────────────────────────────────
async function runSchedulerTick() {
  logger.debug("[scheduler] tick");
  await revokeAccessForPastLwd();
  let schedules: Array<{
    id: number; reportType: string; name: string; frequency: string;
    recipients: string[]; filters: unknown; lastRunAt: Date | null;
  }>;
  try {
    schedules = await db.select().from(reportSchedulesTable).where(eq(reportSchedulesTable.isActive, true));
  } catch (err) {
    logger.error({ err }, "[scheduler] failed to load schedules");
    return;
  }

  for (const sched of schedules) {
    if (!isDue(sched.frequency, sched.lastRunAt)) continue;
    logger.info({ scheduleId: sched.id, reportType: sched.reportType, frequency: sched.frequency }, "[scheduler] running due schedule");

    const filters = (sched.filters as Record<string, unknown>) ?? {};
    const rows = await fetchReportData(sched.reportType, filters);

    if (sched.recipients.length > 0) {
      try {
        await sendScheduledReport(sched, rows);
      } catch (err) {
        logger.error({ err, scheduleId: sched.id }, "[scheduler] email send failed");
      }
    } else {
      logger.info({ scheduleId: sched.id }, "[scheduler] schedule has no recipients; skipping email");
    }

    await db.update(reportSchedulesTable)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(reportSchedulesTable.id, sched.id));
  }
}

// ─── Automated notification jobs ──────────────────────────────────────────────

/** Remind HOD/HR about leave applications pending for more than 24 hours */
async function remindPendingLeaveApprovals() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await db.select({
      id: leaveApplicationsTable.id,
      employeeId: leaveApplicationsTable.employeeId,
      fromDate: leaveApplicationsTable.fromDate,
      toDate: leaveApplicationsTable.toDate,
      createdAt: leaveApplicationsTable.createdAt,
    }).from(leaveApplicationsTable)
      .where(and(
        eq(leaveApplicationsTable.status, "Pending"),
        lte(leaveApplicationsTable.createdAt, threshold),
      ));

    if (pending.length === 0) return;

    const hodUsers = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
      .from(hrmsUsersTable)
      .where(and(eq(hrmsUsersTable.isActive, true), eq(hrmsUsersTable.role, "hod")));

    for (const user of hodUsers) {
      if (!user.email) continue;
      await dispatchNotification({
        eventType: "leave_submitted", module: "leave",
        recipientEmail: user.email, recipientName: user.name,
        recipientEmployeeDbId: user.employeeId,
        variables: {
          employeeName: `${pending.length} application(s)`, fromDate: "", toDate: "",
          days: String(pending.length), leaveType: "various",
          recipientName: user.name,
        },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] remindPendingLeaveApprovals error");
  }
}

/** Escalate overdue helpdesk tickets — notifies assignee + their manager/HOD + HR */
async function escalateSlaBreaches() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const { getUsersByRoles } = await import("../routes/system-config");
    const now = new Date();
    const overdue = await db.select({
      id: helpdeskTicketsTable.id,
      subject: helpdeskTicketsTable.subject,
      slaDeadline: helpdeskTicketsTable.slaDeadline,
      assignedToUserId: helpdeskTicketsTable.assignedToUserId,
    }).from(helpdeskTicketsTable)
      .where(and(
        ne(helpdeskTicketsTable.status, "Closed"),
        isNotNull(helpdeskTicketsTable.slaDeadline),
        lte(helpdeskTicketsTable.slaDeadline, now),
      ));

    if (overdue.length === 0) return;

    // Get HR managers for escalation
    const hrManagers = await getUsersByRoles(["super_admin", "hr_manager", "hr_executive"]);

    for (const ticket of overdue) {
      const slaLabel = ticket.slaDeadline ? new Date(ticket.slaDeadline).toLocaleString("en-IN") : "";
      const vars = { ticketId: String(ticket.id), subject: ticket.subject, slaDeadline: slaLabel };

      // 1. Notify the assigned user
      if (ticket.assignedToUserId) {
        const [assignee] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name, employeeId: hrmsUsersTable.employeeId })
          .from(hrmsUsersTable).where(eq(hrmsUsersTable.id, ticket.assignedToUserId));
        if (assignee?.email) {
          await dispatchNotification({
            eventType: "helpdesk_sla_breach", module: "helpdesk",
            recipientEmail: assignee.email, recipientName: assignee.name,
            recipientEmployeeDbId: assignee.employeeId,
            variables: { ...vars, recipientName: assignee.name },
            entityType: "helpdesk_ticket", entityId: ticket.id,
          }).catch(() => {});
        }
        // 2. Notify the assignee's HOD/manager
        if (assignee?.employeeId) {
          const [assigneeEmp] = await db.select({ departmentId: employeesTable.departmentId })
            .from(employeesTable).where(eq(employeesTable.id, assignee.employeeId));
          if (assigneeEmp?.departmentId) {
            const hodUsers = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
              .from(hrmsUsersTable)
              .leftJoin(employeesTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
              .where(and(
                eq(hrmsUsersTable.role, "hod"),
                eq(employeesTable.departmentId, assigneeEmp.departmentId),
                eq(hrmsUsersTable.isActive, true),
              ));
            for (const hod of hodUsers) {
              if (hod.email) {
                await dispatchNotification({
                  eventType: "helpdesk_sla_breach", module: "helpdesk",
                  recipientEmail: hod.email, recipientName: hod.name,
                  variables: { ...vars, recipientName: hod.name },
                  entityType: "helpdesk_ticket", entityId: ticket.id,
                }).catch(() => {});
              }
            }
          }
        }
      }
      // 3. Notify HR managers
      for (const hr of hrManagers) {
        await dispatchNotification({
          eventType: "helpdesk_sla_breach", module: "helpdesk",
          recipientEmail: hr.email, recipientName: hr.name,
          variables: { ...vars, recipientName: hr.name },
          entityType: "helpdesk_ticket", entityId: ticket.id,
        }).catch(() => {});
      }
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] escalateSlaBreaches error");
  }
}

/**
 * Config-driven escalation processor — reads approval_chain_configs and escalates
 * pending transactions of each transactionType that have exceeded escalationAfterHours.
 * Supported transactionTypes: "leave", "helpdesk", "exit", "payroll"
 */
async function processConfiguredEscalations() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const { getUsersByRoles } = await import("../routes/system-config");

    const escalationConfigs = await db.select()
      .from(approvalChainConfigsTable)
      .where(and(
        eq(approvalChainConfigsTable.isActive, true),
        isNotNull(approvalChainConfigsTable.escalationAfterHours),
        isNotNull(approvalChainConfigsTable.escalateTo),
      ));

    for (const config of escalationConfigs) {
      const hours = config.escalationAfterHours ?? 24;
      const threshold = new Date(Date.now() - hours * 60 * 60 * 1000);
      const escalateTo = config.escalateTo;
      if (!escalateTo) continue;

      const recipientUsers = await getUsersByRoles([escalateTo]);
      if (recipientUsers.length === 0) continue;

      if (config.transactionType === "leave") {
        const pending = await db.select({ id: leaveApplicationsTable.id })
          .from(leaveApplicationsTable)
          .where(and(
            eq(leaveApplicationsTable.status, "Pending"),
            lte(leaveApplicationsTable.createdAt, threshold),
          ));
        if (pending.length === 0) continue;

        for (const user of recipientUsers) {
          if (!user.email) continue;
          await dispatchNotification({
            eventType: "leave_submitted", module: "leave",
            recipientEmail: user.email, recipientName: user.name,
            recipientEmployeeDbId: user.employeeId,
            variables: {
              employeeName: `${pending.length} application(s)`,
              fromDate: "", toDate: "", days: String(pending.length),
              leaveType: "various", recipientName: user.name,
            },
          }).catch(() => {});
        }
      }

      if (config.transactionType === "helpdesk") {
        const overdue = await db.select({ id: helpdeskTicketsTable.id, subject: helpdeskTicketsTable.subject })
          .from(helpdeskTicketsTable)
          .where(and(
            ne(helpdeskTicketsTable.status, "Closed"),
            ne(helpdeskTicketsTable.status, "Resolved"),
            lte(helpdeskTicketsTable.createdAt, threshold),
          ));
        if (overdue.length === 0) continue;

        for (const user of recipientUsers) {
          if (!user.email) continue;
          await dispatchNotification({
            eventType: "helpdesk_sla_breach", module: "helpdesk",
            recipientEmail: user.email, recipientName: user.name,
            recipientEmployeeDbId: user.employeeId,
            variables: {
              ticketId: overdue.map(t => String(t.id)).join(", "),
              subject: `${overdue.length} ticket(s) past SLA (${hours}h)`,
              slaDeadline: threshold.toISOString(), recipientName: user.name,
            },
            entityType: "helpdesk_ticket", entityId: overdue[0]?.id,
          }).catch(() => {});
        }
      }

      if (config.transactionType === "exit") {
        // Valid terminal statuses (exit_status enum): Separated, Rejected, Withdrawn, FnF Approved
        const stalled = await db.select({ id: exitRequestsTable.id })
          .from(exitRequestsTable)
          .where(and(
            inArray(exitRequestsTable.status, ["Submitted", "HR Reviewing", "Notice Period", "Clearance Pending", "FnF Pending"]),
            lte(exitRequestsTable.updatedAt, threshold),
          ));
        if (stalled.length === 0) continue;

        for (const user of recipientUsers) {
          if (!user.email) continue;
          await dispatchNotification({
            eventType: "exit_initiated", module: "exit",
            recipientEmail: user.email, recipientName: user.name,
            recipientEmployeeDbId: user.employeeId,
            variables: {
              status: `${stalled.length} exit(s) pending >SLA (${hours}h)`,
              recipientName: user.name,
            },
          }).catch(() => {});
        }
      }

      if (config.transactionType === "payroll") {
        // Payroll runs awaiting finalization (Computed or Approved but not yet Locked)
        const pendingRuns = await db.select({ id: payrollRunsTable.id, periodMonth: payrollRunsTable.periodMonth, periodYear: payrollRunsTable.periodYear })
          .from(payrollRunsTable)
          .where(and(
            inArray(payrollRunsTable.status, ["Computed", "Approved"]),
            lte(payrollRunsTable.updatedAt, threshold),
          ));
        if (pendingRuns.length === 0) continue;

        for (const user of recipientUsers) {
          if (!user.email) continue;
          const periodStr = pendingRuns.map(r => `${r.periodMonth}/${r.periodYear}`).join(", ");
          await dispatchNotification({
            eventType: "payroll_locked", module: "payroll",
            recipientEmail: user.email, recipientName: user.name,
            recipientEmployeeDbId: user.employeeId,
            variables: {
              period: periodStr,
              month: String(pendingRuns[0]?.periodMonth ?? ""),
              year: String(pendingRuns[0]?.periodYear ?? ""),
              recipientName: user.name,
            },
          }).catch(() => {});
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] processConfiguredEscalations error");
  }
}

/** Alert employees who have no sign-out record for today (run after EOD) */
async function alertNoSignOut() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const today = new Date().toISOString().slice(0, 10);
    // Get all records with sign-in but no sign-out
    const noSignOut = await db.select({
      employeeId: attendanceRecordsTable.employeeId,
    }).from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.attendanceDate, today),
        isNotNull(attendanceRecordsTable.signInTime),
        sql`${attendanceRecordsTable.signOutTime} IS NULL`,
      ));

    for (const record of noSignOut) {
      const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
        .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, record.employeeId)).limit(1);
      if (!empUser?.email) continue;
      await dispatchNotification({
        eventType: "no_sign_out", module: "attendance",
        recipientEmail: empUser.email, recipientName: empUser.name ?? "",
        recipientEmployeeDbId: record.employeeId,
        variables: { recipientName: empUser.name ?? "" },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertNoSignOut error");
  }
}

/** Overtime threshold alert — notify employees whose overtime minutes exceeded threshold today */
async function alertOvertimeThreshold() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const OVERTIME_THRESHOLD_MINUTES = 9 * 60; // 9 hours working = overtime
    const today = new Date().toISOString().slice(0, 10);
    const overtimeEmployees = await db.select({
      employeeId: attendanceRecordsTable.employeeId,
      totalMinutesWorked: attendanceRecordsTable.totalMinutesWorked,
    }).from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.attendanceDate, today),
        isNotNull(attendanceRecordsTable.totalMinutesWorked),
        gte(attendanceRecordsTable.totalMinutesWorked, OVERTIME_THRESHOLD_MINUTES),
      ));

    for (const record of overtimeEmployees) {
      const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
        .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, record.employeeId)).limit(1);
      if (!empUser?.email) continue;
      await dispatchNotification({
        eventType: "overtime_alert", module: "attendance",
        recipientEmail: empUser.email, recipientName: empUser.name ?? "",
        recipientEmployeeDbId: record.employeeId,
        variables: { recipientName: empUser.name ?? "", hours: String(Math.floor((record.totalMinutesWorked ?? 0) / 60)) },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertOvertimeThreshold error");
  }
}

/** Consecutive absence alert — find employees absent 2+ consecutive days */
async function alertConsecutiveAbsences() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    // Check last 3 days for consecutive absences
    const today = new Date();
    const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const activeEmployees = await db.select({
      id: employeesTable.id,
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
    }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(and(eq(employeesTable.isActive, true), isNotNull(hrmsUsersTable.email)));

    const recentRecords = await db.select({
      employeeId: attendanceRecordsTable.employeeId,
      attendanceDate: attendanceRecordsTable.attendanceDate,
    }).from(attendanceRecordsTable)
      .where(and(
        gte(attendanceRecordsTable.attendanceDate, threeDaysAgo),
        lte(attendanceRecordsTable.attendanceDate, todayStr),
      ));

    const presentMap = new Map<number, Set<string>>();
    for (const r of recentRecords) {
      if (!presentMap.has(r.employeeId)) presentMap.set(r.employeeId, new Set());
      presentMap.get(r.employeeId)!.add(String(r.attendanceDate));
    }

    for (const emp of activeEmployees) {
      if (!emp.email) continue;
      const days = presentMap.get(emp.id) ?? new Set<string>();
      // Count consecutive absences (no record = absent)
      let absent = 0;
      for (let i = 1; i <= 3; i++) {
        const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (!days.has(d)) absent++;
      }
      if (absent >= 2) {
        await dispatchNotification({
          eventType: "consecutive_absence", module: "attendance",
          recipientEmail: emp.email, recipientName: emp.name ?? "",
          recipientEmployeeDbId: emp.id,
          variables: { days: String(absent), recipientName: emp.name ?? "" },
        }).catch(() => {});
      }
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertConsecutiveAbsences error");
  }
}

/** Pre-onboarding pending document reminders — notify candidates who have actual pending documents */
async function remindPreOnboardingPending() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const { candidatesTable } = await import("@workspace/db/schema");

    // Step 1: Find pre-onboarding records with status In Progress or Pending and a joining date
    const candidateRecords = await db.select({
      id: preOnboardingRecordsTable.id,
      candidateId: preOnboardingRecordsTable.candidateId,
      expectedJoiningDate: preOnboardingRecordsTable.expectedJoiningDate,
    }).from(preOnboardingRecordsTable)
      .where(and(
        inArray(preOnboardingRecordsTable.status, ["Pending", "In Progress"]),
        isNotNull(preOnboardingRecordsTable.expectedJoiningDate),
      ));

    if (candidateRecords.length === 0) return;

    // Step 2: Among those records, find which ones actually have at least one document with status "Pending"
    const recordIdsWithPendingDocs = await db
      .selectDistinct({ recordId: preOnboardingDocumentsTable.recordId })
      .from(preOnboardingDocumentsTable)
      .where(and(
        eq(preOnboardingDocumentsTable.status, "Pending"),
        inArray(preOnboardingDocumentsTable.recordId, candidateRecords.map(r => r.id)),
      ));

    const pendingDocRecordIds = new Set(recordIdsWithPendingDocs.map(r => r.recordId));

    // Step 3: Only notify candidates whose record has pending documents
    for (const record of candidateRecords) {
      if (!pendingDocRecordIds.has(record.id)) continue;

      const [candidate] = await db.select({ email: candidatesTable.email, firstName: candidatesTable.firstName, lastName: candidatesTable.lastName, phone: candidatesTable.phone })
        .from(candidatesTable).where(eq(candidatesTable.id, record.candidateId)).limit(1);
      if (!candidate?.email) continue;

      const joiningDate = record.expectedJoiningDate ? String(record.expectedJoiningDate) : "";
      await dispatchNotification({
        eventType: "onboarding_doc_pending", module: "pre_onboarding",
        recipientEmail: candidate.email, recipientName: `${candidate.firstName} ${candidate.lastName}`,
        recipientCandidateId: record.candidateId,
        variables: { joiningDate, recipientName: `${candidate.firstName} ${candidate.lastName}` },
        entityType: "pre_onboarding_record", entityId: record.id,
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] remindPreOnboardingPending error");
  }
}

/** Alert employees who have no attendance record for today */
async function alertAttendanceAnomalies() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();

    // Only run end-of-day check (after 18:00)
    if (hour < 18) return;

    const allActive = await db.select({
      id: employeesTable.id,
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
    }).from(employeesTable)
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(employeesTable.isActive, true));

    const todayRecords = await db.select({ employeeId: attendanceRecordsTable.employeeId })
      .from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.attendanceDate, today));

    const presentIds = new Set(todayRecords.map(r => r.employeeId));

    for (const emp of allActive) {
      if (!emp.email || presentIds.has(emp.id)) continue;
      await dispatchNotification({
        eventType: "no_sign_in", module: "attendance",
        recipientEmail: emp.email, recipientName: emp.name ?? "",
        recipientEmployeeDbId: emp.id,
        variables: { recipientName: emp.name ?? "" },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertAttendanceAnomalies error");
  }
}

// ─── Start scheduler ──────────────────────────────────────────────────────────
export function startScheduler(_port: number) {
  // Run every hour at minute 0 — scheduled report delivery
  cron.schedule("0 * * * *", () => {
    void runSchedulerTick();
  });
  // Every 4 hours — remind HOD/HR about pending leave approvals (>24h old)
  cron.schedule("0 */4 * * *", () => {
    void remindPendingLeaveApprovals();
  });
  // Every hour — escalate SLA breaches for overdue helpdesk tickets
  cron.schedule("30 * * * *", () => {
    void escalateSlaBreaches();
  });
  // Every 2 hours — run config-driven escalation processor (reads approval_chain_configs)
  cron.schedule("45 */2 * * *", () => {
    void processConfiguredEscalations();
  });
  // At 18:30 daily — alert employees with no attendance record today
  cron.schedule("30 18 * * *", () => {
    void alertAttendanceAnomalies();
  });
  // At 19:00 daily — alert employees who signed in but didn't sign out
  cron.schedule("0 19 * * *", () => {
    void alertNoSignOut();
  });
  // At 19:30 daily — alert employees who exceeded overtime threshold
  cron.schedule("30 19 * * *", () => {
    void alertOvertimeThreshold();
  });
  // At 09:00 daily — check for consecutive absences (2+ days)
  cron.schedule("0 9 * * *", () => {
    void alertConsecutiveAbsences();
  });
  // At 10:00 daily — remind candidates with pending pre-onboarding documents
  cron.schedule("0 10 * * *", () => {
    void remindPreOnboardingPending();
  });
  // Run once 5s after startup to catch any overdue schedules
  setTimeout(() => void runSchedulerTick(), 5_000);
  logger.info("[scheduler] started — runs every hour at :00 + notification jobs");
}
