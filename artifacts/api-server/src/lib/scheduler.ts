import cron from "node-cron";
import nodemailer from "nodemailer";
import { db } from "./db";
import {
  reportSchedulesTable,
  employeesTable,
  hrmsUsersTable,
  departmentsTable,
  attendanceRecordsTable,
  leaveApplicationsTable,
  leaveTypesTable,
  exitRequestsTable,
  payrollRecordsTable,
  payrollRunsTable,
  helpdeskTicketsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNotNull, ne, sql } from "drizzle-orm";
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
    // and the employee still has isActive=true
    const pending = await db.select({
      employeeId: exitRequestsTable.employeeId,
      actualLwd: exitRequestsTable.actualLwd,
      requestedLwd: exitRequestsTable.requestedLwd,
    }).from(exitRequestsTable)
      .innerJoin(employeesTable, and(
        eq(exitRequestsTable.employeeId, employeesTable.id),
        eq(employeesTable.isActive, true),
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

// ─── Start scheduler ──────────────────────────────────────────────────────────
export function startScheduler(_port: number) {
  // Run every hour at minute 0
  cron.schedule("0 * * * *", () => {
    void runSchedulerTick();
  });
  // Run once 5s after startup to catch any overdue schedules
  setTimeout(() => void runSchedulerTick(), 5_000);
  logger.info("[scheduler] started — runs every hour at :00");
}
