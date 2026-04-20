import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetOnboardingChecklistsId,
  usePatchOnboardingTasksId,
  usePostOnboardingTasksIdComplete,
  usePostOnboardingTasksIdUncomplete,
  useDeleteOnboardingTasksId,
  usePostOnboardingChecklistsIdTasks,
  useGetEmployeesIdInductionSessions,
  usePostEmployeesIdInductionSessions,
  useDeleteInductionSessionsId,
  getGetOnboardingChecklistsIdQueryKey,
  getGetEmployeesIdInductionSessionsQueryKey,
} from "@workspace/api-client-react";
import type { OnboardingTask, InductionSession } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, CheckCircle2, Circle, Plus, Trash2, Download,
  GraduationCap, ClipboardList, Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";

const TASK_CATEGORY_COLORS: Record<string, string> = {
  HR: "bg-blue-100 text-blue-700",
  IT: "bg-purple-100 text-purple-700",
  Department: "bg-amber-100 text-amber-700",
  Employee: "bg-green-100 text-green-700",
};

function TaskCard({
  task,
  canManage,
  isEmployee,
  onComplete,
  onUncomplete,
  onDelete,
}: {
  task: OnboardingTask;
  canManage: boolean;
  isEmployee: boolean;
  onComplete: (id: number) => void;
  onUncomplete: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const isDone = !!task.completedAt;
  const canComplete = canManage || (isEmployee && task.assigneeRole === "employee");
  const canUncomplete = canManage;
  const canToggle = isDone ? canUncomplete : canComplete;
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${isDone ? "border-green-200 bg-green-50" : "border-border bg-background"}`}>
      <button
        onClick={() => isDone ? onUncomplete(task.id) : onComplete(task.id)}
        className="mt-0.5 flex-shrink-0"
        disabled={!canToggle}
      >
        {isDone
          ? <CheckCircle2 className="w-5 h-5 text-green-500" />
          : <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
        {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {task.assigneeRole && <span className="text-xs text-muted-foreground capitalize">{task.assigneeRole.replace("_", " ")}</span>}
          {task.dueDate && <span className="text-xs text-muted-foreground">· Due {task.dueDate}</span>}
          {isDone && task.completedAt && <span className="text-xs text-green-600">· Completed {format(new Date(task.completedAt), "dd MMM yyyy")}</span>}
        </div>
      </div>
      {canManage && (
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive flex-shrink-0" onClick={() => onDelete(task.id)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const checklistId = parseInt(id, 10);
  const qc = useQueryClient();
  const { role } = useCurrentHrmsUser();
  const canManage = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]);
  const isEmployee = role === "employee";

  const { data: detail, isLoading } = useGetOnboardingChecklistsId(checklistId);
  const complete = usePostOnboardingTasksIdComplete({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetOnboardingChecklistsIdQueryKey(checklistId) }) } });
  const uncomplete = usePostOnboardingTasksIdUncomplete({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetOnboardingChecklistsIdQueryKey(checklistId) }) } });
  const deleteTask = useDeleteOnboardingTasksId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetOnboardingChecklistsIdQueryKey(checklistId) }) } });
  const addTask = usePostOnboardingChecklistsIdTasks({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetOnboardingChecklistsIdQueryKey(checklistId) }); setAddOpen(false); } } });

  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("HR");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const employeeId = detail?.checklist?.employeeId;
  const { data: sessions = [] } = useGetEmployeesIdInductionSessions(employeeId ?? 0);
  const addSession = usePostEmployeesIdInductionSessions({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetEmployeesIdInductionSessionsQueryKey(employeeId ?? 0) }); setSessionOpen(false); } } });
  const deleteSession = useDeleteInductionSessionsId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdInductionSessionsQueryKey(employeeId ?? 0) }) } });

  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionDate, setSessionDate] = useState("");
  const [trainerName, setTrainerName] = useState("");
  const [topics, setTopics] = useState("");
  const [duration, setDuration] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!detail) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Checklist not found.</p>
        <Link href="/onboarding"><Button variant="outline" className="mt-4">Back to Onboarding</Button></Link>
      </div>
    );
  }

  const { checklist, tasks } = detail;
  const categories = ["HR", "IT", "Department", "Employee"] as const;
  const canDownloadIdCard = checklist.completionPercentage === 100;

  function saveTask() {
    addTask.mutate({ id: checklistId, data: { title: newTitle, category: newCategory as "HR" | "IT" | "Department" | "Employee", assigneeRole: newAssignee || null, dueDate: newDueDate || null, description: newDescription || null } });
    setNewTitle(""); setNewCategory("HR"); setNewAssignee(""); setNewDueDate(""); setNewDescription("");
  }

  function saveSession() {
    if (!employeeId) return;
    addSession.mutate({ id: employeeId, data: { sessionDate, trainerName, topics: topics || null, durationMinutes: duration ? parseInt(duration, 10) : null, notes: sessionNotes || null } });
    setSessionDate(""); setTrainerName(""); setTopics(""); setDuration(""); setSessionNotes("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/onboarding">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="w-4 h-4" />Onboarding</Button>
        </Link>
      </div>

      {/* Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-xl font-bold">{checklist.employeeName ?? "Employee"}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground border border-border rounded px-2 py-0.5">{checklist.employeeCode}</span>
                {checklist.departmentName && <span className="text-sm text-muted-foreground">· {checklist.departmentName}</span>}
                {checklist.joiningDate && <span className="text-sm text-muted-foreground">· Joining: {checklist.joiningDate}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {canDownloadIdCard && (
                <a href={`/api/employees/${employeeId}/id-card`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="gap-2"><Download className="w-4 h-4" />Download ID Card</Button>
                </a>
              )}
              {employeeId && (
                <Link href={`/employees/${employeeId}`}>
                  <Button variant="outline" size="sm">View Profile</Button>
                </Link>
              )}
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Onboarding Progress</span>
              <span className="font-semibold">{checklist.completionPercentage}%</span>
            </div>
            <Progress value={checklist.completionPercentage} className="h-2.5" />
            <Badge variant={checklist.status === "Completed" ? "default" : "secondary"}>{checklist.status}</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks"><ClipboardList className="w-3.5 h-3.5 mr-1.5" />Tasks ({(tasks as OnboardingTask[]).length})</TabsTrigger>
          <TabsTrigger value="induction"><GraduationCap className="w-3.5 h-3.5 mr-1.5" />Induction Sessions ({(sessions as InductionSession[]).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex justify-end">
            {canManage && (
              <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Add Task</Button>
            )}
          </div>
          {categories.map((cat) => {
            const catTasks = (tasks as OnboardingTask[]).filter((t) => t.category === cat);
            if (catTasks.length === 0) return null;
            const catDone = catTasks.filter((t) => t.completedAt).length;
            return (
              <Card key={cat}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TASK_CATEGORY_COLORS[cat]}`}>{cat}</span>
                      <span className="text-sm text-muted-foreground">{catDone}/{catTasks.length}</span>
                    </div>
                    <Progress value={(catDone / catTasks.length) * 100} className="h-1.5 w-20" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {catTasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      canManage={canManage}
                      isEmployee={isEmployee}
                      onComplete={(tid) => complete.mutate({ id: tid, data: {} })}
                      onUncomplete={(tid) => uncomplete.mutate({ id: tid })}
                      onDelete={(tid) => deleteTask.mutate({ id: tid })}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Onboarding Task</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Title *</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Category *</Label>
                    <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                      {["HR", "IT", "Department", "Employee"].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label>Assignee Role</Label><Input value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="e.g. hr_executive" /></div>
                </div>
                <div className="space-y-1.5"><Label>Due Date</Label><Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Description</Label><Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={2} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={saveTask} disabled={!newTitle || addTask.isPending}>Add Task</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="induction" className="space-y-4">
          <div className="flex justify-end">
            {canManage && (
              <Button size="sm" onClick={() => setSessionOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Record Session</Button>
            )}
          </div>

          {(sessions as InductionSession[]).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
              <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No induction sessions recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(sessions as InductionSession[]).map((s) => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{s.sessionDate}</span>
                          {s.durationMinutes && <Badge variant="outline" className="text-xs">{s.durationMinutes} min</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Trainer: {s.trainerName}</p>
                        {s.topics && <p className="text-sm mt-1">{s.topics}</p>}
                        {s.notes && <p className="text-xs text-muted-foreground mt-1">{s.notes}</p>}
                      </div>
                      {canManage && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteSession.mutate({ id: s.id })}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Record Induction Session</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Session Date *</Label><Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Trainer Name *</Label><Input value={trainerName} onChange={(e) => setTrainerName(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5"><Label>Topics Covered</Label><Textarea value={topics} onChange={(e) => setTopics(e.target.value)} rows={2} /></div>
                <div className="space-y-1.5"><Label>Duration (minutes)</Label><Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Notes</Label><Textarea value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} rows={2} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSessionOpen(false)}>Cancel</Button>
                <Button onClick={saveSession} disabled={!sessionDate || !trainerName || addSession.isPending}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
