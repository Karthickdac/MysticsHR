import { describe, it, expect } from "vitest";
import { buildSlaReport, buildSlaReportCsv, SLA_CSV_HEADER, type SlaTicket } from "./sla-report";

// Fixed reference time so breach detection is deterministic. Tickets/dates
// throughout these fixtures are anchored relative to this `now` (Apr 15 2026).
const NOW = new Date("2026-04-15T12:00:00.000Z");

function ticket(overrides: Partial<SlaTicket> & { id: number }): SlaTicket {
  return {
    subject: `Ticket ${overrides.id}`,
    category: "IT",
    priority: "Medium",
    status: "Open",
    assignedToUserId: null,
    raisedByEmployeeId: null,
    slaDeadline: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date("2026-04-10T09:00:00.000Z"),
    ...overrides,
  };
}

const NAMES = new Map<number, string | null>([
  [101, "Alice"],
  [102, "Bob"],
  // 103 intentionally missing to exercise "User #103" fallback
]);

describe("buildSlaReport", () => {
  it("returns zero KPIs and empty groupings for an empty input set", () => {
    const r = buildSlaReport({ tickets: [], assigneeNameById: NAMES, now: NOW });
    expect(r.totalTickets).toBe(0);
    expect(r.openTickets).toBe(0);
    expect(r.resolvedTickets).toBe(0);
    expect(r.slaBreachedCount).toBe(0);
    expect(r.avgResolutionHours).toBeNull();
    expect(r.byPriority).toEqual([]);
    expect(r.byCategory).toEqual([]);
    expect(r.byAssignee).toEqual([]);
    expect(r.trend).toEqual([]);
  });

  it("computes core KPIs, average resolution time, and grouping math", () => {
    const tickets: SlaTicket[] = [
      // Resolved on time — 4 hours
      ticket({
        id: 1, priority: "High", category: "IT", status: "Resolved", assignedToUserId: 101,
        createdAt: new Date("2026-04-10T08:00:00Z"),
        slaDeadline: new Date("2026-04-10T16:00:00Z"),
        resolvedAt: new Date("2026-04-10T12:00:00Z"),
      }),
      // Resolved late — 30 hours, breach
      ticket({
        id: 2, priority: "High", category: "IT", status: "Resolved", assignedToUserId: 101,
        createdAt: new Date("2026-04-11T00:00:00Z"),
        slaDeadline: new Date("2026-04-11T08:00:00Z"),
        resolvedAt: new Date("2026-04-12T06:00:00Z"),
      }),
      // Closed only (no resolvedAt) — 10 hours, on time
      ticket({
        id: 3, priority: "Low", category: "HR", status: "Closed", assignedToUserId: 102,
        createdAt: new Date("2026-04-12T00:00:00Z"),
        slaDeadline: new Date("2026-04-14T00:00:00Z"),
        closedAt: new Date("2026-04-12T10:00:00Z"),
      }),
      // Still open with deadline in the past — breach
      ticket({
        id: 4, priority: "Urgent", category: "IT", status: "In Progress", assignedToUserId: 102,
        createdAt: new Date("2026-04-13T00:00:00Z"),
        slaDeadline: new Date("2026-04-14T00:00:00Z"),
      }),
      // Still open with deadline in the future — not breached, no resolution
      ticket({
        id: 5, priority: "Medium", category: "HR", status: "Open", assignedToUserId: null,
        createdAt: new Date("2026-04-14T00:00:00Z"),
        slaDeadline: new Date("2026-04-20T00:00:00Z"),
      }),
    ];

    const r = buildSlaReport({ tickets, assigneeNameById: NAMES, now: NOW });

    expect(r.totalTickets).toBe(5);
    expect(r.openTickets).toBe(2); // ids 4, 5
    expect(r.resolvedTickets).toBe(3); // ids 1, 2, 3
    expect(r.slaBreachedCount).toBe(2); // ids 2, 4

    // Avg resolution = (4 + 30 + 10) / 3 = 14.666... → round1 = 14.7
    expect(r.avgResolutionHours).toBe(14.7);

    const high = r.byPriority.find(p => p.priority === "High")!;
    expect(high).toEqual({ priority: "High", count: 2, breached: 1, avgResolutionHours: 17 });

    const urgent = r.byPriority.find(p => p.priority === "Urgent")!;
    expect(urgent).toEqual({ priority: "Urgent", count: 1, breached: 1, avgResolutionHours: null });

    const low = r.byPriority.find(p => p.priority === "Low")!;
    expect(low.avgResolutionHours).toBe(10);

    const itCat = r.byCategory.find(c => c.category === "IT")!;
    expect(itCat).toEqual({ category: "IT", count: 3, breached: 2, avgResolutionHours: 17 });
    const hrCat = r.byCategory.find(c => c.category === "HR")!;
    expect(hrCat).toEqual({ category: "HR", count: 2, breached: 0, avgResolutionHours: 10 });

    // Per-assignee grouping with name resolution + Unassigned bucket
    const alice = r.byAssignee.find(a => a.assigneeUserId === 101)!;
    expect(alice).toEqual({ assigneeUserId: 101, assigneeName: "Alice", total: 2, breached: 1, withinPct: 50 });
    const bob = r.byAssignee.find(a => a.assigneeUserId === 102)!;
    expect(bob).toEqual({ assigneeUserId: 102, assigneeName: "Bob", total: 2, breached: 1, withinPct: 50 });
    const unassigned = r.byAssignee.find(a => a.assigneeUserId === null)!;
    expect(unassigned).toEqual({ assigneeUserId: null, assigneeName: "Unassigned", total: 1, breached: 0, withinPct: 100 });
  });

  it("falls back to 'User #<id>' when an assignee name is missing", () => {
    const r = buildSlaReport({
      tickets: [ticket({ id: 1, assignedToUserId: 103 })],
      assigneeNameById: NAMES,
      now: NOW,
    });
    expect(r.byAssignee).toEqual([
      { assigneeUserId: 103, assigneeName: "User #103", total: 1, breached: 0, withinPct: 100 },
    ]);
  });

  it("treats a ticket resolved exactly on the deadline as within SLA (not breached)", () => {
    const sameInstant = new Date("2026-04-10T12:00:00Z");
    const r = buildSlaReport({
      tickets: [ticket({
        id: 1, status: "Resolved", priority: "High",
        createdAt: new Date("2026-04-10T08:00:00Z"),
        slaDeadline: sameInstant,
        resolvedAt: sameInstant,
      })],
      assigneeNameById: NAMES,
      now: NOW,
    });
    expect(r.slaBreachedCount).toBe(0);
    expect(r.byPriority[0]?.breached).toBe(0);
  });

  it("does not count a ticket as breached when it has no SLA deadline", () => {
    const r = buildSlaReport({
      tickets: [ticket({ id: 1, slaDeadline: null, status: "Open" })],
      assigneeNameById: NAMES,
      now: NOW,
    });
    expect(r.slaBreachedCount).toBe(0);
  });

  it("excludes unresolved tickets from average resolution time", () => {
    // Only ticket #1 is resolved; #2 has no resolution yet. Avg = its 5 hours.
    const tickets: SlaTicket[] = [
      ticket({
        id: 1, status: "Resolved",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        resolvedAt: new Date("2026-04-10T05:00:00Z"),
        slaDeadline: new Date("2026-04-12T00:00:00Z"),
      }),
      ticket({
        id: 2, status: "Open",
        createdAt: new Date("2026-04-13T00:00:00Z"),
        slaDeadline: new Date("2026-04-20T00:00:00Z"),
      }),
    ];
    const r = buildSlaReport({ tickets, assigneeNameById: NAMES, now: NOW });
    expect(r.avgResolutionHours).toBe(5);
  });

  it("filters tickets by createdAt range and excludes the rest from KPIs and trend", () => {
    const tickets: SlaTicket[] = [
      // Out of range (before)
      ticket({
        id: 1, status: "Resolved",
        createdAt: new Date("2026-03-31T23:59:00Z"),
        resolvedAt: new Date("2026-04-01T00:00:00Z"),
        slaDeadline: new Date("2026-04-05T00:00:00Z"),
      }),
      // In range
      ticket({
        id: 2, status: "Resolved",
        createdAt: new Date("2026-04-05T00:00:00Z"),
        resolvedAt: new Date("2026-04-05T02:00:00Z"),
        slaDeadline: new Date("2026-04-10T00:00:00Z"),
      }),
      // Out of range (after)
      ticket({
        id: 3, status: "Open",
        createdAt: new Date("2026-04-30T00:00:00Z"),
        slaDeadline: new Date("2026-05-05T00:00:00Z"),
      }),
    ];

    const r = buildSlaReport({
      tickets,
      assigneeNameById: NAMES,
      now: NOW,
      from: new Date("2026-04-01T00:00:00Z"),
      to: new Date("2026-04-15T00:00:00Z"),
    });
    expect(r.totalTickets).toBe(1);
    expect(r.trend).toEqual([{ date: "2026-04-05", avgHours: 2, resolved: 1 }]);
    expect(r.rangeFrom).toBe("2026-04-01T00:00:00.000Z");
    expect(r.rangeTo).toBe("2026-04-15T00:00:00.000Z");
  });

  it("buckets the daily trend by completion day with averaged hours", () => {
    // Two tickets resolved on the same day → averaged; one on a different day.
    const tickets: SlaTicket[] = [
      ticket({
        id: 1, status: "Resolved",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        resolvedAt: new Date("2026-04-11T04:00:00Z"), // 28h
      }),
      ticket({
        id: 2, status: "Resolved",
        createdAt: new Date("2026-04-11T00:00:00Z"),
        resolvedAt: new Date("2026-04-11T12:00:00Z"), // 12h
      }),
      ticket({
        id: 3, status: "Closed",
        createdAt: new Date("2026-04-12T00:00:00Z"),
        closedAt: new Date("2026-04-12T03:00:00Z"), // 3h
      }),
    ];
    const r = buildSlaReport({ tickets, assigneeNameById: NAMES, now: NOW });
    expect(r.trend).toEqual([
      { date: "2026-04-11", avgHours: 20, resolved: 2 },
      { date: "2026-04-12", avgHours: 3, resolved: 1 },
    ]);
  });
});

describe("buildSlaReportCsv", () => {
  it("emits only the header row when there are no tickets in range", () => {
    const csv = buildSlaReportCsv([], { now: NOW });
    expect(csv).toBe(SLA_CSV_HEADER.join(","));
  });

  it("emits the header followed by one row per ticket with the documented shape", () => {
    const tickets: SlaTicket[] = [
      ticket({
        id: 42,
        subject: "Email broken",
        category: "IT",
        priority: "High",
        status: "Resolved",
        raisedByEmployeeId: 7,
        assignedToUserId: 101,
        createdAt: new Date("2026-04-10T00:00:00Z"),
        slaDeadline: new Date("2026-04-10T08:00:00Z"),
        resolvedAt: new Date("2026-04-10T05:30:00Z"),
      }),
      // Open + breached, no resolution
      ticket({
        id: 43,
        subject: "Laptop dead",
        category: "IT",
        priority: "Urgent",
        status: "Open",
        raisedByEmployeeId: 8,
        assignedToUserId: null,
        createdAt: new Date("2026-04-12T00:00:00Z"),
        slaDeadline: new Date("2026-04-13T00:00:00Z"),
      }),
    ];

    const csv = buildSlaReportCsv(tickets, { now: NOW });
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(SLA_CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);

    expect(lines[1]).toBe([
      "42", "Email broken", "IT", "High", "Resolved",
      "7", "101",
      "2026-04-10T00:00:00.000Z", "2026-04-10T08:00:00.000Z",
      "2026-04-10T05:30:00.000Z", "",
      "No", "5.5",
    ].join(","));

    expect(lines[2]).toBe([
      "43", "Laptop dead", "IT", "Urgent", "Open",
      "8", "",
      "2026-04-12T00:00:00.000Z", "2026-04-13T00:00:00.000Z",
      "", "",
      "Yes", "",
    ].join(","));
  });

  it("respects the createdAt date range filter", () => {
    const tickets: SlaTicket[] = [
      ticket({ id: 1, createdAt: new Date("2026-03-31T00:00:00Z") }),
      ticket({ id: 2, createdAt: new Date("2026-04-05T00:00:00Z") }),
      ticket({ id: 3, createdAt: new Date("2026-04-30T00:00:00Z") }),
    ];
    const csv = buildSlaReportCsv(tickets, {
      now: NOW,
      from: new Date("2026-04-01T00:00:00Z"),
      to: new Date("2026-04-15T00:00:00Z"),
    });
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2); // header + ticket #2
    expect(lines[1].startsWith("2,")).toBe(true);
  });

  it("escapes commas, quotes, newlines, and neutralises formula-injection prefixes", () => {
    const tickets: SlaTicket[] = [
      ticket({
        id: 1,
        subject: 'He said "hi", then left',
        category: "IT",
        createdAt: new Date("2026-04-10T00:00:00Z"),
      }),
      ticket({
        id: 2,
        subject: "=SUM(A1:A2)",
        category: "IT",
        createdAt: new Date("2026-04-11T00:00:00Z"),
      }),
      ticket({
        id: 3,
        subject: "line1\nline2",
        category: "IT",
        createdAt: new Date("2026-04-12T00:00:00Z"),
      }),
    ];
    const csv = buildSlaReportCsv(tickets, { now: NOW });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"He said ""hi"", then left"');
    // Formula-injection prefix is neutralised by a leading single-quote.
    // The neutralised value contains no comma/quote/newline so it is not
    // wrapped in quotes, but the leading "'" is what stops Excel evaluating it.
    expect(lines[2]).toContain(",'=SUM(A1:A2),");
    expect(lines[3]).toContain('"line1\nline2"');
  });
});
