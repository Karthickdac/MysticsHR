import { useState } from "react";
import {
  useGetShiftsTemplates,
  usePostShiftsTemplates,
  usePatchShiftsTemplatesId,
  useDeleteShiftsTemplatesId,
  useGetShiftSwaps,
  usePostShiftSwapsIdHodAction,
  usePostShiftSwapsIdHrAction,
  useListEmployees,
  useGetEmployeesIdShiftAssignments,
  usePostEmployeesIdShiftAssignments,
  useDeleteShiftAssignmentsId,
  getGetShiftsTemplatesQueryKey,
  getGetShiftSwapsQueryKey,
  getGetEmployeesIdShiftAssignmentsQueryKey,
} from "@workspace/api-client-react";
import type { GetShiftsTemplatesQueryResult, GetShiftSwapsQueryResult, GetEmployeesIdShiftAssignmentsQueryResult, Employee } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Clock, CheckCircle, XCircle, Calendar } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Link } from "wouter";

type ShiftTemplate = GetShiftsTemplatesQueryResult[number];
type ShiftSwap = GetShiftSwapsQueryResult[number];
type ShiftAssignment = GetEmployeesIdShiftAssignmentsQueryResult[number];

const SHIFT_TYPES = ["Fixed", "Flexible", "Rotational", "Night Shift"] as const;
const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface TemplateFormValue {
  name: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  minWorkingHoursMinutes: number;
  overtimeThresholdMinutes: number;
  weeklyOff: string[];
  notes: string;
  [key: string]: unknown;
}

const statusColors: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
};

function TemplateForm({ initial, onSave, onCancel, saving, error }: {
  initial: TemplateFormValue; onSave: (v: TemplateFormValue) => void; onCancel: () => void; saving: boolean; error: string;
}) {
  const [form, setForm] = useState(initial);
  const [weeklyOff, setWeeklyOff] = useState<string[]>(initial.weeklyOff ?? []);

  function toggle(day: string) {
    setWeeklyOff(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Name *</Label>
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <Label>Shift Type</Label>
          <Select value={form.shiftType} onValueChange={v => setForm({ ...form, shiftType: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SHIFT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Start Time *</Label>
          <Input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} />
        </div>
        <div>
          <Label>End Time *</Label>
          <Input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} />
        </div>
        <div>
          <Label>Grace Period (min)</Label>
          <Input type="number" value={form.gracePeriodMinutes} onChange={e => setForm({ ...form, gracePeriodMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Break Duration (min)</Label>
          <Input type="number" value={form.breakDurationMinutes} onChange={e => setForm({ ...form, breakDurationMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Min Working Hours (min)</Label>
          <Input type="number" value={form.minWorkingHoursMinutes} onChange={e => setForm({ ...form, minWorkingHoursMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <Label>OT Threshold (min)</Label>
          <Input type="number" value={form.overtimeThresholdMinutes} onChange={e => setForm({ ...form, overtimeThresholdMinutes: Number(e.target.value) })} />
        </div>
        <div className="col-span-2">
          <Label>Notes</Label>
          <Textarea value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
      </div>
      <div>
        <Label className="mb-1 block">Weekly Off Days</Label>
        <div className="flex flex-wrap gap-2">
          {WEEK_DAYS.map(day => (
            <button key={day} type="button" onClick={() => toggle(day)}
              className={`text-xs px-2 py-1 rounded border ${weeklyOff.includes(day) ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave({ ...form, weeklyOff })} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function ShiftsPage() {
  const qc = useQueryClient();
  const { role } = useCurrentUser();
  const canManage = ["super_admin", "hr_manager", "hr_executive"].includes(role ?? "");
  const canApproveHod = ["super_admin", "hr_manager", "hr_executive", "hod"].includes(role ?? "");

  const { data: templates = [], isLoading: tLoading } = useGetShiftsTemplates();
  const { data: swaps = [], isLoading: swapLoading } = useGetShiftSwaps({});
  const { data: _empResponse } = useListEmployees({});
  const employees = _empResponse?.data ?? [];

  const createTmpl = usePostShiftsTemplates();
  const patchTmpl = usePatchShiftsTemplatesId();
  const deleteTmpl = useDeleteShiftsTemplatesId();
  const hodAction = usePostShiftSwapsIdHodAction();
  const hrAction = usePostShiftSwapsIdHrAction();

  const [showTmplForm, setShowTmplForm] = useState(false);
  const [editingTmpl, setEditingTmpl] = useState<ShiftTemplate | null>(null);
  const [tmplError, setTmplError] = useState("");
  const [swapAction, setSwapAction] = useState<{ id: number; type: "hod" | "hr" } | null>(null);
  const [actionRemarks, setActionRemarks] = useState("");

  const blankTemplate = { name: "", shiftType: "Fixed", startTime: "09:00", endTime: "18:00", gracePeriodMinutes: 5, breakDurationMinutes: 30, minWorkingHoursMinutes: 480, overtimeThresholdMinutes: 30, weeklyOff: ["Saturday", "Sunday"], notes: "" };

  // Assignment tab state
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null);
  const [assignForm, setAssignForm] = useState({ shiftTemplateId: 0, effectiveFrom: "", effectiveTo: "" });
  const [assignError, setAssignError] = useState("");
  const { data: assignments = [] } = useGetEmployeesIdShiftAssignments(selectedEmpId ?? 0, { query: { enabled: !!selectedEmpId, queryKey: getGetEmployeesIdShiftAssignmentsQueryKey(selectedEmpId ?? 0) } });
  const createAssign = usePostEmployeesIdShiftAssignments();
  const deleteAssign = useDeleteShiftAssignmentsId();

  async function handleSaveTemplate(data: TemplateFormValue) {
    setTmplError("");
    if (!data.name || !data.startTime || !data.endTime) { setTmplError("Name, start time, and end time are required"); return; }
    try {
      const apiData = { ...data, shiftType: data.shiftType as "Fixed" | "Flexible" | "Rotational" | "Night Shift" };
      if (editingTmpl) {
        await patchTmpl.mutateAsync({ id: editingTmpl.id, data: apiData });
      } else {
        await createTmpl.mutateAsync({ data: apiData });
      }
      await qc.invalidateQueries({ queryKey: getGetShiftsTemplatesQueryKey() });
      setShowTmplForm(false);
      setEditingTmpl(null);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setTmplError(err?.message ?? "Failed to save");
    }
  }

  async function handleDeleteTemplate(id: number) {
    if (!confirm("Delete this shift template?")) return;
    await deleteTmpl.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getGetShiftsTemplatesQueryKey() });
  }

  async function handleSwapAction(action: "Approved" | "Rejected") {
    if (!swapAction) return;
    try {
      if (swapAction.type === "hod") {
        await hodAction.mutateAsync({ id: swapAction.id, data: { action, remarks: actionRemarks || undefined } });
      } else {
        await hrAction.mutateAsync({ id: swapAction.id, data: { action, remarks: actionRemarks || undefined } });
      }
      await qc.invalidateQueries({ queryKey: getGetShiftSwapsQueryKey({}) });
      setSwapAction(null);
      setActionRemarks("");
    } catch (e: unknown) {
      const err = e as { message?: string };
      alert(err?.message ?? "Action failed");
    }
  }

  async function handleAssign() {
    setAssignError("");
    if (!selectedEmpId || !assignForm.shiftTemplateId || !assignForm.effectiveFrom) {
      setAssignError("Employee, shift template and effective from are required");
      return;
    }
    try {
      await createAssign.mutateAsync({ id: selectedEmpId, data: { shiftTemplateId: assignForm.shiftTemplateId, effectiveFrom: assignForm.effectiveFrom, effectiveTo: assignForm.effectiveTo || undefined } });
      await qc.invalidateQueries({ queryKey: getGetEmployeesIdShiftAssignmentsQueryKey(selectedEmpId) });
      setAssignForm({ shiftTemplateId: 0, effectiveFrom: "", effectiveTo: "" });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setAssignError(err?.message ?? "Failed to assign");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Shift Management</h1>
        <Link href="/shifts/calendar">
          <Button variant="outline"><Calendar className="w-4 h-4 mr-2" />Shift Calendar</Button>
        </Link>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Shift Templates</TabsTrigger>
          {canManage && <TabsTrigger value="assignments">Assign Shifts</TabsTrigger>}
          <TabsTrigger value="swaps">Swap Requests</TabsTrigger>
        </TabsList>

        {/* TEMPLATES TAB */}
        <TabsContent value="templates" className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => { setEditingTmpl(null); setTmplError(""); setShowTmplForm(true); }}>
                <Plus className="w-4 h-4 mr-2" />New Template
              </Button>
            </div>
          )}
          {tLoading ? <p className="text-muted-foreground">Loading...</p> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{t.name}</CardTitle>
                      <Badge variant="outline">{t.shiftType}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{t.startTime} – {t.endTime}</div>
                    <div>Grace: {t.gracePeriodMinutes}min | Break: {t.breakDurationMinutes}min</div>
                    <div>Min Hours: {Math.floor(t.minWorkingHoursMinutes / 60)}h {t.minWorkingHoursMinutes % 60}m</div>
                    {t.weeklyOff && t.weeklyOff.length > 0 && <div>Off: {t.weeklyOff.map((d: string) => d.slice(0, 3)).join(", ")}</div>}
                    <div className={`mt-1 font-medium ${t.isActive ? "text-green-600" : "text-gray-400"}`}>{t.isActive ? "Active" : "Inactive"}</div>
                    {canManage && (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={() => { setEditingTmpl(t); setTmplError(""); setShowTmplForm(true); }}>
                          <Pencil className="w-3 h-3 mr-1" />Edit
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-500" onClick={() => handleDeleteTemplate(t.id)}>
                          <Trash2 className="w-3 h-3 mr-1" />Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {templates.length === 0 && <p className="text-muted-foreground col-span-3">No shift templates found.</p>}
            </div>
          )}
        </TabsContent>

        {/* ASSIGNMENTS TAB */}
        {canManage && (
          <TabsContent value="assignments" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Assign Shift to Employee</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {assignError && <p className="text-red-500 text-sm">{assignError}</p>}
                <div>
                  <Label>Employee *</Label>
                  <Select value={selectedEmpId?.toString() ?? ""} onValueChange={v => setSelectedEmpId(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent>
                      {employees.map((e: Employee) => (
                        <SelectItem key={e.id} value={e.id.toString()}>{e.firstName} {e.lastName} ({e.employeeId})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Shift Template *</Label>
                    <Select value={assignForm.shiftTemplateId?.toString() ?? ""} onValueChange={v => setAssignForm({ ...assignForm, shiftTemplateId: Number(v) })}>
                      <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                      <SelectContent>
                        {templates.filter((t) => t.isActive).map((t) => (
                          <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Effective From *</Label>
                    <Input type="date" value={assignForm.effectiveFrom} onChange={e => setAssignForm({ ...assignForm, effectiveFrom: e.target.value })} />
                  </div>
                  <div>
                    <Label>Effective To</Label>
                    <Input type="date" value={assignForm.effectiveTo} onChange={e => setAssignForm({ ...assignForm, effectiveTo: e.target.value })} />
                  </div>
                </div>
                <Button onClick={handleAssign} disabled={createAssign.isPending}>Assign Shift</Button>
              </CardContent>
            </Card>
            {selectedEmpId && assignments.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Current Assignments</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b"><th className="text-left py-1">Shift</th><th className="text-left py-1">From</th><th className="text-left py-1">To</th><th></th></tr></thead>
                    <tbody>
                      {assignments.map((a: ShiftAssignment) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="py-1">{a.shiftTemplateName}</td>
                          <td className="py-1">{a.effectiveFrom}</td>
                          <td className="py-1">{a.effectiveTo ?? "—"}</td>
                          <td className="py-1">
                            <Button size="sm" variant="ghost" className="text-red-500 h-6 px-2" onClick={async () => { await deleteAssign.mutateAsync({ id: a.id }); qc.invalidateQueries({ queryKey: getGetEmployeesIdShiftAssignmentsQueryKey(selectedEmpId) }); }}>Remove</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* SWAPS TAB */}
        <TabsContent value="swaps" className="space-y-4">
          {swapLoading ? <p className="text-muted-foreground">Loading...</p> : (
            <div className="space-y-3">
              {swaps.map((s: ShiftSwap) => (
                <Card key={s.id}>
                  <CardContent className="py-3 flex flex-wrap items-center gap-4 justify-between">
                    <div className="text-sm">
                      <div className="font-medium">Swap on {s.swapDate}</div>
                      <div className="text-muted-foreground">Requester #{s.requesterEmployeeId} ↔ Employee #{s.swapWithEmployeeId}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[s.hodStatus]}`}>HOD: {s.hodStatus}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[s.hrStatus]}`}>HR: {s.hrStatus}</span>
                    </div>
                    <div className="flex gap-2">
                      {canApproveHod && s.hodStatus === "Pending" && (
                        <Button size="sm" variant="outline" onClick={() => { setSwapAction({ id: s.id, type: "hod" }); setActionRemarks(""); }}>
                          HOD Action
                        </Button>
                      )}
                      {canManage && s.hodStatus === "Approved" && s.hrStatus === "Pending" && (
                        <Button size="sm" variant="outline" onClick={() => { setSwapAction({ id: s.id, type: "hr" }); setActionRemarks(""); }}>
                          HR Action
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {swaps.length === 0 && <p className="text-muted-foreground">No shift swap requests.</p>}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Template Form Dialog */}
      <Dialog open={showTmplForm} onOpenChange={setShowTmplForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTmpl ? "Edit" : "New"} Shift Template</DialogTitle>
          </DialogHeader>
          <TemplateForm
            initial={editingTmpl ? { ...editingTmpl, weeklyOff: editingTmpl.weeklyOff ?? [], notes: editingTmpl.notes ?? "" } : blankTemplate}
            onSave={handleSaveTemplate}
            onCancel={() => setShowTmplForm(false)}
            saving={createTmpl.isPending || patchTmpl.isPending}
            error={tmplError}
          />
        </DialogContent>
      </Dialog>

      {/* Swap Action Dialog */}
      <Dialog open={!!swapAction} onOpenChange={() => setSwapAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{swapAction?.type === "hod" ? "HOD" : "HR"} Action on Shift Swap</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Remarks (optional)</Label>
            <Textarea value={actionRemarks} onChange={e => setActionRemarks(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwapAction(null)}>Cancel</Button>
            <Button variant="outline" className="text-red-600" onClick={() => handleSwapAction("Rejected")} disabled={hodAction.isPending || hrAction.isPending}>
              <XCircle className="w-4 h-4 mr-1" />Reject
            </Button>
            <Button onClick={() => handleSwapAction("Approved")} disabled={hodAction.isPending || hrAction.isPending}>
              <CheckCircle className="w-4 h-4 mr-1" />Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
