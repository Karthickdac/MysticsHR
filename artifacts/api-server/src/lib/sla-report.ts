/**
 * Pure builders for the helpdesk SLA report.
 *
 * These are intentionally free of any database, HTTP, or time-of-day side
 * effects. The route handler is responsible for loading raw tickets +
 * assignee names from the database and supplying `now`, `from`, and `to`.
 * Everything else (filtering by createdAt range, KPI math, breach
 * detection, grouping, trend bucketing, CSV serialisation) lives here so
 * it can be unit-tested with fixtures.
 */

export type SlaTicket = {
  id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignedToUserId: number | null;
  raisedByEmployeeId: number | null;
  slaDeadline: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date | null;
};

export type BuildSlaReportInput = {
  tickets: SlaTicket[];
  assigneeNameById: Map<number, string | null> | Record<number, string | null>;
  now: Date;
  from?: Date;
  to?: Date;
};

export type SlaReportPayload = {
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  slaBreachedCount: number;
  avgResolutionHours: number | null;
  byPriority: Array<{ priority: string; count: number; breached: number; avgResolutionHours: number | null }>;
  byCategory: Array<{ category: string; count: number; breached: number; avgResolutionHours: number | null }>;
  trend: Array<{ date: string; avgHours: number; resolved: number }>;
  byAssignee: Array<{ assigneeUserId: number | null; assigneeName: string; total: number; breached: number; withinPct: number }>;
  rangeFrom: string | null;
  rangeTo: string | null;
};

const COMPLETED_STATUSES = new Set(["Resolved", "Closed"]);

function completionTime(t: SlaTicket): Date | null {
  const c = t.resolvedAt ?? t.closedAt;
  return c ? new Date(c) : null;
}

function isBreached(t: SlaTicket, now: Date): boolean {
  if (!t.slaDeadline) return false;
  const deadline = new Date(t.slaDeadline);
  if (COMPLETED_STATUSES.has(t.status)) {
    const c = completionTime(t);
    // Resolved/closed exactly on the deadline counts as within SLA (strict >).
    return !!c && c.getTime() > deadline.getTime();
  }
  return deadline.getTime() < now.getTime();
}

function inRangeByCreated(t: SlaTicket, from?: Date, to?: Date): boolean {
  if (!t.createdAt) return false;
  const c = new Date(t.createdAt).getTime();
  if (from && c < from.getTime()) return false;
  if (to && c > to.getTime()) return false;
  return true;
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nameLookup(map: Map<number, string | null> | Record<number, string | null>, id: number): string | null | undefined {
  if (map instanceof Map) return map.get(id);
  return map[id];
}

export function buildSlaReport(input: BuildSlaReportInput): SlaReportPayload {
  const { tickets, assigneeNameById, now, from, to } = input;
  const inRange = tickets.filter(t => inRangeByCreated(t, from, to));

  const totalTickets = inRange.length;
  const openTickets = inRange.filter(t => !COMPLETED_STATUSES.has(t.status)).length;
  const resolvedTickets = inRange.filter(t => COMPLETED_STATUSES.has(t.status)).length;
  const slaBreachedCount = inRange.filter(t => isBreached(t, now)).length;

  const resolvedWithTime = inRange.filter(t => completionTime(t) && t.createdAt);
  const avgResolutionHours = resolvedWithTime.length > 0
    ? resolvedWithTime.reduce((sum, t) => {
        const diff = completionTime(t)!.getTime() - new Date(t.createdAt!).getTime();
        return sum + diff / 3_600_000;
      }, 0) / resolvedWithTime.length
    : null;

  type Bucket = { count: number; breached: number; resolvedSumHrs: number; resolvedCount: number };
  const priorityMap: Record<string, Bucket> = {};
  const categoryMap: Record<string, Bucket> = {};

  for (const t of inRange) {
    const c = completionTime(t);
    const resolvedHrs = c && t.createdAt
      ? (c.getTime() - new Date(t.createdAt).getTime()) / 3_600_000
      : null;

    const pb = priorityMap[t.priority] ??= { count: 0, breached: 0, resolvedSumHrs: 0, resolvedCount: 0 };
    pb.count++;
    if (isBreached(t, now)) pb.breached++;
    if (resolvedHrs !== null) { pb.resolvedSumHrs += resolvedHrs; pb.resolvedCount++; }

    const cb = categoryMap[t.category] ??= { count: 0, breached: 0, resolvedSumHrs: 0, resolvedCount: 0 };
    cb.count++;
    if (isBreached(t, now)) cb.breached++;
    if (resolvedHrs !== null) { cb.resolvedSumHrs += resolvedHrs; cb.resolvedCount++; }
  }

  // Daily trend: bucket avg resolution hours by completion day, but only if
  // completion falls within the requested range.
  const trendBuckets = new Map<string, { sum: number; n: number }>();
  for (const t of inRange) {
    const c = completionTime(t);
    if (!c || !t.createdAt) continue;
    if (from && c < from) continue;
    if (to && c > to) continue;
    const hrs = (c.getTime() - new Date(t.createdAt).getTime()) / 3_600_000;
    const day = c.toISOString().slice(0, 10);
    const b = trendBuckets.get(day) ?? { sum: 0, n: 0 };
    b.sum += hrs;
    b.n += 1;
    trendBuckets.set(day, b);
  }
  const trend = [...trendBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({ date, avgHours: round2(b.sum / b.n), resolved: b.n }));

  // Per-assignee aggregation. Tickets with no assignee group under "Unassigned".
  const assigneeMap = new Map<number | null, { total: number; breached: number }>();
  for (const t of inRange) {
    const key: number | null = t.assignedToUserId ?? null;
    const m = assigneeMap.get(key) ?? { total: 0, breached: 0 };
    m.total += 1;
    if (isBreached(t, now)) m.breached += 1;
    assigneeMap.set(key, m);
  }
  const byAssignee = [...assigneeMap.entries()].map(([id, v]) => ({
    assigneeUserId: id,
    assigneeName: id === null ? "Unassigned" : (nameLookup(assigneeNameById, id) ?? `User #${id}`),
    total: v.total,
    breached: v.breached,
    withinPct: v.total > 0 ? Math.round(((v.total - v.breached) / v.total) * 100) : 0,
  }));

  return {
    totalTickets,
    openTickets,
    resolvedTickets,
    slaBreachedCount,
    avgResolutionHours: round1(avgResolutionHours),
    byPriority: Object.entries(priorityMap).map(([priority, v]) => ({
      priority, count: v.count, breached: v.breached,
      avgResolutionHours: v.resolvedCount > 0 ? round1(v.resolvedSumHrs / v.resolvedCount) : null,
    })),
    byCategory: Object.entries(categoryMap).map(([category, v]) => ({
      category, count: v.count, breached: v.breached,
      avgResolutionHours: v.resolvedCount > 0 ? round1(v.resolvedSumHrs / v.resolvedCount) : null,
    })),
    trend,
    byAssignee,
    rangeFrom: from?.toISOString() ?? null,
    rangeTo: to?.toISOString() ?? null,
  };
}

export const SLA_CSV_HEADER = [
  "Ticket ID", "Subject", "Category", "Priority", "Status",
  "Raised By Employee ID", "Assigned To User ID",
  "Created At", "SLA Deadline", "Resolved At", "Closed At",
  "SLA Breached", "Resolution Hours",
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSlaReportCsv(
  tickets: SlaTicket[],
  opts: { now: Date; from?: Date; to?: Date },
): string {
  const inRange = tickets.filter(t => inRangeByCreated(t, opts.from, opts.to));
  const lines = [SLA_CSV_HEADER.join(",")];
  for (const t of inRange) {
    const breached = isBreached(t, opts.now);
    const completedAt = t.resolvedAt ?? t.closedAt;
    const resolutionHours = completedAt && t.createdAt
      ? Math.round(((new Date(completedAt).getTime() - new Date(t.createdAt).getTime()) / 3_600_000) * 10) / 10
      : "";
    lines.push([
      t.id, t.subject, t.category, t.priority, t.status,
      t.raisedByEmployeeId ?? "", t.assignedToUserId ?? "",
      t.createdAt ? new Date(t.createdAt).toISOString() : "",
      t.slaDeadline ? new Date(t.slaDeadline).toISOString() : "",
      t.resolvedAt ? new Date(t.resolvedAt).toISOString() : "",
      t.closedAt ? new Date(t.closedAt).toISOString() : "",
      breached ? "Yes" : "No",
      resolutionHours,
    ].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}
