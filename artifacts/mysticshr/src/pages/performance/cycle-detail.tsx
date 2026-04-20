import { useRoute, useLocation } from "wouter";
import {
  useGetPerformanceCycle,
  useAdvancePerformanceCycleStage,
  useListPerformanceGoals,
  type PerformanceGoal,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";
import { ArrowLeft, ChevronRight, Target, BarChart2 } from "lucide-react";

const STAGES = ["Goal Setting", "Self Appraisal", "Manager Review", "Calibration", "Completed"] as const;
type Stage = typeof STAGES[number];

const STAGE_COLORS: Record<Stage, string> = {
  "Goal Setting": "bg-blue-100 text-blue-700",
  "Self Appraisal": "bg-amber-100 text-amber-700",
  "Manager Review": "bg-orange-100 text-orange-700",
  "Calibration": "bg-violet-100 text-violet-700",
  "Completed": "bg-green-100 text-green-700",
};

function GoalRow({ goal }: { goal: PerformanceGoal }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{goal.title}</p>
        {goal.employeeName && (
          <p className="text-xs text-muted-foreground">{goal.employeeName}</p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-20">
          <Progress value={goal.progressPercent ?? 0} className="h-1.5" />
        </div>
        <span className="text-xs text-muted-foreground w-8 text-right">{goal.progressPercent ?? 0}%</span>
        <Badge variant="outline" className="text-xs">{goal.weightage}%</Badge>
      </div>
    </div>
  );
}

export default function CycleDetailPage() {
  const [, params] = useRoute("/performance/cycles/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { role } = useCurrentHrmsUser();
  const isHR = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const cycleId = Number(params?.id);
  const { data: cycle, isLoading } = useGetPerformanceCycle(cycleId);
  const { data: goals = [] } = useListPerformanceGoals({ cycleId });
  const advance = useAdvancePerformanceCycleStage();

  if (isLoading) return <div className="p-6">Loading cycle...</div>;
  if (!cycle) return <div className="p-6 text-muted-foreground">Cycle not found.</div>;

  const currentStageIdx = STAGES.indexOf(cycle.currentStage as Stage);
  const stagePercent = currentStageIdx >= 0 ? Math.round(((currentStageIdx + 1) / STAGES.length) * 100) : 0;
  const canAdvance = isHR && currentStageIdx >= 0 && currentStageIdx < STAGES.length - 1;

  function handleAdvance() {
    if (!confirm("Advance this cycle to the next stage?")) return;
    advance.mutate({ id: cycleId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: [`/performance/cycles/${cycleId}`] }),
    });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => navigate("/performance")}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{cycle.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {cycle.startDate} – {cycle.endDate}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={STAGE_COLORS[cycle.currentStage as Stage] ?? ""}
          >
            {cycle.currentStage}
          </Badge>
          <Badge variant="outline">{cycle.status}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="w-4 h-4" /> Stage Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            {STAGES.map((stage, i) => (
              <div key={stage} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={`flex-1 text-center ${i === currentStageIdx ? "font-semibold" : "text-muted-foreground"}`}>
                  <div
                    className={`h-2 rounded-full mb-1 ${
                      i <= currentStageIdx ? "bg-primary" : "bg-muted"
                    }`}
                  />
                  <p className="text-xs truncate hidden sm:block">{stage}</p>
                </div>
                {i < STAGES.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              </div>
            ))}
          </div>
          <Progress value={stagePercent} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Stage {currentStageIdx + 1} of {STAGES.length}: {cycle.currentStage}
          </p>
          {canAdvance && (
            <Button
              size="sm"
              className="mt-3"
              onClick={handleAdvance}
              disabled={advance.isPending}
            >
              {advance.isPending ? "Advancing..." : "Advance to Next Stage"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" /> Goals in this Cycle ({goals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No goals assigned to this cycle yet.</p>
          ) : (
            <div>
              {goals.map(goal => (
                <GoalRow key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
