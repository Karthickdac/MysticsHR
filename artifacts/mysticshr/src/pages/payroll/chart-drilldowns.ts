// Pure helpers backing the payroll cost chart drill-downs (task #48).
//
// Extracted from PayrollAnalyticsSection so the brittle bits — Recharts
// payload normalization, the run-status filter that decides which run a
// monthly bar resolves to, and the FY-window URL the statutory bars
// build — are unit-testable without mounting the chart.
//
// Tests: chart-drilldowns.test.ts

export type RunLite = {
  id: number;
  periodYear: number;
  periodMonth: number;
  status: string;
};

export type MonthlyTrendPoint = {
  year?: number;
  month?: number;
};

export type DepartmentDatum = {
  departmentId?: number | null;
  departmentName?: string;
};

// Maps a statutory bar's display name to the corresponding report tab key in
// the Statutory Reports page (so a click navigates to the pre-filtered report).
export const STATUTORY_TO_REPORT: Record<string, string> = {
  "PF (Employee)": "pf-ecr",
  "PF (Employer)": "pf-ecr",
  "ESI (Employee)": "esi",
  "ESI (Employer)": "esi",
  "Professional Tax": "pt",
  "TDS": "tds",
};

// Recharts hands click handlers either the raw datum or a wrapper with the
// datum nested under `payload` (Bar/Pie behave differently). This helper
// normalizes so handlers always receive the source data row.
export function extractDatum<T>(arg: unknown): T | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const a = arg as Record<string, unknown>;
  if (a.payload && typeof a.payload === "object") return a.payload as T;
  return arg as T;
}

// Resolve a runId for a clicked monthly bar by matching year+month against
// committed (Approved/Locked) payroll runs only — the chart shows finalized
// figures, so click-through must never land on a Draft/Computed run.
// Prefers Locked over Approved when both exist for the same period.
export function findRunIdForMonth(
  runs: RunLite[] | undefined,
  year: number,
  month: number,
): number | null {
  if (!runs) return null;
  const committed = runs.filter(r =>
    r.periodYear === year && r.periodMonth === month &&
    (r.status === "Locked" || r.status === "Approved"),
  );
  if (committed.length === 0) return null;
  const locked = committed.find(r => r.status === "Locked");
  return (locked ?? committed[0]).id;
}

// Build the query string the statutory bar click navigates to. Pre-fills the
// report to the current Indian FY (Apr 1 → latest finalized month) because
// compliance officers always reconcile statutory totals at FY scope.
// Returns null when the bar isn't clickable (unknown name or no finalized
// month yet).
export function buildStatutoryReportQuery(
  barName: string,
  latest: MonthlyTrendPoint | undefined,
): string | null {
  const reportType = STATUTORY_TO_REPORT[barName];
  if (!reportType) return null;
  const qs = new URLSearchParams({ type: reportType });
  if (latest?.year && latest?.month) {
    const fyStartYear = latest.month >= 4 ? latest.year : latest.year - 1;
    qs.set("filterMode", "range");
    qs.set("fromYear", String(fyStartYear));
    qs.set("fromMonth", "4");
    qs.set("toYear", String(latest.year));
    qs.set("toMonth", String(latest.month));
  }
  return qs.toString();
}
