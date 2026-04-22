import { useMemo, useState } from "react";
import { useGetHelpdeskSlaReport, getGetHelpdeskSlaReportCsvUrl } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, BarChart3, Download } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type RangePreset = "all" | "this_week" | "this_month" | "custom";

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // make Mon = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function fmtDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Reusable body of the SLA report (filters + KPIs + breakdowns + CSV export button).
 * Used by both the standalone /helpdesk/sla-report page and the "Reports" tab on the
 * Helpdesk page.
 */
export function SlaReportContent() {
  const { getToken } = useAuth();
  const [preset, setPreset] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  // Resolve effective from/to (ISO strings) for the active preset
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    if (preset === "this_week") {
      return { fromIso: startOfWeek(now).toISOString(), toIso: endOfDay(now).toISOString() };
    }
    if (preset === "this_month") {
      return { fromIso: startOfMonth(now).toISOString(), toIso: endOfDay(now).toISOString() };
    }
    if (preset === "custom") {
      return {
        fromIso: customFrom ? new Date(customFrom + "T00:00:00").toISOString() : undefined,
        toIso: customTo ? endOfDay(new Date(customTo + "T00:00:00")).toISOString() : undefined,
      };
    }
    return { fromIso: undefined, toIso: undefined };
  }, [preset, customFrom, customTo]);

  const { data: report, isLoading } = useGetHelpdeskSlaReport({ from: fromIso, to: toIso });

  const totalTickets = report?.totalTickets ?? 0;
  const slaBreachedCount = report?.slaBreachedCount ?? 0;
  const openTickets = report?.openTickets ?? 0;
  const resolvedTickets = report?.resolvedTickets ?? 0;
  const byPriority = report?.byPriority ?? [];
  const byCategory = report?.byCategory ?? [];
  const trend = report?.trend ?? [];
  const byAssignee = report?.byAssignee ?? [];

  const breachRate = totalTickets > 0 ? Math.round((slaBreachedCount / totalTickets) * 100) : 0;

  // Decorate the server-provided daily trend with a short axis label so the
  // chart x-axis stays compact even when the window spans many days.
  const trendData = useMemo(
    () =>
      trend.map((d) => ({
        ...d,
        label: new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      })),
    [trend],
  );

  // Stacked bar data: within-SLA vs breached counts per priority. Pulled
  // straight from the server breakdown so the chart numbers always match the
  // "By priority" list below.
  const priorityChartData = useMemo(
    () =>
      byPriority.map((p) => {
        const total = p.count;
        const breached = p.breached;
        return {
          priority: p.priority,
          withinSla: Math.max(0, total - breached),
          breached,
        };
      }),
    [byPriority],
  );

  // Per-assignee % within SLA, sorted worst-first so the bars HR needs to act
  // on appear at the top of the chart. "Unassigned" tickets are excluded —
  // they're a triage problem, not an assignee performance signal.
  const assigneeChartData = useMemo(
    () =>
      byAssignee
        .filter((a) => a.assigneeUserId !== null)
        .map((a) => ({ name: a.assigneeName, total: a.total, withinPct: a.withinPct }))
        .sort((a, b) => a.withinPct - b.withinPct),
    [byAssignee],
  );

  async function handleExportCsv() {
    setDownloading(true);
    try {
      const url = getGetHelpdeskSlaReportCsvUrl({ from: fromIso, to: toIso });
      const token = await getToken();
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`Failed to download CSV (${resp.status})`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `helpdesk-sla-report-${fmtDateInput(new Date())}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("CSV download failed", e);
      alert("Could not download CSV. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const fmtHrs = (h: number | null | undefined) =>
    h == null ? "—" : h < 24 ? `${h}h` : `${Math.round((h / 24) * 10) / 10}d`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={downloading || isLoading}>
          <Download className="h-4 w-4 mr-2" />
          {downloading ? "Downloading…" : "Export CSV"}
        </Button>
      </div>

      {/* Date range filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date range</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="this_week">This week</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
                </div>
              </>
            )}
            {(fromIso || toIso) && (
              <div className="text-xs text-muted-foreground ml-auto">
                Showing tickets {fromIso ? `from ${new Date(fromIso).toLocaleDateString("en-IN")}` : "from any date"}
                {" "}{toIso ? `to ${new Date(toIso).toLocaleDateString("en-IN")}` : "to today"}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="p-8 text-muted-foreground">Loading SLA report…</div>
      ) : !report ? (
        <div className="p-8 text-muted-foreground">No data available.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Tickets</span>
                </div>
                <div className="text-3xl font-bold">{totalTickets}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Open</span>
                </div>
                <div className="text-3xl font-bold text-blue-600">{openTickets}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Resolved</span>
                </div>
                <div className="text-3xl font-bold text-green-600">{resolvedTickets}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">SLA Breached</span>
                </div>
                <div className="text-3xl font-bold text-red-600">{slaBreachedCount}</div>
                <div className="text-xs text-muted-foreground mt-1">{breachRate}% breach rate</div>
              </CardContent>
            </Card>
          </div>

          {report.avgResolutionHours != null && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">Average Resolution Time (overall)</div>
                <div className="text-2xl font-semibold">{fmtHrs(report.avgResolutionHours)}</div>
              </CardContent>
            </Card>
          )}

          {/* Trend: average resolution time per day across the selected window. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resolution time trend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Average time to resolve, bucketed by the day a ticket was resolved.
              </p>
            </CardHeader>
            <CardContent className="pt-2">
              {trendData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resolved tickets in this window yet.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                        angle={trendData.length > 8 ? -25 : 0}
                        textAnchor={trendData.length > 8 ? "end" : "middle"}
                        height={trendData.length > 8 ? 50 : 30}
                      />
                      <YAxis tick={{ fontSize: 11 }} width={40} unit="h" />
                      <Tooltip
                        formatter={(value: number, name: string) =>
                          name === "avgHours"
                            ? [fmtHrs(value), "Avg resolution"]
                            : [value, "Tickets resolved"]
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="avgHours"
                        name="avgHours"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Stacked bar: within-SLA vs breached counts per priority. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breaches by priority</CardTitle>
                <p className="text-xs text-muted-foreground">Within-SLA vs breached, stacked per priority.</p>
              </CardHeader>
              <CardContent className="pt-2">
                {priorityChartData.every((p) => p.withinSla + p.breached === 0) ? (
                  <p className="text-sm text-muted-foreground">No tickets in this window.</p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priorityChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                        <XAxis dataKey="priority" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="withinSla" name="Within SLA" stackId="sla" fill="#10b981" />
                        <Bar dataKey="breached" name="Breached" stackId="sla" fill="#ef4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Per-assignee % within SLA, sorted worst-first. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">% within SLA by assignee</CardTitle>
                <p className="text-xs text-muted-foreground">Lower bars deserve a closer look.</p>
              </CardHeader>
              <CardContent className="pt-2">
                {assigneeChartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assigned tickets in this window.</p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={assigneeChartData}
                        layout="vertical"
                        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                        <XAxis
                          type="number"
                          domain={[0, 100]}
                          tick={{ fontSize: 11 }}
                          unit="%"
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          tick={{ fontSize: 11 }}
                          width={120}
                        />
                        <Tooltip
                          formatter={(value: number, _name, item) => {
                            const total = (item?.payload as { total?: number } | undefined)?.total ?? 0;
                            return [`${value}% (${total} tickets)`, "Within SLA"];
                          }}
                        />
                        <Bar dataKey="withinPct" name="Within SLA %" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">By Priority</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {byPriority.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : byPriority.map((row) => (
                  <div key={row.priority} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={
                        row.priority === "Urgent" ? "destructive" :
                        row.priority === "High" ? "default" :
                        "secondary"
                      }>{row.priority}</Badge>
                      <span className="text-sm">{row.count} tickets</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-muted-foreground">avg: {fmtHrs(row.avgResolutionHours)}</span>
                      {row.breached > 0 && (
                        <span className="text-red-600 font-medium">{row.breached} breached</span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {byCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : byCategory.map((row) => (
                  <div key={row.category} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline">{row.category}</Badge>
                      <span className="text-sm">{row.count}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-muted-foreground">avg: {fmtHrs(row.avgResolutionHours)}</span>
                      {(row.breached ?? 0) > 0 && (
                        <span className="text-red-600 font-medium">{row.breached} breached</span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function SlaReportPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/helpdesk">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">SLA Report</h1>
          <p className="text-sm text-muted-foreground">Helpdesk performance and SLA compliance overview</p>
        </div>
      </div>
      <SlaReportContent />
    </div>
  );
}
