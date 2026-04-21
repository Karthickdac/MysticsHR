import {
  useListAppraisalOutcomes,
  getListAppraisalOutcomesQueryKey,
  useListPerformanceCycles,
  useListPerformanceGoals,
  getListPerformanceGoalsQueryKey,
  useListSelfAppraisals,
  getListSelfAppraisalsQueryKey,
  useListManagerEvaluations,
  getListManagerEvaluationsQueryKey,
  type PerformanceCycle,
  type PerformanceGoal,
  type SelfAppraisal,
  type ManagerEvaluation,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History, Trophy, Target, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  type TooltipProps,
} from "recharts";

const OUTCOME_COLORS: Record<string, string> = {
  "Outstanding": "bg-green-100 text-green-800 border-green-200",
  "Exceeds Expectations": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Meets Expectations": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Improvement": "bg-amber-100 text-amber-800 border-amber-200",
  "Unsatisfactory": "bg-red-100 text-red-800 border-red-200",
};

function formatScore(score: string | null | undefined): string {
  if (score === null || score === undefined) return "—";
  const n = Number(score);
  return Number.isFinite(n) ? n.toFixed(2) : String(score);
}

type TrendPoint = {
  cycleId: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  outcomeLabel: string | null;
  finalScore: number;
};

function PerformanceTrendTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload as TrendPoint | undefined;
  if (!p) return null;
  return (
    <div className="rounded-md border bg-background shadow-sm px-3 py-2 text-xs space-y-0.5">
      <p className="font-medium text-sm">{p.title}</p>
      <p className="text-muted-foreground">
        {p.startDate ?? "—"} – {p.endDate ?? "—"}
      </p>
      <p>
        Final score: <span className="font-semibold">{p.finalScore.toFixed(2)}</span>
      </p>
      {p.outcomeLabel && (
        <p className="text-muted-foreground">Outcome: {p.outcomeLabel}</p>
      )}
    </div>
  );
}

function PerformanceTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Year-over-Year Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No final scores yet — the trend will appear here once at least one cycle is finalized.
        </CardContent>
      </Card>
    );
  }

  const scores = data.map(d => d.finalScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const yMin = Math.max(0, Math.floor((min - 0.5) * 10) / 10);
  const yMax = Math.ceil((max + 0.5) * 10) / 10;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Year-over-Year Trend
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Final score across {data.length} closed {data.length === 1 ? "cycle" : "cycles"}, oldest to newest.
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
              <XAxis
                dataKey="title"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={data.length > 4 ? -20 : 0}
                textAnchor={data.length > 4 ? "end" : "middle"}
                height={data.length > 4 ? 50 : 30}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 11 }}
                width={40}
                allowDecimals
              />
              <Tooltip content={<PerformanceTrendTooltip />} />
              <Line
                type="monotone"
                dataKey="finalScore"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 4, fill: "hsl(var(--primary))" }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function CycleHistoryCard({
  cycle,
  outcome,
  goals,
  selfAppraisals,
  managerEvaluations,
}: {
  cycle: PerformanceCycle;
  outcome?: { finalScore?: string | null; outcomLabel?: string | null; normalizedScore?: string | null; calibrationNote?: string | null; calculatedAt?: string };
  goals: PerformanceGoal[];
  selfAppraisals: SelfAppraisal[];
  managerEvaluations: ManagerEvaluation[];
}) {
  const selfByGoal = new Map(selfAppraisals.map(s => [s.goalId, s]));
  const mgrByGoal = new Map(managerEvaluations.map(m => [m.goalId, m]));

  const label = outcome?.outcomLabel ?? null;
  const labelColor = label && OUTCOME_COLORS[label] ? OUTCOME_COLORS[label] : "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">{cycle.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cycle.cycleType} · {cycle.startDate} – {cycle.endDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {label && (
              <Badge variant="outline" className={labelColor}>
                <Trophy className="w-3 h-3 mr-1" /> {label}
              </Badge>
            )}
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              Final: {formatScore(outcome?.finalScore)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {outcome?.normalizedScore !== undefined && outcome?.normalizedScore !== null && (
          <div className="text-xs text-muted-foreground">
            Normalized score: <span className="font-medium text-foreground">{formatScore(outcome.normalizedScore)}</span>
            {outcome?.calculatedAt && (
              <> · Finalized {new Date(outcome.calculatedAt).toLocaleDateString()}</>
            )}
          </div>
        )}
        {outcome?.calibrationNote && (
          <div className="text-xs bg-muted/50 rounded p-2 border">
            <span className="font-medium">Calibration note: </span>{outcome.calibrationNote}
          </div>
        )}

        {goals.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-muted-foreground" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Goals & Ratings
              </h4>
            </div>
            <div className="border rounded-md divide-y">
              <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
                <div className="col-span-6">Goal</div>
                <div className="col-span-2 text-right">Weight</div>
                <div className="col-span-2 text-right">Self</div>
                <div className="col-span-2 text-right">Manager</div>
              </div>
              {goals.map(goal => {
                const self = selfByGoal.get(goal.id);
                const mgr = mgrByGoal.get(goal.id);
                return (
                  <div key={goal.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm items-center">
                    <div className="col-span-6">
                      <p className="font-medium truncate">{goal.title}</p>
                      {goal.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{goal.description}</p>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-muted-foreground">{goal.weightage}%</div>
                    <div className="col-span-2 text-right">{self?.rating ?? "—"}</div>
                    <div className="col-span-2 text-right font-medium">{mgr?.rating ?? "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No goals recorded for this cycle.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Shared performance-history view for a specific employee. Renders the YoY
 * trend chart on top and per-cycle cards below. Backend authorization
 * (HR sees everyone, HOD sees direct reports, employees see only themselves)
 * is enforced by the /performance/* APIs — this component just passes the
 * employeeId through and renders empty/error states accordingly.
 */
export default function PerformanceHistoryView({
  employeeId,
  enabled = true,
}: {
  employeeId: number | undefined;
  enabled?: boolean;
}) {
  const { data: cycles = [], isLoading: cyclesLoading } = useListPerformanceCycles({ status: "Closed" });
  const params = employeeId ? { employeeId } : undefined;
  const queryEnabled = enabled && !!employeeId;

  const { data: outcomes = [], isLoading: outcomesLoading, error: outcomesError } = useListAppraisalOutcomes(
    params,
    { query: { enabled: queryEnabled, queryKey: getListAppraisalOutcomesQueryKey(params) } },
  );
  const { data: goals = [], isLoading: goalsLoading, error: goalsError } = useListPerformanceGoals(
    params,
    { query: { enabled: queryEnabled, queryKey: getListPerformanceGoalsQueryKey(params) } },
  );
  const { data: selfAppraisals = [], error: selfError } = useListSelfAppraisals(
    params,
    { query: { enabled: queryEnabled, queryKey: getListSelfAppraisalsQueryKey(params) } },
  );
  const { data: managerEvaluations = [], error: managerError } = useListManagerEvaluations(
    params,
    { query: { enabled: queryEnabled, queryKey: getListManagerEvaluationsQueryKey(params) } },
  );

  const loading = queryEnabled && (cyclesLoading || outcomesLoading || goalsLoading);
  const subqueryError = outcomesError || goalsError || selfError || managerError;

  const cycleIdsWithData = new Set<number>();
  goals.forEach(g => cycleIdsWithData.add(g.cycleId));
  outcomes.forEach(o => cycleIdsWithData.add(o.cycleId));

  const closedCycles = cycles
    .filter(c => cycleIdsWithData.has(c.id))
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));

  const outcomeByCycle = new Map(outcomes.map(o => [o.cycleId, o]));

  const trendData = closedCycles
    .slice()
    .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""))
    .map(c => {
      const o = outcomeByCycle.get(c.id);
      const score = o?.finalScore != null ? Number(o.finalScore) : NaN;
      return {
        cycleId: c.id,
        title: c.title,
        startDate: c.startDate,
        endDate: c.endDate,
        outcomeLabel: o?.outcomLabel ?? null,
        finalScore: Number.isFinite(score) ? score : null,
      };
    })
    .filter(d => d.finalScore !== null) as TrendPoint[];

  if (!employeeId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No employee record linked.</p>
        </CardContent>
      </Card>
    );
  }
  if (loading) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">Loading history…</CardContent></Card>;
  }
  if (subqueryError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p className="text-red-600 font-medium">Couldn't load performance history.</p>
          <p className="text-xs mt-1">Please refresh the page or contact HR if the problem persists.</p>
        </CardContent>
      </Card>
    );
  }
  if (closedCycles.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No completed appraisal cycles yet.</p>
          <p className="text-xs mt-1">Past performance outcomes will appear here once a cycle is closed.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PerformanceTrendChart data={trendData} />
      {closedCycles.map(cycle => {
        const cycleGoals = goals.filter(g => g.cycleId === cycle.id);
        const cycleGoalIds = new Set(cycleGoals.map(g => g.id));
        return (
          <CycleHistoryCard
            key={cycle.id}
            cycle={cycle}
            outcome={outcomeByCycle.get(cycle.id)}
            goals={cycleGoals}
            selfAppraisals={selfAppraisals.filter(s => cycleGoalIds.has(s.goalId))}
            managerEvaluations={managerEvaluations.filter(m => cycleGoalIds.has(m.goalId))}
          />
        );
      })}
    </div>
  );
}
