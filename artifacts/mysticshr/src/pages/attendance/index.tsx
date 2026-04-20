import { useState } from "react";
import {
  useGetAttendance,
  usePostAttendance,
  usePatchAttendanceId,
  useListEmployees,
  getGetAttendanceQueryKey,
} from "@workspace/api-client-react";
import type { GetAttendanceQueryResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Calendar, ArrowRight } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Link } from "wouter";

type AttRecord = GetAttendanceQueryResult[number];

const ALL_STATUSES = ["Present", "Absent", "Half-Day", "On Leave", "On Permission", "Holiday", "Week Off", "Regularization Pending"] as const;

const STATUS_COLORS: Record<string, string> = {
  "Present": "bg-green-100 text-green-700",
  "Absent": "bg-red-100 text-red-700",
  "Half-Day": "bg-yellow-100 text-yellow-700",
  "On Leave": "bg-blue-100 text-blue-700",
  "On Permission": "bg-purple-100 text-purple-700",
  "Holiday": "bg-pink-100 text-pink-700",
  "Week Off": "bg-gray-100 text-gray-500",
  "Regularization Pending": "bg-orange-100 text-orange-700",
};

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtMins(mins: number | null | undefined): string {
  if (!mins) return "—";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const { role } = useCurrentUser();
  const canManage = ["super_admin", "hr_manager", "hr_executive"].includes(role ?? "");

  const today = new Date().toISOString().split("T")[0];
  const [filterDate, setFilterDate] = useState(today);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttRecord | null>(null);
  const [formError, setFormError] = useState("");

  const { data: _empResponse } = useListEmployees({});
  const employees = _empResponse?.data ?? [];
  const { data: records = [], isLoading } = useGetAttendance({ date: filterDate });

  const createAtt = usePostAttendance();
  const overrideAtt = usePatchAttendanceId();

  const [form, setForm] = useState({ employeeId: 0, attendanceDate: today, signInTime: "", signOutTime: "", breakDurationMinutes: 0, status: "Present", notes: "" });
  const [overrideForm, setOverrideForm] = useState({ signInTime: "", signOutTime: "", breakDurationMinutes: 0, status: "", overrideReason: "", notes: "" });

  const filtered = filterStatus === "all" ? records : records.filter((r: AttRecord) => r.status === filterStatus);

  async function handleCreateAttendance() {
    setFormError("");
    if (!form.employeeId || !form.attendanceDate) { setFormError("Employee and date are required"); return; }
    try {
      const payload: any = { ...form };
      if (form.signInTime) payload.signInTime = new Date(`${form.attendanceDate}T${form.signInTime}`).toISOString();
      else delete payload.signInTime;
      if (form.signOutTime) payload.signOutTime = new Date(`${form.attendanceDate}T${form.signOutTime}`).toISOString();
      else delete payload.signOutTime;
      await createAtt.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getGetAttendanceQueryKey({ date: filterDate }) });
      setShowForm(false);
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to save");
    }
  }

  async function handleOverride() {
    setFormError("");
    if (!editingRecord || !overrideForm.overrideReason) { setFormError("Override reason is required"); return; }
    try {
      const payload: any = { overrideReason: overrideForm.overrideReason };
      if (overrideForm.signInTime) payload.signInTime = new Date(`${editingRecord.attendanceDate}T${overrideForm.signInTime}`).toISOString();
      if (overrideForm.signOutTime) payload.signOutTime = new Date(`${editingRecord.attendanceDate}T${overrideForm.signOutTime}`).toISOString();
      if (overrideForm.breakDurationMinutes) payload.breakDurationMinutes = overrideForm.breakDurationMinutes;
      if (overrideForm.status) payload.status = overrideForm.status;
      if (overrideForm.notes) payload.notes = overrideForm.notes;
      await overrideAtt.mutateAsync({ id: editingRecord.id, data: payload });
      await qc.invalidateQueries({ queryKey: getGetAttendanceQueryKey({ date: filterDate }) });
      setShowOverride(false);
      setEditingRecord(null);
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to override");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Attendance</h1>
        <div className="flex gap-2">
          <Link href="/attendance/regularization">
            <Button variant="outline"><ArrowRight className="w-4 h-4 mr-2" />Regularizations</Button>
          </Link>
          <Link href="/attendance/summary">
            <Button variant="outline"><Calendar className="w-4 h-4 mr-2" />Monthly Summary</Button>
          </Link>
          {canManage && (
            <Button onClick={() => { setForm({ employeeId: 0, attendanceDate: today, signInTime: "", signOutTime: "", breakDurationMinutes: 0, status: "Present", notes: "" }); setFormError(""); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />Record Attendance
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Records Table */}
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Sign In</th>
                    <th className="px-4 py-2 text-left">Sign Out</th>
                    <th className="px-4 py-2 text-left">Total</th>
                    <th className="px-4 py-2 text-left">OT</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Override</th>
                    {canManage && <th className="px-4 py-2 text-left">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: AttRecord) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.employeeName ?? `#${r.employeeId}`}</div>
                        <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                      </td>
                      <td className="px-4 py-2">{r.attendanceDate}</td>
                      <td className="px-4 py-2">{fmt(r.signInTime)}</td>
                      <td className="px-4 py-2">{fmt(r.signOutTime)}</td>
                      <td className="px-4 py-2">{fmtMins(r.totalMinutesWorked)}</td>
                      <td className="px-4 py-2">{fmtMins(r.overtimeMinutes)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-2">
                        {r.isHrOverride && <Badge variant="outline" className="text-xs">HR Override</Badge>}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" onClick={() => {
                            setEditingRecord(r);
                            setOverrideForm({ signInTime: "", signOutTime: "", breakDurationMinutes: r.breakDurationMinutes ?? 0, status: r.status, overrideReason: "", notes: r.notes ?? "" });
                            setFormError("");
                            setShowOverride(true);
                          }}>
                            <Pencil className="w-3 h-3 mr-1" />Override
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">No attendance records found for this date.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Record Attendance Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Attendance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-red-500 text-sm">{formError}</p>}
            <div>
              <Label>Employee *</Label>
              <Select value={form.employeeId?.toString() ?? ""} onValueChange={v => setForm({ ...form, employeeId: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => (
                    <SelectItem key={e.id} value={e.id.toString()}>{e.firstName} {e.lastName} ({e.employeeId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Date *</Label><Input type="date" value={form.attendanceDate} onChange={e => setForm({ ...form, attendanceDate: e.target.value })} /></div>
              <div><Label>Sign In</Label><Input type="time" value={form.signInTime} onChange={e => setForm({ ...form, signInTime: e.target.value })} /></div>
              <div><Label>Sign Out</Label><Input type="time" value={form.signOutTime} onChange={e => setForm({ ...form, signOutTime: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Break (min)</Label><Input type="number" value={form.breakDurationMinutes} onChange={e => setForm({ ...form, breakDurationMinutes: Number(e.target.value) })} /></div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleCreateAttendance} disabled={createAtt.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override Dialog */}
      <Dialog open={showOverride} onOpenChange={setShowOverride}>
        <DialogContent>
          <DialogHeader><DialogTitle>HR Override — {editingRecord?.attendanceDate}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-red-500 text-sm">{formError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Sign In</Label><Input type="time" value={overrideForm.signInTime} onChange={e => setOverrideForm({ ...overrideForm, signInTime: e.target.value })} /></div>
              <div><Label>Sign Out</Label><Input type="time" value={overrideForm.signOutTime} onChange={e => setOverrideForm({ ...overrideForm, signOutTime: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Break (min)</Label><Input type="number" value={overrideForm.breakDurationMinutes} onChange={e => setOverrideForm({ ...overrideForm, breakDurationMinutes: Number(e.target.value) })} /></div>
              <div>
                <Label>Override Status</Label>
                <Select value={overrideForm.status} onValueChange={v => setOverrideForm({ ...overrideForm, status: v })}>
                  <SelectTrigger><SelectValue placeholder="Keep existing" /></SelectTrigger>
                  <SelectContent>{ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Override Reason *</Label><Textarea value={overrideForm.overrideReason} onChange={e => setOverrideForm({ ...overrideForm, overrideReason: e.target.value })} rows={2} placeholder="Required" /></div>
            <div><Label>Notes</Label><Textarea value={overrideForm.notes} onChange={e => setOverrideForm({ ...overrideForm, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOverride(false)}>Cancel</Button>
            <Button onClick={handleOverride} disabled={overrideAtt.isPending}>Apply Override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
