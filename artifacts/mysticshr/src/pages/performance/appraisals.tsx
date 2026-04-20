import { useState } from "react";
import {
  useListPerformanceCycles,
  useListPerformanceGoals,
  useListSelfAppraisals,
  useSubmitSelfAppraisal,
  type PerformanceGoal,
  type SelfAppraisal,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Star, AlertCircle } from "lucide-react";

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

function AppraisalModal({
  goal,
  existing,
  open,
  onClose,
}: {
  goal: PerformanceGoal;
  existing?: SelfAppraisal;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const submit = useSubmitSelfAppraisal();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [commentary, setCommentary] = useState(existing?.commentary ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;
    submit.mutate(
      { data: { goalId: goal.id, rating, commentary: commentary || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/performance/self-appraisals"] });
          onClose();
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Self Appraisal — {goal.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Target: {goal.targetValue ?? "N/A"}</p>
            <p className="text-sm text-muted-foreground">Weight: {goal.weightage}%</p>
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
              placeholder="Describe your achievements against this goal..."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submit.isPending || !rating}>
              {submit.isPending ? "Submitting..." : existing ? "Update Appraisal" : "Submit Appraisal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AppraisalsPage() {
  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [editGoal, setEditGoal] = useState<PerformanceGoal | null>(null);

  const { data: cycles = [] } = useListPerformanceCycles({});
  const { data: goals = [], isLoading: loadingGoals } = useListPerformanceGoals({
    cycleId: selectedCycle !== "all" ? Number(selectedCycle) : undefined,
  });
  const { data: appraisals = [] } = useListSelfAppraisals({
    cycleId: selectedCycle !== "all" ? Number(selectedCycle) : undefined,
  });

  const appraisalMap = Object.fromEntries(appraisals.map(a => [a.goalId, a]));
  const submitted = goals.filter(g => appraisalMap[g.id]);
  const pending = goals.filter(g => !appraisalMap[g.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-primary" /> Self Appraisal
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Rate your performance against assigned goals</p>
      </div>

      <div className="flex gap-3">
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
        {goals.length > 0 && (
          <Badge variant="outline" className="self-center">
            {submitted.length}/{goals.length} submitted
          </Badge>
        )}
      </div>

      {loadingGoals ? (
        <div className="text-sm text-muted-foreground">Loading goals...</div>
      ) : goals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No goals assigned yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                Pending ({pending.length})
              </h3>
              {pending.map(goal => (
                <Card key={goal.id} className="mb-2 border-amber-200">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{goal.title}</p>
                        <p className="text-xs text-muted-foreground">Weight: {goal.weightage}% • Target: {goal.targetValue ?? "N/A"}</p>
                        {goal.description && <p className="text-sm text-muted-foreground mt-1">{goal.description}</p>}
                      </div>
                      <Button size="sm" onClick={() => setEditGoal(goal)}>
                        <Star className="w-3 h-3 mr-1" /> Rate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {submitted.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                Submitted ({submitted.length})
              </h3>
              {submitted.map(goal => {
                const appraisal = appraisalMap[goal.id];
                return (
                  <Card key={goal.id} className="mb-2 border-green-200 bg-green-50/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{goal.title}</p>
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                          <p className="text-xs text-muted-foreground">Weight: {goal.weightage}%</p>
                          <div className="flex items-center gap-1 mt-1">
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star key={n} className={`w-4 h-4 ${n <= (appraisal?.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
                            ))}
                            <span className="text-xs text-muted-foreground ml-1">{RATING_LABELS[appraisal?.rating ?? 0]}</span>
                          </div>
                          {appraisal?.commentary && (
                            <p className="text-sm text-muted-foreground mt-1">{appraisal.commentary}</p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setEditGoal(goal)}>
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

      {editGoal && (
        <AppraisalModal
          goal={editGoal}
          existing={appraisalMap[editGoal.id]}
          open={!!editGoal}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}
