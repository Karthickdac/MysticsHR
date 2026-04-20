import { useState } from "react";
import {
  useListPerformanceCycles,
  useListPerformanceGoals,
  useCreatePerformanceGoal,
  useDeletePerformanceGoal,
  useAddGoalProgress,
  useListGoalProgress,
  useListEmployees,
  type PerformanceGoal,
  type Employee,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";
import { Target, Plus, Trash2, TrendingUp, AlertCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700 border-gray-200",
  Active: "bg-green-100 text-green-700 border-green-200",
  Completed: "bg-blue-100 text-blue-700 border-blue-200",
};

function ProgressModal({ goal, open, onClose }: { goal: PerformanceGoal; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const addProgress = useAddGoalProgress();
  const { data: history = [] } = useListGoalProgress(goal.id);
  const [pct, setPct] = useState(String(goal.progressPercent ?? 0));
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    addProgress.mutate(
      { id: goal.id, data: { progressPercent: Number(pct), commentary: note || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/performance/goals"] });
          qc.invalidateQueries({ queryKey: [`/performance/goals/${goal.id}/progress`] });
          setNote("");
          onClose();
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Progress — {goal.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Progress %</Label>
            <Input
              type="number" min={0} max={100} value={pct}
              onChange={e => setPct(e.target.value)} required
            />
            <Progress value={Number(pct)} className="mt-2 h-2" />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>

          {history.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">History</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {history.map(h => (
                  <div key={h.id} className="text-xs text-muted-foreground flex justify-between">
                    <span>{h.progressPercent}% — {h.commentary ?? "No note"}</span>
                    <span>{new Date(h.updatedAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={addProgress.isPending}>
              {addProgress.isPending ? "Saving..." : "Update Progress"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GoalCard({ goal, canManage, canDelete }: { goal: PerformanceGoal; canManage: boolean; canDelete: boolean }) {
  const qc = useQueryClient();
  const deleteGoal = useDeletePerformanceGoal();
  const [showProgress, setShowProgress] = useState(false);

  function handleDelete() {
    if (!confirm("Delete this goal?")) return;
    deleteGoal.mutate({ id: goal.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["/performance/goals"] }) });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium">{goal.title}</span>
              <Badge variant="outline" className={STATUS_COLORS[goal.status] ?? ""}>{goal.status}</Badge>
              <Badge variant="outline" className="text-xs">Weight: {goal.weightage}%</Badge>
            </div>
            {goal.employeeName && (
              <p className="text-xs text-muted-foreground mb-1">
                Employee: {goal.employeeName} ({goal.employeeCode})
              </p>
            )}
            {goal.description && <p className="text-sm text-muted-foreground mb-2">{goal.description}</p>}
            {goal.targetValue && <p className="text-xs text-muted-foreground">Target: {goal.targetValue}</p>}
            {goal.measurementMethod && <p className="text-xs text-muted-foreground">Measurement: {goal.measurementMethod}</p>}

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Progress</span>
                <span className="text-xs font-medium">{goal.progressPercent ?? 0}%</span>
              </div>
              <Progress value={goal.progressPercent ?? 0} className="h-1.5" />
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowProgress(true)}>
              <TrendingUp className="w-3 h-3 mr-1" /> Update
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleteGoal.isPending}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
      {showProgress && <ProgressModal goal={goal} open={showProgress} onClose={() => setShowProgress(false)} />}
    </Card>
  );
}

function AssignGoalModal({ open, onClose, cycleId }: { open: boolean; onClose: () => void; cycleId?: number }) {
  const qc = useQueryClient();
  const create = useCreatePerformanceGoal();
  const { data: employeeResponse } = useListEmployees({ status: "Active", limit: 200, offset: 0 });
  const { data: cycles = [] } = useListPerformanceCycles({});
  const [form, setForm] = useState({
    cycleId: cycleId ? String(cycleId) : "",
    employeeId: "",
    title: "",
    description: "",
    weightage: "10",
    targetValue: "",
    measurementMethod: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.cycleId) return;
    create.mutate({
      data: {
        cycleId: Number(form.cycleId),
        employeeId: Number(form.employeeId),
        title: form.title,
        description: form.description || null,
        weightage: Number(form.weightage),
        targetValue: form.targetValue || null,
        measurementMethod: form.measurementMethod || null,
        status: "Active",
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/performance/goals"] });
        onClose();
        setForm({ cycleId: cycleId ? String(cycleId) : "", employeeId: "", title: "", description: "", weightage: "10", targetValue: "", measurementMethod: "" });
      },
    });
  }

  const employeeList: Employee[] = employeeResponse?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign KRA/KPI Goal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Performance Cycle *</Label>
            <Select value={form.cycleId} onValueChange={v => setForm(f => ({ ...f, cycleId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select cycle" />
              </SelectTrigger>
              <SelectContent>
                {cycles.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Employee *</Label>
              <Select value={form.employeeId} onValueChange={v => setForm(f => ({ ...f, employeeId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employeeList.map((e: Employee) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.firstName} {e.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Weightage % *</Label>
              <Input type="number" min={1} max={100} value={form.weightage} onChange={e => setForm(f => ({ ...f, weightage: e.target.value }))} required />
            </div>
          </div>
          <div>
            <Label>Goal Title (KRA/KPI) *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Revenue Achievement" required />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Target Value</Label>
              <Input value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} placeholder="e.g. ₹50L or 95%" />
            </div>
            <div>
              <Label>Measurement</Label>
              <Input value={form.measurementMethod} onChange={e => setForm(f => ({ ...f, measurementMethod: e.target.value }))} placeholder="e.g. Revenue Report" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.cycleId || !form.employeeId || !form.title}>
              {create.isPending ? "Assigning..." : "Assign Goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function GoalsPage() {
  const { role } = useCurrentHrmsUser();
  const isManager = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]);
  const isHR = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [showAssign, setShowAssign] = useState(false);

  const { data: cycles = [] } = useListPerformanceCycles({});
  const { data: goals = [], isLoading } = useListPerformanceGoals({
    cycleId: selectedCycle !== "all" ? Number(selectedCycle) : undefined,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" /> KRA / KPI Goals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track key result areas and performance indicators</p>
        </div>
        {isManager && (
          <Button onClick={() => setShowAssign(true)}>
            <Plus className="w-4 h-4 mr-1" /> Assign Goal
          </Button>
        )}
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
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading goals...</div>
      ) : goals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No goals found for the selected filter.</p>
            {isManager && (
              <Button variant="outline" className="mt-4" onClick={() => setShowAssign(true)}>
                Assign First Goal
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              canManage={isManager}
              canDelete={isHR}
            />
          ))}
        </div>
      )}

      <AssignGoalModal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        cycleId={selectedCycle !== "all" ? Number(selectedCycle) : undefined}
      />
    </div>
  );
}
