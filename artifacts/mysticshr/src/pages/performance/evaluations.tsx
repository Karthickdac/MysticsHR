import { useState } from "react";
import {
  useListPerformanceCycles,
  useListPerformanceGoals,
  useListManagerEvaluations,
  useSubmitManagerEvaluation,
  useListEmployees,
  type PerformanceGoal,
  type ManagerEvaluation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Users, Star, CheckCircle2, AlertCircle } from "lucide-react";

const RATING_LABELS = ["", "Unsatisfactory", "Needs Improvement", "Meets Expectations", "Exceeds Expectations", "Outstanding"];

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`p-0.5 transition-colors ${n <= value ? "text-amber-400" : "text-gray-200 hover:text-amber-300"}`}
        >
          <Star className={`w-7 h-7 ${n <= value ? "fill-amber-400" : ""}`} />
        </button>
      ))}
    </div>
  );
}

function EvalModal({
  goal,
  employeeId,
  existing,
  open,
  onClose,
}: {
  goal: PerformanceGoal;
  employeeId: number;
  existing?: ManagerEvaluation;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const submit = useSubmitManagerEvaluation();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [commentary, setCommentary] = useState(existing?.commentary ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;
    submit.mutate(
      { data: { goalId: goal.id, employeeId, rating, commentary: commentary || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/performance/manager-evaluations"] });
          onClose();
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manager Evaluation — {goal.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Employee: {goal.employeeName} ({goal.employeeCode})</p>
            <p className="text-sm text-muted-foreground">Target: {goal.targetValue ?? "N/A"} • Weight: {goal.weightage}%</p>
          </div>
          <div>
            <Label className="mb-2 block">Rating *</Label>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && (
              <p className="text-xs text-muted-foreground mt-1">{RATING_LABELS[rating]}</p>
            )}
          </div>
          <div>
            <Label>Comments</Label>
            <Textarea
              value={commentary}
              onChange={e => setCommentary(e.target.value)}
              rows={3}
              placeholder="Provide feedback on this goal..."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submit.isPending || !rating}>
              {submit.isPending ? "Saving..." : existing ? "Update" : "Submit Evaluation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EvaluationsPage() {
  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [editItem, setEditItem] = useState<{ goal: PerformanceGoal; empId: number } | null>(null);

  const { data: cycles = [] } = useListPerformanceCycles({});
  const { data: allGoals = [], isLoading } = useListPerformanceGoals({
    cycleId: selectedCycle !== "all" ? Number(selectedCycle) : undefined,
  });
  const { data: evaluations = [] } = useListManagerEvaluations({
    cycleId: selectedCycle !== "all" ? Number(selectedCycle) : undefined,
  });

  // Get unique employees from goals
  const employeeMap = Object.fromEntries(
    allGoals.filter(g => g.employeeName).map(g => [g.employeeId, { id: g.employeeId, name: g.employeeName!, code: g.employeeCode }])
  );
  const employees = Object.values(employeeMap);

  const filteredGoals = selectedEmployee !== "all"
    ? allGoals.filter(g => g.employeeId === Number(selectedEmployee))
    : allGoals;

  const evalMap = Object.fromEntries(
    evaluations.map(e => [`${e.goalId}-${e.employeeId}`, e])
  );

  const pending = filteredGoals.filter(g => !evalMap[`${g.id}-${g.employeeId}`]);
  const evaluated = filteredGoals.filter(g => evalMap[`${g.id}-${g.employeeId}`]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" /> Team Evaluations
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Rate your team members on their KRA/KPI goals</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={selectedCycle} onValueChange={setSelectedCycle}>
          <SelectTrigger className="w-64 h-9">
            <SelectValue placeholder="Filter by cycle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cycles</SelectItem>
            {cycles.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {employees.length > 0 && (
          <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Filter by employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees.map(e => (
                <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {filteredGoals.length > 0 && (
          <Badge variant="outline" className="self-center">
            {evaluated.length}/{filteredGoals.length} evaluated
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading goals...</div>
      ) : filteredGoals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No goals found for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Pending ({pending.length})</h3>
              {pending.map(goal => (
                <Card key={`${goal.id}-${goal.employeeId}`} className="mb-2 border-orange-200">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{goal.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {goal.employeeName} ({goal.employeeCode}) • Weight: {goal.weightage}%
                        </p>
                        {goal.targetValue && <p className="text-xs text-muted-foreground">Target: {goal.targetValue}</p>}
                      </div>
                      <Button size="sm" onClick={() => setEditItem({ goal, empId: goal.employeeId })}>
                        <Star className="w-3 h-3 mr-1" /> Evaluate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {evaluated.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Evaluated ({evaluated.length})</h3>
              {evaluated.map(goal => {
                const ev = evalMap[`${goal.id}-${goal.employeeId}`];
                return (
                  <Card key={`${goal.id}-${goal.employeeId}`} className="mb-2 border-green-200 bg-green-50/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{goal.title}</p>
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {goal.employeeName} • Weight: {goal.weightage}%
                          </p>
                          <div className="flex items-center gap-1 mt-1">
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star key={n} className={`w-4 h-4 ${n <= (ev?.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
                            ))}
                            <span className="text-xs text-muted-foreground ml-1">{RATING_LABELS[ev?.rating ?? 0]}</span>
                          </div>
                          {ev?.commentary && <p className="text-sm text-muted-foreground mt-1">{ev.commentary}</p>}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setEditItem({ goal, empId: goal.employeeId })}>
                          Edit
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editItem && (
        <EvalModal
          goal={editItem.goal}
          employeeId={editItem.empId}
          existing={evalMap[`${editItem.goal.id}-${editItem.empId}`]}
          open={!!editItem}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}
