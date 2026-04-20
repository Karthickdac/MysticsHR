import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListPerformanceCycles,
  useCreatePerformanceCycle,
  useAdvancePerformanceCycleStage,
  useListPerformanceGoals,
  type PerformanceCycle,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";
import {
  Target, Plus, ArrowRight, ChevronRight, Activity, Users, CheckCircle2, Clock,
} from "lucide-react";

const STAGE_ORDER = [
  "Goal Setting", "Mid Review", "Self Appraisal",
  "Manager Evaluation", "Calibration", "Completed",
];

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700 border-gray-200",
  Active: "bg-green-100 text-green-700 border-green-200",
  Closed: "bg-blue-100 text-blue-700 border-blue-200",
};

const STAGE_COLORS: Record<string, string> = {
  "Goal Setting": "bg-violet-100 text-violet-700",
  "Mid Review": "bg-sky-100 text-sky-700",
  "Self Appraisal": "bg-amber-100 text-amber-700",
  "Manager Evaluation": "bg-orange-100 text-orange-700",
  "Calibration": "bg-rose-100 text-rose-700",
  "Completed": "bg-green-100 text-green-700",
};

function StageProgress({ current }: { current: string }) {
  const idx = STAGE_ORDER.indexOf(current);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STAGE_ORDER.map((stage, i) => (
        <div key={stage} className="flex items-center gap-1">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              i < idx ? "bg-gray-100 text-gray-400" :
              i === idx ? STAGE_COLORS[stage] :
              "bg-gray-50 text-gray-300"
            }`}
          >
            {stage}
          </span>
          {i < STAGE_ORDER.length - 1 && (
            <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

function CycleCard({ cycle, isHR }: { cycle: PerformanceCycle; isHR: boolean }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const advance = useAdvancePerformanceCycleStage();

  function handleAdvance(e: React.MouseEvent) {
    e.stopPropagation();
    advance.mutate({ id: cycle.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["/performance/cycles"] }) });
  }

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/performance/cycles/${cycle.id}`)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-base">{cycle.title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{cycle.cycleType} • {cycle.startDate} to {cycle.endDate}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className={STATUS_COLORS[cycle.status]}>{cycle.status}</Badge>
          </div>
        </div>

        <div className="mb-4">
          <StageProgress current={cycle.currentStage} />
        </div>

        {cycle.description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{cycle.description}</p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Created {new Date(cycle.createdAt).toLocaleDateString()}
          </span>
          {isHR && cycle.currentStage !== "Completed" && cycle.status !== "Closed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAdvance}
              disabled={advance.isPending}
              className="text-xs h-7"
            >
              Advance Stage <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateCycleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreatePerformanceCycle();
  const [form, setForm] = useState({
    title: "", cycleType: "Annual", startDate: "", endDate: "", description: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({ data: { ...form, status: "Draft" } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/performance/cycles"] });
        onClose();
        setForm({ title: "", cycleType: "Annual", startDate: "", endDate: "", description: "" });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Performance Cycle</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. FY 2025-26 Annual Appraisal" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cycle Type *</Label>
              <Select value={form.cycleType} onValueChange={v => setForm(f => ({ ...f, cycleType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Annual">Annual</SelectItem>
                  <SelectItem value="Semi-Annual">Semi-Annual</SelectItem>
                  <SelectItem value="Quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date *</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
            </div>
            <div>
              <Label>End Date *</Label>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Create Cycle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PerformancePage() {
  const { role, isLoading } = useCurrentHrmsUser();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const isHR = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const { data: cycles = [], isLoading: loadingCycles } = useListPerformanceCycles({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const activeCycles = cycles.filter(c => c.status === "Active");
  const draftCycles = cycles.filter(c => c.status === "Draft");
  const closedCycles = cycles.filter(c => c.status === "Closed");

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" />
            Performance Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage appraisal cycles, KRA/KPI goals, and reviews
          </p>
        </div>
        <div className="flex gap-2">
          {isHR && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> New Cycle
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <Activity className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeCycles.length}</p>
              <p className="text-sm text-muted-foreground">Active Cycles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-100">
              <Clock className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{draftCycles.length}</p>
              <p className="text-sm text-muted-foreground">Draft Cycles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{closedCycles.length}</p>
              <p className="text-sm text-muted-foreground">Closed Cycles</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation shortcuts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/performance/goals">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardContent className="p-4 text-center">
              <Target className="w-5 h-5 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">My Goals</p>
              <p className="text-xs text-muted-foreground">View KRA/KPI targets</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/performance/appraisals">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardContent className="p-4 text-center">
              <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-amber-600" />
              <p className="text-sm font-medium">Self Appraisal</p>
              <p className="text-xs text-muted-foreground">Submit self ratings</p>
            </CardContent>
          </Card>
        </Link>
        {hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]) && (
          <Link href="/performance/evaluations">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-4 text-center">
                <Users className="w-5 h-5 mx-auto mb-2 text-orange-600" />
                <p className="text-sm font-medium">Team Evaluation</p>
                <p className="text-xs text-muted-foreground">Rate your team members</p>
              </CardContent>
            </Card>
          </Link>
        )}
        {isHR && (
          <Link href="/performance/calibration">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-4 text-center">
                <Activity className="w-5 h-5 mx-auto mb-2 text-rose-600" />
                <p className="text-sm font-medium">Calibration</p>
                <p className="text-xs text-muted-foreground">Review & finalize scores</p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {/* Cycles list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Appraisal Cycles</h2>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loadingCycles ? (
          <div className="text-sm text-muted-foreground">Loading cycles...</div>
        ) : cycles.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No performance cycles found.</p>
              {isHR && (
                <Button variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>
                  Create First Cycle
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {cycles.map(cycle => (
              <CycleCard key={cycle.id} cycle={cycle} isHR={isHR} />
            ))}
          </div>
        )}
      </div>

      <CreateCycleModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
