import { useEffect, useState } from "react";
import {
  useListPayrollRuns, useCreatePayrollRun, useComputePayrollRun, useApprovePayrollRun,
  useFinalizePayrollRun, useListPayrollLocks, useLockPayroll, useUnlockPayroll,
  useGetPayrollAnalytics, useGetPayrollRunRecords,
  getListPayrollRunsQueryKey, getListPayrollLocksQueryKey, getGetPayrollAnalyticsQueryKey,
  getGetPayrollRunRecordsQueryKey,
} from "@workspace/api-client-react";
import type { GetPayrollAnalytics200, PayrollRun } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
  ComposedChart,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { extractError } from "@/lib/utils";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, CheckCircle2, Lock, Unlock, FileText, RefreshCw, Plus, ChevronRight,
  Banknote, Users, TrendingUp,
} from "lucide-react";
import {
  STATUTORY_TO_REPORT,
  extractDatum,
  findRunIdForMonth as findRunIdForMonthHelper,
  buildStatutoryReportQuery,
} from "./chart-drilldowns";

const RUN_STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Computed: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Locked: "bg-purple-100 text-purple-700",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

function EmployeePayrollPortal() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Access your payslips and tax declarations below.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/payroll/payslips">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-50"><FileText className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="font-semibold">My Payslips</p>
                <p className="text-xs text-muted-foreground">View and download your salary slips</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/payroll/tax-declaration">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-green-50"><Banknote className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="font-semibold">Tax Declaration</p>
                <p className="text-xs text-muted-foreground">Submit your income tax regime declaration</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

const CHART_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

function compactInr(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function DepartmentDrilldownDialog({
  open, onOpenChange, runId, departmentId, departmentName, periodLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  runId: number | null;
  departmentId: number | null;
  departmentName: string;
  periodLabel: string;
}) {
  // The runId is owned by the parent and reflects the period the parent has
  // selected on the dept card. When that selection changes, this dialog will
  // refetch automatically because the query key changes.
  // Only fetch when dialog is open and we have a run id.
  const safeRunId = runId ?? 0;
  const { data: records, isLoading } = useGetPayrollRunRecords(
    safeRunId,
    { query: { enabled: open && !!runId, queryKey: getGetPayrollRunRecordsQueryKey(safeRunId) } },
  );
  const filtered = (records ?? []).filter(r =>
    departmentId == null ? r.departmentId == null : r.departmentId === departmentId,
  );
  const totalNet = filtered.reduce((s, r) => s + Number(r.netPay ?? 0), 0);
  const totalGross = filtered.reduce((s, r) => s + Number(r.grossEarnings ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{departmentName} — {periodLabel}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">
          {filtered.length} employee{filtered.length === 1 ? "" : "s"} · Gross {fmt(totalGross)} · Net {fmt(totalNet)}
        </div>
        <div className="max-h-[60vh] overflow-auto border rounded-lg">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No payroll records for this department in the period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2">Code</th>
                  <th className="text-left p-2">Employee</th>
                  <th className="text-right p-2">Gross</th>
                  <th className="text-right p-2">Deductions</th>
                  <th className="text-right p-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.employeeCode ?? "—"}</td>
                    <td className="p-2">{r.employeeName ?? `#${r.employeeId}`}</td>
                    <td className="p-2 text-right">{fmt(r.grossEarnings)}</td>
                    <td className="p-2 text-right">{fmt(r.totalDeductions)}</td>
                    <td className="p-2 text-right font-semibold">{fmt(r.netPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          {runId && (
            <Link href={`/payroll/runs/${runId}`}>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Open full payroll run
              </Button>
            </Link>
          )}
          <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PeriodPreset = "last12" | "currentFy" | "previousFy" | "custom";

// localStorage persistence for the dashboard analytics controls. We validate
// every field on load so a corrupted or stale payload (e.g. an old preset name
// that no longer exists) silently falls back to defaults rather than crashing
// the dashboard. The custom range is only honoured when both bounds are set.
const PAYROLL_CONTROLS_STORAGE_KEY = "mysticshr.payroll.analyticsControls.v1";
type PersistedAnalyticsControls = {
  preset: PeriodPreset;
  custom: { from: string; to: string };
  compare: boolean;
};
const VALID_PRESETS: PeriodPreset[] = ["last12", "currentFy", "previousFy", "custom"];
const MONTH_RE = /^\d{4}-\d{2}$/;
function loadAnalyticsControls(defaultRange: { from: string; to: string }): PersistedAnalyticsControls {
  const fallback: PersistedAnalyticsControls = { preset: "last12", custom: defaultRange, compare: false };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PAYROLL_CONTROLS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedAnalyticsControls> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const preset = VALID_PRESETS.includes(parsed.preset as PeriodPreset)
      ? (parsed.preset as PeriodPreset) : fallback.preset;
    const customFrom = typeof parsed.custom?.from === "string" && MONTH_RE.test(parsed.custom.from)
      ? parsed.custom.from : defaultRange.from;
    const customTo = typeof parsed.custom?.to === "string" && MONTH_RE.test(parsed.custom.to)
      ? parsed.custom.to : defaultRange.to;
    const compare = parsed.compare === true;
    return { preset, custom: { from: customFrom, to: customTo }, compare };
  } catch {
    return fallback;
  }
}
function saveAnalyticsControls(controls: PersistedAnalyticsControls): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAYROLL_CONTROLS_STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Quota exceeded / disabled storage — silently ignore; the dashboard
    // continues to work, the choice just won't survive a reload.
  }
}

// Resolves a period preset to a (from, to) YYYY-MM tuple. Indian FY runs Apr–Mar.
function resolvePeriod(preset: PeriodPreset, custom: { from: string; to: string }, now = new Date()): { from: string; to: string } {
  const fmt = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (preset === "currentFy") {
    const fyStart = m >= 4 ? y : y - 1;
    return { from: fmt(fyStart, 4), to: fmt(fyStart + 1, 3) };
  }
  if (preset === "previousFy") {
    const fyStart = (m >= 4 ? y : y - 1) - 1;
    return { from: fmt(fyStart, 4), to: fmt(fyStart + 1, 3) };
  }
  if (preset === "custom") return { from: custom.from, to: custom.to };
  // last12 (default)
  const fromDate = new Date(y, m - 12, 1);
  return { from: fmt(fromDate.getFullYear(), fromDate.getMonth() + 1), to: fmt(y, m) };
}

function PayrollAnalyticsControls({
  preset, setPreset, custom, setCustom, compare, setCompare, financialYear, rangeError,
  isCustomized, onReset,
}: {
  preset: PeriodPreset;
  setPreset: (p: PeriodPreset) => void;
  custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void;
  compare: boolean;
  setCompare: (v: boolean) => void;
  financialYear: string;
  rangeError: string | null;
  isCustomized: boolean;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last12">Last 12 months</SelectItem>
                <SelectItem value="currentFy">Current FY{financialYear ? ` (${financialYear})` : ""}</SelectItem>
                <SelectItem value="previousFy">Previous FY</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="month" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} className="h-8 w-36" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="month" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} className="h-8 w-36" />
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={compare}
                onChange={e => setCompare(e.target.checked)}
              />
              Compare with previous year
            </label>
            {isCustomized && (
              <button
                type="button"
                onClick={onReset}
                className="text-xs text-primary hover:underline"
                title="Restore the default period and toggles"
              >
                Reset to defaults
              </button>
            )}
          </div>
        </div>
        {rangeError && (
          <div className="text-xs text-red-600">{rangeError}</div>
        )}
      </CardContent>
    </Card>
  );
}

// Custom tooltip for the YoY-enabled monthly trend chart. Shows each metric's
// current value alongside the prior-year value and the % delta. The variance
// row is suppressed for any metric whose prior value is missing — partial
// overlaps shouldn't show "+∞%" or misleading "+100%" numbers.
type YoYTooltipPayloadItem = {
  dataKey?: string | number;
  payload?: {
    label?: string;
    totalGross?: number; totalNet?: number; totalDeductions?: number;
    priorTotalGross?: number | null; priorTotalNet?: number | null; priorTotalDeductions?: number | null;
  };
};
function YoYTrendTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: YoYTooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // All series share the same datum, so just read the first.
  const d = payload[0]?.payload;
  if (!d) return null;
  const rows: Array<{ key: string; name: string; color: string; cur: number | undefined; prior: number | null | undefined }> = [
    { key: "gross", name: "Gross", color: "#6366f1", cur: d.totalGross, prior: d.priorTotalGross },
    { key: "net", name: "Net", color: "#10b981", cur: d.totalNet, prior: d.priorTotalNet },
    { key: "deductions", name: "Deductions", color: "#ef4444", cur: d.totalDeductions, prior: d.priorTotalDeductions },
  ];
  return (
    <div className="rounded-md border bg-popover text-popover-foreground shadow-md text-xs p-2 min-w-[180px]">
      <div className="font-medium mb-1">{label}</div>
      {rows.map(r => {
        const hasPrior = r.prior != null && r.cur != null;
        const pct = hasPrior && r.prior !== 0 ? ((r.cur! - r.prior!) / r.prior!) * 100 : null;
        const pctText = pct == null ? null : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
        const pctClass = pct == null ? "" : (pct >= 0 ? "text-emerald-600" : "text-red-600");
        return (
          <div key={r.key} className="flex items-center justify-between gap-3 py-0.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: r.color }} />
              {r.name}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-medium">{r.cur != null ? compactInr(r.cur) : "—"}</span>
              {hasPrior && pctText && (
                <span className={pctClass}>
                  <span className="text-muted-foreground">Δ vs prev yr:</span> {pctText}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PayrollAnalyticsSection({
  analytics, runs, deptPeriod, setDeptPeriod, navigateOverride,
}: {
  analytics: GetPayrollAnalytics200 | undefined;
  runs: PayrollRun[] | undefined;
  deptPeriod: { year: number; month: number } | null;
  setDeptPeriod: (p: { year: number; month: number } | null) => void;
  navigateOverride?: (path: string) => void;
}) {
  const [, wouterNavigate] = useLocation();
  const navigate = navigateOverride ?? wouterNavigate;
  const [drilldown, setDrilldown] = useState<{ departmentId: number | null; departmentName: string } | null>(null);

  if (!analytics) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-64 bg-muted/30 rounded animate-pulse lg:col-span-2" />
            <div className="h-64 bg-muted/30 rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const trend = analytics.monthlyTrend ?? [];
  const dept = analytics.departmentBreakdown ?? [];
  const statutory = analytics.statutoryDeductions ?? {
    pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, professionalTax: 0, tds: 0,
  };
  const fy = analytics.financialYear ?? "";
  const latestPeriod = analytics.latestPeriodLabel ?? "latest period";

  const hasAnyData = trend.length > 0 || dept.length > 0;
  if (!hasAnyData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No analytics yet — approve a payroll run to see cost insights.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statutoryData = [
    { name: "PF (Employee)", value: statutory.pfEmployee },
    { name: "PF (Employer)", value: statutory.pfEmployer },
    { name: "ESI (Employee)", value: statutory.esiEmployee },
    { name: "ESI (Employer)", value: statutory.esiEmployer },
    { name: "Professional Tax", value: statutory.professionalTax },
    { name: "TDS", value: statutory.tds },
  ];

  const handleMonthBarClick = (arg: unknown) => {
    const d = extractDatum<{ year?: number; month?: number }>(arg);
    if (!d?.year || !d?.month) return;
    const id = findRunIdForMonthHelper(runs, d.year, d.month);
    if (id) navigate(`/payroll/runs/${id}`);
  };

  const handleStatutoryBarClick = (arg: unknown) => {
    const d = extractDatum<{ name?: string }>(arg);
    if (!d?.name || !analytics.latestPeriodLabel) return;
    const latest = analytics.monthlyTrend?.[analytics.monthlyTrend.length - 1];
    const qs = buildStatutoryReportQuery(d.name, latest);
    if (qs) navigate(`/payroll/reports?${qs}`);
  };

  const handleDeptClick = (arg: unknown) => {
    const d = extractDatum<{ departmentId?: number | null; departmentName?: string }>(arg);
    if (!d) return;
    setDrilldown({
      departmentId: d.departmentId ?? null,
      departmentName: d.departmentName ?? "Unassigned",
    });
  };

  // Prior-year series is opt-in via the analytics endpoint's compareWithPrior
  // flag; detect by presence on any data point rather than threading another prop.
  // Detect YoY mode by checking ANY of the prior fields, not just net — guards
  // against an edge case where the backend ever returns prior fields
  // asymmetrically (e.g. only gross has a comparable prior month).
  const showPrior = trend.some(p => {
    const r = p as { priorTotalGross?: number | null; priorTotalNet?: number | null; priorTotalDeductions?: number | null };
    return r.priorTotalGross != null || r.priorTotalNet != null || r.priorTotalDeductions != null;
  });
  const windowLabel = analytics.windowFrom && analytics.windowTo
    ? `${analytics.windowFrom} → ${analytics.windowTo}`
    : "selected period";

  // Aggregate window-over-prior-window variance for the KPI strip. Each metric
  // is paired independently — a month with only e.g. prior gross (but no prior
  // headcount) still counts toward the gross KPI. Headcount uses the average
  // across paired months — sum is meaningless for a per-month snapshot — and is
  // rounded to whole people for display.
  const aggregateVariance = (() => {
    if (!showPrior) return null;
    type Row = {
      totalGross: number; totalNet: number; employees: number;
      priorTotalGross?: number | null; priorTotalNet?: number | null; priorEmployees?: number | null;
    };
    const rows = trend as Row[];
    const pct = (cur: number, prior: number) => prior === 0 ? null : ((cur - prior) / prior) * 100;
    function pairSum(curKey: keyof Row, priorKey: keyof Row): { cur: number; prior: number; paired: number } {
      let cur = 0, prior = 0, paired = 0;
      for (const r of rows) {
        const p = r[priorKey] as number | null | undefined;
        if (p == null) continue;
        cur += r[curKey] as number; prior += p; paired += 1;
      }
      return { cur, prior, paired };
    }
    const gross = pairSum("totalGross", "priorTotalGross");
    const net = pairSum("totalNet", "priorTotalNet");
    const emp = pairSum("employees", "priorEmployees");
    if (gross.paired === 0 && net.paired === 0 && emp.paired === 0) return null;
    return {
      gross: { cur: gross.cur, prior: gross.prior, pct: gross.paired ? pct(gross.cur, gross.prior) : null, paired: gross.paired },
      net: { cur: net.cur, prior: net.prior, pct: net.paired ? pct(net.cur, net.prior) : null, paired: net.paired },
      headcount: {
        cur: emp.paired ? Math.round(emp.cur / emp.paired) : 0,
        prior: emp.paired ? Math.round(emp.prior / emp.paired) : 0,
        pct: emp.paired ? pct(emp.cur, emp.prior) : null,
        paired: emp.paired,
      },
    };
  })();
  const fmtPct = (p: number | null) => p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  const pctColor = (p: number | null, invert = false) => {
    if (p == null) return "text-muted-foreground";
    const up = p >= 0;
    return up === !invert ? "text-emerald-600" : "text-red-600";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Monthly Cost Trend</CardTitle>
            <span className="text-xs text-muted-foreground">{windowLabel} · Approved &amp; Locked runs</span>
          </div>
        </CardHeader>
        <CardContent>
          {aggregateVariance && (
            <div
              data-testid="yoy-kpi-strip"
              className="grid grid-cols-3 gap-2 mb-3 pb-3 border-b"
            >
              {[
                { label: "Total Gross", v: aggregateVariance.gross, fmtVal: (n: number) => compactInr(n), invertColor: false },
                { label: "Total Net", v: aggregateVariance.net, fmtVal: (n: number) => compactInr(n), invertColor: false },
                { label: "Avg Headcount", v: aggregateVariance.headcount, fmtVal: (n: number) => `${n}`, invertColor: false },
              ].map(item => (
                <div key={item.label} className="px-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-base font-semibold leading-tight">{item.v.paired > 0 ? item.fmtVal(item.v.cur) : "—"}</p>
                  {item.v.paired > 0 ? (
                    <p className={`text-xs leading-tight ${pctColor(item.v.pct, item.invertColor)}`}>
                      {fmtPct(item.v.pct)} <span className="text-muted-foreground">vs prev yr ({item.fmtVal(item.v.prior)})</span>
                    </p>
                  ) : (
                    <p className="text-xs leading-tight text-muted-foreground">No prior-year data</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {trend.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No finalized runs in the selected window.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={compactInr} tick={{ fontSize: 12 }} width={70} />
                <Tooltip
                  content={showPrior ? <YoYTrendTooltip /> : undefined}
                  formatter={showPrior ? undefined : (v: number) => compactInr(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="totalGross" name="Gross" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="totalNet" name="Net" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="totalDeductions" name="Deductions" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                {showPrior && <>
                  <Line type="monotone" dataKey="priorTotalGross" name="Gross (prev yr)" stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                  <Line type="monotone" dataKey="priorTotalNet" name="Net (prev yr)" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                  <Line type="monotone" dataKey="priorTotalDeductions" name="Deductions (prev yr)" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                </>}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Headcount vs Cost</CardTitle>
            <span className="text-xs text-muted-foreground">{windowLabel}</span>
          </div>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={trend} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={compactInr} tick={{ fontSize: 11 }} width={60} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(value: number, name: string) => name === "Employees" ? value : compactInr(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="totalNet" name="Net Cost" fill="#6366f1" radius={[3, 3, 0, 0]}
                  onClick={handleMonthBarClick} style={{ cursor: "pointer" }} />
                <Line yAxisId="right" type="monotone" dataKey="employees" name="Employees" stroke="#f59e0b" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Department-wise Cost</CardTitle>
            {analytics.availablePeriods && analytics.availablePeriods.length > 0 ? (
              <Select
                value={deptPeriod
                  ? `${deptPeriod.year}-${deptPeriod.month}`
                  : (analytics.latestPeriodYear && analytics.latestPeriodMonth
                      ? `${analytics.latestPeriodYear}-${analytics.latestPeriodMonth}`
                      : "")}
                onValueChange={(v) => {
                  const [y, m] = v.split("-").map(Number);
                  setDeptPeriod({ year: y, month: m });
                }}
              >
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder={latestPeriod} /></SelectTrigger>
                <SelectContent>
                  {analytics.availablePeriods.map(p => (
                    <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">{latestPeriod}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {dept.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No department data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={dept}
                  dataKey="totalNet"
                  nameKey="departmentName"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(entry: { departmentName: string }) => entry.departmentName}
                  labelLine={false}
                  onClick={handleDeptClick}
                  style={{ cursor: "pointer" }}
                >
                  {dept.map((_d, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => compactInr(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Statutory Contributions</CardTitle>
            <span className="text-xs text-muted-foreground">{windowLabel}{fy ? ` · FY ${fy}` : ""}</span>
          </div>
        </CardHeader>
        <CardContent>
          {statutoryData.every(s => s.value === 0) ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No statutory deductions recorded for this FY yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={statutoryData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tickFormatter={compactInr} tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: number) => compactInr(Number(v))} />
                <Bar dataKey="value" name="Total" radius={[4, 4, 0, 0]}
                  onClick={handleStatutoryBarClick} style={{ cursor: "pointer" }}>
                  {statutoryData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <DepartmentDrilldownDialog
        open={drilldown !== null}
        onOpenChange={(v) => { if (!v) setDrilldown(null); }}
        runId={analytics.latestRunId ?? null}
        departmentId={drilldown?.departmentId ?? null}
        departmentName={drilldown?.departmentName ?? ""}
        periodLabel={latestPeriod}
      />
    </div>
  );
}

function AdminPayrollDashboard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const { data: runs, isLoading } = useListPayrollRuns();
  const { data: locks } = useListPayrollLocks({ year: currentYear, month: currentMonth });

  // Period & YoY controls drive the analytics query. Defaults match the legacy
  // behaviour (last 12 months, no overlay) so the dashboard looks unchanged on
  // first load. The user's last selection is persisted in localStorage and
  // rehydrated on mount — bad/missing payloads silently fall back to defaults.
  const defaultRange = resolvePeriod("last12", { from: "", to: "" }, now);
  const initialControls = loadAnalyticsControls(defaultRange);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(initialControls.preset);
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>(initialControls.custom);
  const [compareYoY, setCompareYoY] = useState(initialControls.compare);
  // Persist any change. Skipped on the first synchronous render because we
  // already loaded from storage above; useEffect runs after commit so this
  // simply mirrors current state back out.
  useEffect(() => {
    saveAnalyticsControls({ preset: periodPreset, custom: customRange, compare: compareYoY });
  }, [periodPreset, customRange, compareYoY]);
  const isControlsCustomized = periodPreset !== "last12" || compareYoY
    || customRange.from !== defaultRange.from || customRange.to !== defaultRange.to;
  const handleResetControls = () => {
    setPeriodPreset("last12");
    setCustomRange(defaultRange);
    setCompareYoY(false);
  };
  const resolvedRange = resolvePeriod(periodPreset, customRange, now);
  // Validate the custom range client-side so we don't fire a request that the
  // backend will reject; surface the error inline beside the controls so HR can
  // recover without losing the rest of the dashboard.
  const rangeError = (() => {
    if (!resolvedRange.from || !resolvedRange.to) return "Pick both a start and end month.";
    if (resolvedRange.from > resolvedRange.to) return "Start month must be before end month.";
    return null;
  })();
  // Period override for the Department-wise Cost card. Defaults to the latest
  // finalized run (returned by the analytics endpoint); HR can pick any older
  // period from the dept card's selector to investigate spikes without changing
  // the trend window above. Reset whenever the trend window changes so we don't
  // hold a stale out-of-window selection.
  const [deptPeriod, setDeptPeriod] = useState<{ year: number; month: number } | null>(null);
  useEffect(() => {
    setDeptPeriod(null);
  }, [resolvedRange.from, resolvedRange.to]);
  const analyticsParams = {
    from: resolvedRange.from,
    to: resolvedRange.to,
    compareWithPrior: compareYoY,
    ...(deptPeriod ? { deptYear: deptPeriod.year, deptMonth: deptPeriod.month } : {}),
  };
  const { data: analytics } = useGetPayrollAnalytics(analyticsParams, {
    query: {
      enabled: rangeError === null,
      queryKey: getGetPayrollAnalyticsQueryKey(analyticsParams),
    },
  });
  const fyLabel = analytics?.financialYear ?? "";

  const createRun = useCreatePayrollRun();
  const computeRun = useComputePayrollRun();
  const approveRun = useApprovePayrollRun();
  const finalizeRun = useFinalizePayrollRun();
  const lockPayroll = useLockPayroll();
  const unlockPayroll = useUnlockPayroll();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ periodYear: String(currentYear), periodMonth: String(currentMonth), notes: "" });
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentLock = locks?.[0];
  const isCurrentlyLocked = currentLock?.isLocked === true;

  const totalNetPaid = runs?.filter(r => r.status === "Locked").reduce((s, r) => s + Number(r.totalNet), 0) ?? 0;
  const lastRun = runs?.[0];

  async function handleCreate() {
    try {
      await createRun.mutateAsync({ data: { periodYear: Number(newForm.periodYear), periodMonth: Number(newForm.periodMonth), notes: newForm.notes || undefined } });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPayrollLocksQueryKey({}) });
      qc.invalidateQueries({ queryKey: getGetPayrollAnalyticsQueryKey() });
      setShowNew(false);
    } catch (err: unknown) { setActionError(extractError(err, "Failed to create run")); }
  }

  async function handleCompute(id: number) {
    setBusy(id); setActionError(null);
    try {
      await computeRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollAnalyticsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to compute")); }
    finally { setBusy(null); }
  }

  async function handleApprove(id: number) {
    setBusy(id); setActionError(null);
    try {
      await approveRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollAnalyticsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to approve")); }
    finally { setBusy(null); }
  }

  async function handleFinalize(id: number) {
    setBusy(id); setActionError(null);
    try {
      await finalizeRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPayrollLocksQueryKey({}) });
      qc.invalidateQueries({ queryKey: getGetPayrollAnalyticsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to finalize")); }
    finally { setBusy(null); }
  }

  async function handleToggleLock() {
    setActionError(null);
    try {
      if (isCurrentlyLocked) {
        await unlockPayroll.mutateAsync({ year: currentYear, month: currentMonth });
      } else {
        await lockPayroll.mutateAsync({ year: currentYear, month: currentMonth });
      }
      qc.invalidateQueries({ queryKey: getListPayrollLocksQueryKey({}) });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to toggle lock")); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Process monthly payroll, manage salary structures, and generate payslips.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { setShowNew(true); setActionError(null); }}>
            <Plus className="w-4 h-4 mr-1" /> New Payroll Run
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Salary Structures", href: "/payroll/salary-structures", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Payslips", href: "/payroll/payslips", icon: FileText, color: "text-green-600", bg: "bg-green-50" },
          { label: "Tax Declaration", href: "/payroll/tax-declaration", icon: Banknote, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Salary Revisions", href: "/payroll/salary-revisions", icon: TrendingUp, color: "text-orange-600", bg: "bg-orange-50" },
        ].map(item => (
          <Link key={item.href} href={item.href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${item.bg}`}>
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <span className="font-medium text-sm">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Runs</p>
            <p className="text-3xl font-bold mt-1">{runs?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Net Pay</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{lastRun ? fmt(lastRun.totalNet) : "—"}</p>
            <p className="text-xs text-muted-foreground">{lastRun ? `${MONTHS[lastRun.periodMonth - 1]} ${lastRun.periodYear}` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Period</p>
            <p className="text-lg font-bold mt-1">{MONTHS[currentMonth - 1]} {currentYear}</p>
            <Badge className={`mt-1 text-xs ${isCurrentlyLocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
              {isCurrentlyLocked ? "Locked" : "Open"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Disbursed (FY)</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{fmt(totalNetPaid)}</p>
          </CardContent>
        </Card>
      </div>

      <PayrollAnalyticsControls
        preset={periodPreset}
        setPreset={setPeriodPreset}
        custom={customRange}
        setCustom={setCustomRange}
        compare={compareYoY}
        setCompare={setCompareYoY}
        financialYear={fyLabel}
        rangeError={rangeError}
        isCustomized={isControlsCustomized}
        onReset={handleResetControls}
      />
      <PayrollAnalyticsSection analytics={analytics} runs={runs} deptPeriod={deptPeriod} setDeptPeriod={setDeptPeriod} />

      <Card className={`border-2 ${isCurrentlyLocked ? "border-red-200 bg-red-50/40" : "border-green-200 bg-green-50/40"}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold">{MONTHS[currentMonth - 1]} {currentYear} — Payroll Lock</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isCurrentlyLocked
                ? "Payroll is locked. Salary edits, attendance changes, and leave balance adjustments are blocked."
                : "Payroll is open. Initiating a new run will auto-lock the period."}
            </p>
            {isCurrentlyLocked && !isSuperAdmin && (
              <p className="text-xs text-amber-700 mt-1">Only a Super Admin can manually unlock. Lock is released automatically upon finalization.</p>
            )}
          </div>
          {/* Lock: any admin; Unlock: Super Admin only (per policy — use finalize to release) */}
          {!isCurrentlyLocked && (
            <Button variant="secondary" size="sm" onClick={handleToggleLock} disabled={lockPayroll.isPending}>
              <Lock className="w-4 h-4 mr-1" />Lock
            </Button>
          )}
          {isCurrentlyLocked && isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={handleToggleLock} disabled={unlockPayroll.isPending}>
              <Unlock className="w-4 h-4 mr-1" />Unlock
            </Button>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <div className="bg-red-50 text-red-700 rounded-lg p-3 text-sm border border-red-200">{actionError}</div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Payroll Run History</CardTitle>
            <Link href="/payroll/reports">
              <Button variant="outline" size="sm">
                <FileText className="w-4 h-4 mr-1" /> Statutory Reports
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : !runs?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No payroll runs yet</p>
              <p className="text-sm">Start the first payroll run for this month.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Period</th>
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Employees</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Gross</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Deductions</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Net Pay</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-3">
                        <Link href={`/payroll/runs/${run.id}`} className="font-semibold text-primary hover:underline">
                          {MONTHS[run.periodMonth - 1]} {run.periodYear}
                        </Link>
                        {run.initiatorName && <p className="text-xs text-muted-foreground">by {run.initiatorName}</p>}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge className={`text-xs ${RUN_STATUS_COLORS[run.status]}`}>{run.status}</Badge>
                      </td>
                      <td className="py-3 pr-3 text-right">{run.totalEmployees}</td>
                      <td className="py-3 pr-3 text-right">{fmt(run.totalGross)}</td>
                      <td className="py-3 pr-3 text-right text-red-600">{fmt(run.totalDeductions)}</td>
                      <td className="py-3 pr-3 text-right font-semibold text-green-700">{fmt(run.totalNet)}</td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {run.status === "Draft" && (
                            <Button size="sm" variant="outline" onClick={() => handleCompute(run.id)} disabled={busy === run.id}>
                              {busy === run.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                              <span className="ml-1">Compute</span>
                            </Button>
                          )}
                          {run.status === "Computed" && (
                            <Button size="sm" variant="outline" onClick={() => handleCompute(run.id)} disabled={busy === run.id} title="Recompute">
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                          )}
                          {run.status === "Computed" && (
                            <Button size="sm" onClick={() => handleApprove(run.id)} disabled={busy === run.id}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />Approve
                            </Button>
                          )}
                          {run.status === "Approved" && (
                            <Button size="sm" variant="outline" onClick={() => handleFinalize(run.id)} disabled={busy === run.id}>
                              <Lock className="w-3 h-3 mr-1" />Finalize
                            </Button>
                          )}
                          <Link href={`/payroll/runs/${run.id}`}>
                            <Button size="sm" variant="ghost" title="View Records">
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Initiate Payroll Run</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Year</Label>
                <Input type="number" value={newForm.periodYear} onChange={e => setNewForm(f => ({ ...f, periodYear: e.target.value }))} min="2020" max="2030" />
              </div>
              <div className="space-y-1">
                <Label>Month</Label>
                <Select value={newForm.periodMonth} onValueChange={v => setNewForm(f => ({ ...f, periodMonth: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <p className="text-xs text-muted-foreground bg-yellow-50 p-3 rounded-lg border border-yellow-100">
              Initiating a payroll run will lock the period, preventing salary edits, attendance changes, and leave balance adjustments.
            </p>
            {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createRun.isPending}>
              {createRun.isPending ? "Initiating..." : "Initiate Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayrollDashboardPage() {
  const { role } = useCurrentHrmsUser();
  const isAdmin = ["super_admin", "payroll_admin"].includes(role ?? "");
  const isSuperAdmin = role === "super_admin";

  if (!isAdmin) {
    return <EmployeePayrollPortal />;
  }

  return <AdminPayrollDashboard isSuperAdmin={isSuperAdmin} />;
}
