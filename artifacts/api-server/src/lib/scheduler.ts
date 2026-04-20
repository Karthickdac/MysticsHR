import cron from "node-cron";
import nodemailer from "nodemailer";
import { db } from "./db";
import {
  reportSchedulesTable,
  employeesTable,
  departmentsTable,
  attendanceRecordsTable,
  leaveApplicationsTable,
  leaveTypesTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
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
  const now = Date.now();
  const last = lastRunAt.getTime();
  if (frequency === "daily") return now - last >= 24 * 60 * 60 * 1000;
  if (frequency === "weekly") return now - last >= 7 * 24 * 60 * 60 * 1000;
  if (frequency === "monthly") {
    const n = new Date();
    const l = new Date(last);
    return n.getFullYear() > l.getFullYear() || n.getMonth() > l.getMonth();
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
      default:
        logger.warn({ reportType }, "[scheduler] no direct query defined for report type; skipping data fetch");
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

// ─── Main scheduler tick ──────────────────────────────────────────────────────
async function runSchedulerTick() {
  logger.debug("[scheduler] tick");
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
