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
  exitClearanceTasksTable,
  payrollRecordsTable,
  payrollRunsTable,
  helpdeskTicketsTable,
  appraisalOutcomesTable,
  jobRequisitionsTable,
  permissionApplicationsTable,
  preOnboardingRecordsTable,
  preOnboardingDocumentsTable,
  approvalChainConfigsTable,
  shiftTemplatesTable,
  shiftAssignmentsTable,
  notificationLogsTable,
  systemSettingsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNotNull, ne, sql, lt, count, inArray } from "drizzle-orm";
import { generateTablePdf } from "./pdf";
import { logger } from "./logger";
import { runYearEndCarryForwardJob, maybeRunYearEndCarryForwardCatchUp } from "./carry-forward";
import { cleanupOrphanedAttachments } from "./orphan-attachment-cleanup";

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

// ─── Shift-aware attendance helper ───────────────────────────────────────────

/**
 * Parse an "HH:mm" shift time string into a Date for the given date string (YYYY-MM-DD).
 * Returns null if the string cannot be parsed.
 */
function parseShiftTimeForDate(hhMm: string, dateStr: string): Date | null {
  const parts = hhMm.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Build a set of "eventType_email" keys for notifications already sent today.
 * Used to prevent duplicate notifications per employee per event per day.
 */
async function buildTodayNotifiedSet(todayStart: Date, events: string[]): Promise<Set<string>> {
  const logs = await db.select({ eventType: notificationLogsTable.eventType, recipientEmail: notificationLogsTable.recipientEmail })
    .from(notificationLogsTable)
    .where(and(
      gte(notificationLogsTable.sentAt, todayStart),
      inArray(notificationLogsTable.eventType, events),
    ));
  return new Set(logs.map(l => `${l.eventType}_${l.recipientEmail}`));
}

/**
 * Shift-aware no-sign-in alert:
 * Notifies each employee 30 minutes after their personal shift start time if they
 * have no attendance record for today. Idempotent — sends at most once per day.
 */
async function alertShiftAwareNoSignIn() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${today}T00:00:00`);
    const TRIGGER_OFFSET_MINUTES = 30;

    // Pre-load today's notification set to avoid duplicate sends
    const alreadyNotified = await buildTodayNotifiedSet(todayStart, ["no_sign_in"]);

    // Get all active employees with their current shift assignment
    const empShifts = await db.select({
      employeeId: employeesTable.id,
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
      startTime: shiftTemplatesTable.startTime,
    }).from(employeesTable)
      .innerJoin(shiftAssignmentsTable, and(
        eq(shiftAssignmentsTable.employeeId, employeesTable.id),
        lte(shiftAssignmentsTable.effectiveFrom, today),
        sql`(${shiftAssignmentsTable.effectiveTo} IS NULL OR ${shiftAssignmentsTable.effectiveTo} >= ${today})`,
      ))
      .innerJoin(shiftTemplatesTable, eq(shiftTemplatesTable.id, shiftAssignmentsTable.shiftTemplateId))
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(employeesTable.isActive, true));

    // Get all attendance records for today (signed-in employees)
    const todayAttendance = await db.select({ employeeId: attendanceRecordsTable.employeeId })
      .from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.attendanceDate, today));
    const signedInToday = new Set(todayAttendance.map(r => r.employeeId));

    for (const emp of empShifts) {
      if (!emp.email || signedInToday.has(emp.employeeId)) continue;
      if (alreadyNotified.has(`no_sign_in_${emp.email}`)) continue;

      // Parse shift start time and add trigger offset
      const shiftStart = parseShiftTimeForDate(emp.startTime, today);
      if (!shiftStart) continue;
      const triggerTime = new Date(shiftStart.getTime() + TRIGGER_OFFSET_MINUTES * 60 * 1000);

      // Only send if current time has passed the trigger point
      if (now < triggerTime) continue;

      await dispatchNotification({
        eventType: "no_sign_in", module: "attendance",
        recipientEmail: emp.email, recipientName: emp.name ?? "",
        recipientEmployeeDbId: emp.employeeId,
        variables: {
          recipientName: emp.name ?? "",
          shiftStart: emp.startTime,
        },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertShiftAwareNoSignIn error");
  }
}

/**
 * Shift-aware no-sign-out alert:
 * Notifies each employee 30 minutes after their personal shift end time if they
 * signed in but haven't signed out. Idempotent — sends at most once per day.
 */
async function alertShiftAwareNoSignOut() {
  try {
    const { dispatchNotification } = await import("../lib/notification-service");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${today}T00:00:00`);
    const TRIGGER_OFFSET_MINUTES = 30;

    const alreadyNotified = await buildTodayNotifiedSet(todayStart, ["no_sign_out"]);

    const empShifts = await db.select({
      employeeId: employeesTable.id,
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
      endTime: shiftTemplatesTable.endTime,
    }).from(employeesTable)
      .innerJoin(shiftAssignmentsTable, and(
        eq(shiftAssignmentsTable.employeeId, employeesTable.id),
        lte(shiftAssignmentsTable.effectiveFrom, today),
        sql`(${shiftAssignmentsTable.effectiveTo} IS NULL OR ${shiftAssignmentsTable.effectiveTo} >= ${today})`,
      ))
      .innerJoin(shiftTemplatesTable, eq(shiftTemplatesTable.id, shiftAssignmentsTable.shiftTemplateId))
      .leftJoin(hrmsUsersTable, eq(hrmsUsersTable.employeeId, employeesTable.id))
      .where(eq(employeesTable.isActive, true));

    // Get employees who signed in but haven't signed out
    const noSignOut = await db.select({ employeeId: attendanceRecordsTable.employeeId })
      .from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.attendanceDate, today),
        isNotNull(attendanceRecordsTable.signInTime),
        sql`${attendanceRecordsTable.signOutTime} IS NULL`,
      ));
    const missingSignOut = new Set(noSignOut.map(r => r.employeeId));

    for (const emp of empShifts) {
      if (!emp.email || !missingSignOut.has(emp.employeeId)) continue;
      if (alreadyNotified.has(`no_sign_out_${emp.email}`)) continue;

      const shiftEnd = parseShiftTimeForDate(emp.endTime, today);
      if (!shiftEnd) continue;
      const triggerTime = new Date(shiftEnd.getTime() + TRIGGER_OFFSET_MINUTES * 60 * 1000);

      if (now < triggerTime) continue;

      await dispatchNotification({
        eventType: "no_sign_out", module: "attendance",
        recipientEmail: emp.email, recipientName: emp.name ?? "",
        recipientEmployeeDbId: emp.employeeId,
        variables: {
          recipientName: emp.name ?? "",
          shiftEnd: emp.endTime,
        },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduler] alertShiftAwareNoSignOut error");
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

// alertAttendanceAnomalies removed — superseded by alertShiftAwareNoSignIn below

/**
 * Re-notify payroll admins about payroll runs in `Computed` status that have
 * sat unapproved beyond the configured threshold (default 24h). Re-uses the
 * existing `payroll_run_pending_approval` event so admins get a familiar
 * email/in-app nudge with the run link.
 *
 * Threshold is read from `system_settings` row
 *   { category: "payroll", key: "approval_reminder_hours" }
 * with value `{ hours: <number> }` (or a bare number). Falls back to 24h.
 *
 * To avoid spamming, we only re-send if no `payroll_run_pending_approval`
 * notification has been logged for that run+recipient in the last `hours`.
 */
async function remindPendingPayrollApprovals() {
  try {
    // Resolve threshold (hours)
    let thresholdHours = 24;
    try {
      const [setting] = await db.select().from(systemSettingsTable)
        .where(and(eq(systemSettingsTable.category, "payroll"), eq(systemSettingsTable.key, "approval_reminder_hours")))
        .limit(1);
      const raw = setting?.value as unknown;
      if (typeof raw === "number" && raw > 0) thresholdHours = raw;
      else if (raw && typeof raw === "object" && typeof (raw as { hours?: unknown }).hours === "number" && (raw as { hours: number }).hours > 0) {
        thresholdHours = (raw as { hours: number }).hours;
      }
    } catch { /* fall through with default */ }

    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const stuckRuns = await db.select({
      id: payrollRunsTable.id,
      periodMonth: payrollRunsTable.periodMonth,
      periodYear: payrollRunsTable.periodYear,
      totalEmployees: payrollRunsTable.totalEmployees,
      totalGross: payrollRunsTable.totalGross,
      totalNet: payrollRunsTable.totalNet,
      runAt: payrollRunsTable.runAt,
      updatedAt: payrollRunsTable.updatedAt,
    })
      .from(payrollRunsTable)
      .where(and(
        eq(payrollRunsTable.status, "Computed"),
        lte(payrollRunsTable.updatedAt, cutoff),
      ));

    if (stuckRuns.length === 0) return;

    const approvers = await db.select({
      id: hrmsUsersTable.id,
      email: hrmsUsersTable.email,
      name: hrmsUsersTable.name,
    })
      .from(hrmsUsersTable)
      .where(and(
        inArray(hrmsUsersTable.role, ["super_admin", "payroll_admin"]),
        eq(hrmsUsersTable.isActive, true),
      ));

    if (approvers.length === 0) return;

    // Lookup recently-sent payroll_run_pending_approval logs to suppress duplicates.
    // Only successful sends count — a failed delivery should NOT block a retry nudge.
    const recentLogs = await db.select({
      recipientEmail: notificationLogsTable.recipientEmail,
      entityId: notificationLogsTable.entityId,
    })
      .from(notificationLogsTable)
      .where(and(
        eq(notificationLogsTable.eventType, "payroll_run_pending_approval"),
        eq(notificationLogsTable.status, "sent"),
        eq(notificationLogsTable.entityType, "payroll_run"),
        gte(notificationLogsTable.sentAt, cutoff),
      ));
    const sentSet = new Set(recentLogs.map(l => `${l.entityId}__${l.recipientEmail}`));

    const { dispatchNotification } = await import("./notification-service");
    const baseUrl = (process.env.APP_URL ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")).replace(/\/$/, "");
    const buildAppUrl = (path: string) => baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;
    const fmtINR = (s: string | number | null) => `₹${Number(s ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

    for (const run of stuckRuns) {
      const monthName = new Date(run.periodYear, run.periodMonth - 1).toLocaleString("en-IN", { month: "long" });
      const period = `${monthName} ${run.periodYear}`;
      const runUrl = buildAppUrl(`/payroll/runs/${run.id}`);
      const ageHours = Math.floor((Date.now() - new Date(run.updatedAt).getTime()) / (60 * 60 * 1000));

      for (const a of approvers) {
        if (!a.email) continue;
        if (sentSet.has(`${run.id}__${a.email}`)) continue; // already nudged within window

        await dispatchNotification({
          eventType: "payroll_run_pending_approval", module: "payroll",
          recipientEmail: a.email, recipientName: a.name,
          variables: {
            recipientName: a.name ?? "",
            period,
            initiatorName: `Reminder — pending for ${ageHours}h`,
            totalEmployees: String(run.totalEmployees ?? ""),
            totalGross: fmtINR(run.totalGross),
            totalNet: fmtINR(run.totalNet),
            runUrl,
          },
          entityType: "payroll_run", entityId: run.id,
        }).catch((e) => logger.warn({ err: e, runId: run.id, to: a.email }, "[scheduler] payroll reminder dispatch failed"));
      }
    }

    logger.info({ runs: stuckRuns.length, approvers: approvers.length, thresholdHours }, "[scheduler] remindPendingPayrollApprovals processed stuck runs");
  } catch (e) {
    logger.error({ err: e }, "[scheduler] remindPendingPayrollApprovals error");
  }
}

/**
 * Daily WhatsApp nudge for overdue exit clearance tasks.
 *
 * Selects exit_clearance_tasks where:
 *   - dueDate < today (past due)
 *   - status NOT IN (Completed, Waived)
 *   - assignedToUserId IS NOT NULL (need a recipient)
 *
 * For each task, sends the assignee a WhatsApp message with the employee
 * name, task name, days overdue, due date, and a deep link to the exit
 * request. Suppression: skips any (task, assignee phone) pair that already
 * received an `exit_clearance_task_overdue` notification today (any status,
 * so failed sends don't get retried within the day either — daily cron
 * cadence is the retry mechanism).
 *
 * WhatsApp gating is delegated to the dispatcher / sendWhatsApp, which
 * checks the system_settings whatsapp credentials and logs a "failed" row
 * with errorMessage="WhatsApp not configured" when missing. Channels are
 * pinned to ["whatsapp"] so this is a WhatsApp-only nudge.
 */
async function remindOverdueExitClearanceTasks() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(`${today}T00:00:00`);

    const overdueTasks = await db.select({
      id: exitClearanceTasksTable.id,
      exitRequestId: exitClearanceTasksTable.exitRequestId,
      taskName: exitClearanceTasksTable.taskName,
      department: exitClearanceTasksTable.department,
      dueDate: exitClearanceTasksTable.dueDate,
      assignedToUserId: exitClearanceTasksTable.assignedToUserId,
      assigneeEmail: hrmsUsersTable.email,
      assigneeName: hrmsUsersTable.name,
      assigneeEmployeeId: hrmsUsersTable.employeeId,
      employeeId: exitRequestsTable.employeeId,
      employeeFirstName: employeesTable.firstName,
      employeeLastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
    }).from(exitClearanceTasksTable)
      .innerJoin(exitRequestsTable, eq(exitClearanceTasksTable.exitRequestId, exitRequestsTable.id))
      .innerJoin(employeesTable, eq(exitRequestsTable.employeeId, employeesTable.id))
      .innerJoin(hrmsUsersTable, eq(exitClearanceTasksTable.assignedToUserId, hrmsUsersTable.id))
      .where(and(
        isNotNull(exitClearanceTasksTable.dueDate),
        lt(exitClearanceTasksTable.dueDate, today),
        sql`${exitClearanceTasksTable.status} NOT IN ('Completed', 'Waived')`,
        eq(hrmsUsersTable.isActive, true),
      ));

    if (overdueTasks.length === 0) return;

    // Pre-load today's overdue notification logs to suppress repeat sends
    // for the same task. Key by `${entityId}__${recipientPhone||recipientEmail}`.
    const todaysLogs = await db.select({
      entityId: notificationLogsTable.entityId,
      recipientPhone: notificationLogsTable.recipientPhone,
      recipientEmail: notificationLogsTable.recipientEmail,
    }).from(notificationLogsTable)
      .where(and(
        eq(notificationLogsTable.eventType, "exit_clearance_task_overdue"),
        eq(notificationLogsTable.entityType, "exit_clearance_task"),
        eq(notificationLogsTable.channel, "whatsapp"),
        gte(notificationLogsTable.sentAt, todayStart),
      ));
    const sentSet = new Set(todaysLogs.map(l => `${l.entityId}__${l.recipientPhone ?? l.recipientEmail ?? ""}`));

    const { dispatchNotification } = await import("./notification-service");
    const baseUrl = (process.env["APP_URL"] ?? (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "")).replace(/\/$/, "");
    const buildAppUrl = (path: string) => baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;

    let processed = 0;
    for (const t of overdueTasks) {
      // Resolve assignee phone (used for both dispatch and suppression key)
      const assigneePhone = await resolveAssigneePhone(t.assigneeEmployeeId);
      const suppressionKey = `${t.id}__${assigneePhone ?? t.assigneeEmail ?? ""}`;
      if (sentSet.has(suppressionKey)) continue;

      const dueDateStr = String(t.dueDate);
      const daysOverdue = Math.max(1, Math.floor(
        (new Date(`${today}T00:00:00`).getTime() - new Date(`${dueDateStr}T00:00:00`).getTime()) / (24 * 60 * 60 * 1000),
      ));
      const employeeName = `${t.employeeFirstName ?? ""} ${t.employeeLastName ?? ""}`.trim();
      const actionUrl = buildAppUrl(`/exit/requests/${t.exitRequestId}`);

      await dispatchNotification({
        eventType: "exit_clearance_task_overdue",
        module: "exit",
        recipientEmail: t.assigneeEmail ?? undefined,
        recipientName: t.assigneeName ?? undefined,
        recipientEmployeeDbId: t.assigneeEmployeeId,
        recipientPhone: assigneePhone,
        variables: {
          recipientName: t.assigneeName ?? "",
          employeeName: employeeName || "an employee",
          employeeId: t.employeeCode ?? "",
          taskName: t.taskName,
          department: t.department,
          dueDate: dueDateStr,
          daysOverdue: String(daysOverdue),
          actionUrl,
        },
        entityType: "exit_clearance_task",
        entityId: t.id,
        channels: ["whatsapp"],
      }).catch((err) => logger.warn({ err, taskId: t.id }, "[scheduler] exit_clearance_task_overdue dispatch failed"));
      processed++;

      // Mark as processed in the in-memory set so we don't re-dispatch within this tick
      sentSet.add(suppressionKey);
    }

    logger.info({ overdue: overdueTasks.length, processed }, "[scheduler] remindOverdueExitClearanceTasks completed");
  } catch (e) {
    logger.error({ err: e }, "[scheduler] remindOverdueExitClearanceTasks error");
  }
}

/** Resolve an HRMS user's phone via their linked employee record. */
async function resolveAssigneePhone(employeeId: number | null | undefined): Promise<string | undefined> {
  if (!employeeId) return undefined;
  const [row] = await db.select({ phone: employeesTable.phone })
    .from(employeesTable).where(eq(employeesTable.id, employeeId)).limit(1);
  return row?.phone ?? undefined;
}

/**
 * Annual Form 16 dispatch — runs in early April. For every active employee
 * who had at least one payroll record in the just-finished financial year
 * (April `year` → March `year+1`), email a link to download their Form 16 PDF.
 *
 * Compliance/mandatory: bypasses per-employee opt-out preferences so every
 * eligible employee receives the email.
 *
 * Idempotency is employee+channel based: each notification log is written
 * with `entityType = "form_16_fy_<year>"` and `entityId = employeeId`, and
 * dedup considers only `channel='email'` rows with `status='sent'`. A failed
 * email or a WhatsApp-only success will NOT block a future email retry.
 */
export async function dispatchForm16ForFy(
  year: number,
  options: { force?: boolean; employeeIds?: number[]; throwOnError?: boolean } = {},
): Promise<{ eligible: number; sent: number; skipped: number }> {
  const fyLabel = `${year}-${String(year + 1).slice(2)}`;
  const entityTypeKey = `form_16_fy_${year}`;
  const force = options.force === true;
  const throwOnError = options.throwOnError === true;
  const employeeIdFilter = options.employeeIds && options.employeeIds.length > 0
    ? options.employeeIds
    : null;
  try {
    // Active employees who actually had payroll records in this FY.
    const recipientConds = [
      eq(employeesTable.isActive, true),
      sql`(${payrollRunsTable.periodYear} = ${year} AND ${payrollRunsTable.periodMonth} >= 4)
          OR (${payrollRunsTable.periodYear} = ${year + 1} AND ${payrollRunsTable.periodMonth} <= 3)`,
    ];
    if (employeeIdFilter) recipientConds.push(inArray(employeesTable.id, employeeIdFilter));
    const recipients = await db.selectDistinctOn([employeesTable.id], {
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
    })
      .from(employeesTable)
      .innerJoin(payrollRecordsTable, eq(payrollRecordsTable.employeeId, employeesTable.id))
      .innerJoin(payrollRunsTable, eq(payrollRecordsTable.payrollRunId, payrollRunsTable.id))
      .where(and(...recipientConds));

    if (recipients.length === 0) {
      logger.info({ fy: fyLabel, force, employeeIdFilter }, "[scheduler] dispatchForm16ForFy — no eligible employees");
      return { eligible: 0, sent: 0, skipped: 0 };
    }

    // Employee+email-channel idempotency: skip only employees whose email was
    // already successfully sent for this FY. Failed emails or WhatsApp-only
    // sends will not block a retry. Keyed on entityId (= employeeId) under
    // entityType=`form_16_fy_<year>`. When `force` is set (manual HR re-send),
    // the dedup check is bypassed entirely — the new send will append a fresh
    // notification_logs row alongside the original.
    const alreadySent = new Set<number>();
    if (!force) {
      const sentLogs = await db.select({ entityId: notificationLogsTable.entityId })
        .from(notificationLogsTable)
        .where(and(
          eq(notificationLogsTable.eventType, "form_16_available"),
          eq(notificationLogsTable.entityType, entityTypeKey),
          eq(notificationLogsTable.channel, "email"),
          eq(notificationLogsTable.status, "sent"),
        ));
      for (const l of sentLogs) if (l.entityId != null) alreadySent.add(l.entityId);
    }

    const { dispatchNotification } = await import("./notification-service");
    const baseUrl = (process.env.APP_URL ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")).replace(/\/$/, "");
    const buildAppUrl = (path: string) => baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;

    let sent = 0; let skipped = 0;
    for (const e of recipients) {
      if (alreadySent.has(e.id)) { skipped++; continue; }
      if (!e.email) { skipped++; continue; }
      const fullName = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
      const form16Url = buildAppUrl(`/payroll/reports/form-16/${e.id}/${year}/pdf`);

      await dispatchNotification({
        eventType: "form_16_available", module: "payroll",
        recipientEmail: e.email, recipientName: fullName,
        recipientEmployeeDbId: e.id,
        variables: {
          recipientName: fullName,
          financialYear: fyLabel,
          form16Url,
        },
        entityType: entityTypeKey, entityId: e.id,
        bypassPreferences: true,
        channels: ["email"],
      }).then(() => { sent++; })
        .catch((err) => logger.warn({ err, employeeId: e.id, to: e.email }, "[scheduler] form_16 dispatch failed"));
    }

    logger.info({ fy: fyLabel, eligible: recipients.length, sent, skipped }, "[scheduler] dispatchForm16ForFy completed");
    return { eligible: recipients.length, sent, skipped };
  } catch (err) {
    logger.error({ err, year }, "[scheduler] dispatchForm16ForFy error");
    if (throwOnError) throw err;
    return { eligible: 0, sent: 0, skipped: 0 };
  }
}

/**
 * Catch-up guard for the annual Form 16 dispatch. Called on scheduler startup:
 * if today is in April or May (early window after FY-end), trigger
 * `dispatchForm16ForFy` for the just-finished FY. The function itself is
 * idempotent — already-notified employees are skipped — so this safely covers
 * the case where the service was down at the scheduled cron time.
 */
async function maybeRunForm16AnnualCatchUp(): Promise<void> {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan
  if (month !== 3 && month !== 4) return; // April or May only
  const previousFyStartYear = now.getFullYear() - 1;
  await dispatchForm16ForFy(previousFyStartYear);
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
  // Every 30 minutes — shift-aware no-sign-in alert (30 min after each employee's personal shift start)
  cron.schedule("*/30 * * * *", () => {
    void alertShiftAwareNoSignIn();
  });
  // Every 30 minutes — shift-aware no-sign-out alert (30 min after each employee's personal shift end)
  cron.schedule("*/30 * * * *", () => {
    void alertShiftAwareNoSignOut();
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
  // Every 4 hours — remind payroll admins about Computed runs sitting unapproved
  // beyond the configured threshold (system_settings payroll.approval_reminder_hours, default 24h).
  cron.schedule("15 */4 * * *", () => {
    void remindPendingPayrollApprovals();
  });
  // At 10:15 daily — WhatsApp nudge to assignees of overdue exit clearance tasks.
  // Runs after the every-2h exit escalation job (`processConfiguredEscalations`).
  // Per-task suppression prevents same assignee/task pair being messaged more
  // than once per day.
  cron.schedule("15 10 * * *", () => {
    void remindOverdueExitClearanceTasks();
  });
  // April 5 at 09:00 — annual Form 16 dispatch for the just-finished FY
  // (FY runs Apr `year` → Mar `year+1`; in early April we email for FY = year-1).
  // Idempotent: re-running won't double-send (dedup by notification_logs).
  cron.schedule("0 9 5 4 *", () => {
    const previousFyStartYear = new Date().getFullYear() - 1;
    void dispatchForm16ForFy(previousFyStartYear);
  });
  // Catch-up: if the service was down at the April 5 cron, re-attempt the
  // annual Form 16 dispatch on startup whenever we boot in April or May.
  // dispatchForm16ForFy is idempotent (employee+FY dedup).
  setTimeout(() => void maybeRunForm16AnnualCatchUp(), 15_000);
  // At 03:15 daily — delete orphaned ticket attachment objects from object
  // storage (>7 days old with no ticket_attachments row).
  cron.schedule("15 3 * * *", () => {
    void cleanupOrphanedAttachments({ triggeredBy: "cron" });
  });
  // At 02:00 on Jan 1 (server local time) — auto year-end leave carry-forward
  // for the just-finished year. Idempotent — safe even if HR also triggered
  // it manually, and a manual re-run remains available as a fallback.
  cron.schedule("0 2 1 1 *", () => {
    void runYearEndCarryForwardJob();
  });
  // Run once 5s after startup to catch any overdue schedules
  setTimeout(() => void runSchedulerTick(), 5_000);
  // Catch-up: if we boot during January and the year-end carry-forward
  // hasn't been recorded for this year (e.g. service was down at 02:00
  // on Jan 1), run it now. Idempotent and advisory-locked.
  setTimeout(() => void maybeRunYearEndCarryForwardCatchUp(), 10_000);
  logger.info("[scheduler] started — runs every hour at :00 + notification jobs");
}
