import { useState } from "react";
import {
  useGetAttendance,
  usePostAttendance,
  usePatchAttendanceId,
  useListEmployees,
  useGetEmployeesIdAttendance,
  getGetAttendanceQueryKey,
  getGetEmployeesIdAttendanceQueryKey,
  type CreateAttendanceBody,
  type AttendanceOverrideBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Pencil, Calendar, ArrowRight, AlertTriangle } from "lucide-react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Link } from "wouter";

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

// Render the timestamp in the timezone it was captured in and append the
// short zone abbreviation (e.g. "09:14 IST"). Falls back to the local
// browser time when no zone was recorded.
function fmtInZone(dt: string | null | undefined, zone: string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt);
  if (!zone) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  try {
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: zone });
    const parts = new Intl.DateTimeFormat([], { timeZone: zone, timeZoneName: "short" }).formatToParts(d);
    const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? zone;
    return `${time} ${abbr}`;
  } catch {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

function fmtMins(mins: number | null | undefined): string {
  if (!mins) return "—";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Build an ISO timestamp for attendance. For overnight night shifts, if signOutTime
 * (HH:MM) is earlier than signInTime (HH:MM), we advance the date by one day.
 */
function buildTS(date: string, time: string, signInTime?: string): string {
  const d = new Date(`${date}T${time}`);
  if (signInTime && time < signInTime) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

// HR view: uses GET /attendance (includes employee name/code from join)
function HrAttendanceView() {
  const qc = useQueryClient();
  const { role } = useCurrentHrmsUser();
  const canManage = ["super_admin", "hr_manager", "hr_executive"].includes(role ?? "");

  const today = new Date().toISOString().split("T")[0];
  const [filterDate, setFilterDate] = useState(today);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [editingRecord, setEditingRecord] = useState<{
    id: number;
    attendanceDate: string;
    breakDurationMinutes: number | null;
    status: string;
    notes: string | null;
    signInLatitude?: string | null;
    signInLongitude?: string | null;
    signInAccuracyMeters?: number | null;
    signInUserAgent?: string | null;
    signOutLatitude?: string | null;
    signOutLongitude?: string | null;
    signOutAccuracyMeters?: number | null;
    signOutUserAgent?: string | null;
    signInTime?: string | null;
    signOutTime?: string | null;
    signInTimezone?: string | null;
    signOutTimezone?: string | null;
    employeeTimezone?: string | null;
  } | null>(null);
  const [formError, setFormError] = useState("");

  const { data: _empResponse } = useListEmployees({});
  const employees = _empResponse?.data ?? [];
  const { data: records = [], isLoading } = useGetAttendance({
    date: filterDate,
    ...(showSuspiciousOnly ? { suspiciousOnly: true } : {}),
  });

  const createAtt = usePostAttendance();
  const overrideAtt = usePatchAttendanceId();

  const [form, setForm] = useState({ employeeId: 0, attendanceDate: today, signInTime: "", signOutTime: "", breakDurationMinutes: 0, status: "Present", notes: "" });
  const [overrideForm, setOverrideForm] = useState({ signInTime: "", signOutTime: "", breakDurationMinutes: 0, status: "", overrideReason: "", notes: "" });

  const filtered = filterStatus === "all" ? records : records.filter((r) => r.status === filterStatus);

  async function handleCreateAttendance() {
    setFormError("");
    if (!form.employeeId || !form.attendanceDate) { setFormError("Employee and date are required"); return; }
    try {
      const payload: CreateAttendanceBody = {
        employeeId: form.employeeId,
        attendanceDate: form.attendanceDate,
        status: form.status,
        signInTime: form.signInTime ? buildTS(form.attendanceDate, form.signInTime) : null,
        signOutTime: form.signOutTime ? buildTS(form.attendanceDate, form.signOutTime, form.signInTime) : null,
        breakDurationMinutes: form.breakDurationMinutes,
        notes: form.notes || null,
      };
      await createAtt.mutateAsync({ data: payload });
      // Match every cached /attendance variant (with or without suspiciousOnly, etc.)
      await qc.invalidateQueries({ queryKey: getGetAttendanceQueryKey().slice(0, 1) });
      setShowForm(false);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setFormError(err?.message ?? "Failed to save");
    }
  }

  async function handleOverride() {
    setFormError("");
    if (!editingRecord || !overrideForm.overrideReason) { setFormError("Override reason is required"); return; }
    try {
      const payload: AttendanceOverrideBody = {
        overrideReason: overrideForm.overrideReason,
        signInTime: overrideForm.signInTime ? buildTS(editingRecord.attendanceDate, overrideForm.signInTime) : null,
        signOutTime: overrideForm.signOutTime ? buildTS(editingRecord.attendanceDate, overrideForm.signOutTime, overrideForm.signInTime) : null,
        breakDurationMinutes: overrideForm.breakDurationMinutes || null,
        status: overrideForm.status || null,
        notes: overrideForm.notes || null,
      };
      await overrideAtt.mutateAsync({ id: editingRecord.id, data: payload });
      await qc.invalidateQueries({ queryKey: getGetAttendanceQueryKey().slice(0, 1) });
      setShowOverride(false);
      setEditingRecord(null);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setFormError(err?.message ?? "Failed to override");
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
        <label className="flex items-center gap-2 h-9 px-3 rounded-md border bg-background cursor-pointer text-sm" data-testid="toggle-suspicious-only">
          <Checkbox
            checked={showSuspiciousOnly}
            onCheckedChange={(v) => setShowSuspiciousOnly(v === true)}
          />
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          Show only flagged
        </label>
      </div>

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
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <div className="font-medium">{(r as { employeeName?: string }).employeeName ?? `#${r.employeeId}`}</div>
                        <div className="text-xs text-muted-foreground">{(r as { employeeCode?: string }).employeeCode}</div>
                      </td>
                      <td className="px-4 py-2">{r.attendanceDate}</td>
                      <td className="px-4 py-2">{fmt(r.signInTime)}</td>
                      <td className="px-4 py-2">{fmt(r.signOutTime)}</td>
                      <td className="px-4 py-2">{fmtMins(r.totalMinutesWorked)}</td>
                      <td className="px-4 py-2">{fmtMins(r.overtimeMinutes)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status ?? ""] ?? ""}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-2 space-y-1">
                        {r.isHrOverride && <Badge variant="outline" className="text-xs">HR Override</Badge>}
                        {(() => {
                          const flags = r.suspicionFlags ?? [];
                          if (flags.length === 0) return null;
                          return (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="text-xs gap-1 border-amber-500 text-amber-700 bg-amber-50 cursor-help"
                                    data-testid={`badge-suspicious-${r.id}`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    Suspicious
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  <ul className="text-xs space-y-1 list-disc pl-4">
                                    {flags.map((f) => (
                                      <li key={f.code}>{f.reason}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" onClick={() => {
                            const rt = r as typeof r & {
                              signInLatitude?: string | null; signInLongitude?: string | null;
                              signInAccuracyMeters?: number | null; signInUserAgent?: string | null;
                              signOutLatitude?: string | null; signOutLongitude?: string | null;
                              signOutAccuracyMeters?: number | null; signOutUserAgent?: string | null;
                              signInTimezone?: string | null; signOutTimezone?: string | null;
                              employeeTimezone?: string | null;
                            };
                            setEditingRecord({
                              id: r.id, attendanceDate: r.attendanceDate,
                              breakDurationMinutes: r.breakDurationMinutes ?? null,
                              status: r.status ?? "", notes: r.notes ?? null,
                              signInLatitude: rt.signInLatitude ?? null,
                              signInLongitude: rt.signInLongitude ?? null,
                              signInAccuracyMeters: rt.signInAccuracyMeters ?? null,
                              signInUserAgent: rt.signInUserAgent ?? null,
                              signOutLatitude: rt.signOutLatitude ?? null,
                              signOutLongitude: rt.signOutLongitude ?? null,
                              signOutAccuracyMeters: rt.signOutAccuracyMeters ?? null,
                              signOutUserAgent: rt.signOutUserAgent ?? null,
                              signInTime: r.signInTime ?? null,
                              signOutTime: r.signOutTime ?? null,
                              signInTimezone: rt.signInTimezone ?? null,
                              signOutTimezone: rt.signOutTimezone ?? null,
                              employeeTimezone: rt.employeeTimezone ?? null,
                            });
                            setOverrideForm({ signInTime: "", signOutTime: "", breakDurationMinutes: r.breakDurationMinutes ?? 0, status: r.status ?? "", overrideReason: "", notes: r.notes ?? "" });
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
                  {employees.map((e) => (
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

      <Dialog open={showOverride} onOpenChange={setShowOverride}>
        <DialogContent>
          <DialogHeader><DialogTitle>HR Override — {editingRecord?.attendanceDate}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-red-500 text-sm">{formError}</p>}
            {editingRecord && (editingRecord.signInTime || editingRecord.signOutTime) && (
              <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
                <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Originally captured</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Clock-in: <span className="font-mono">{fmtInZone(editingRecord.signInTime, editingRecord.signInTimezone)}</span></div>
                  <div>Clock-out: <span className="font-mono">{fmtInZone(editingRecord.signOutTime, editingRecord.signOutTimezone)}</span></div>
                </div>
                {editingRecord.employeeTimezone && (() => {
                  const inDiff = editingRecord.signInTimezone && editingRecord.signInTimezone !== editingRecord.employeeTimezone;
                  const outDiff = editingRecord.signOutTimezone && editingRecord.signOutTimezone !== editingRecord.employeeTimezone;
                  let note: string | null = null;
                  if (inDiff && outDiff) note = "differs from both clock-in and clock-out zones";
                  else if (inDiff) note = "differs from clock-in zone";
                  else if (outDiff) note = "differs from clock-out zone";
                  return (
                    <div className="text-muted-foreground pt-1">
                      Employee's preferred timezone: <span className="font-mono">{editingRecord.employeeTimezone}</span>
                      {note && <span className="ml-1 text-amber-600">({note})</span>}
                    </div>
                  );
                })()}
              </div>
            )}
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
            {editingRecord && (editingRecord.signInLatitude || editingRecord.signInUserAgent || editingRecord.signOutLatitude || editingRecord.signOutUserAgent) && (
              <div className="rounded border bg-muted/30 p-3 text-xs space-y-2">
                <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Captured by employee</div>
                {(editingRecord.signInLatitude || editingRecord.signInUserAgent) && (
                  <div>
                    <div className="font-medium">At clock-in</div>
                    {editingRecord.signInLatitude && editingRecord.signInLongitude && (
                      <div>
                        Location: <a className="text-primary underline" target="_blank" rel="noreferrer"
                          href={`https://www.google.com/maps?q=${editingRecord.signInLatitude},${editingRecord.signInLongitude}`}>
                          {editingRecord.signInLatitude}, {editingRecord.signInLongitude}
                        </a>
                        {editingRecord.signInAccuracyMeters != null && <> · ±{editingRecord.signInAccuracyMeters}m</>}
                      </div>
                    )}
                    {editingRecord.signInUserAgent && <div className="text-muted-foreground break-all">Device: {editingRecord.signInUserAgent}</div>}
                  </div>
                )}
                {(editingRecord.signOutLatitude || editingRecord.signOutUserAgent) && (
                  <div>
                    <div className="font-medium">At clock-out</div>
                    {editingRecord.signOutLatitude && editingRecord.signOutLongitude && (
                      <div>
                        Location: <a className="text-primary underline" target="_blank" rel="noreferrer"
                          href={`https://www.google.com/maps?q=${editingRecord.signOutLatitude},${editingRecord.signOutLongitude}`}>
                          {editingRecord.signOutLatitude}, {editingRecord.signOutLongitude}
                        </a>
                        {editingRecord.signOutAccuracyMeters != null && <> · ±{editingRecord.signOutAccuracyMeters}m</>}
                      </div>
                    )}
                    {editingRecord.signOutUserAgent && <div className="text-muted-foreground break-all">Device: {editingRecord.signOutUserAgent}</div>}
                  </div>
                )}
              </div>
            )}
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

// Employee self-service view: uses GET /employees/:id/attendance (own records only)
function EmployeeAttendanceView({ employeeId }: { employeeId: number }) {
  const today = new Date().toISOString().split("T")[0];
  const currentMonth = today.slice(0, 7);
  const [filterMonth, setFilterMonth] = useState(currentMonth);
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: records = [], isLoading } = useGetEmployeesIdAttendance(employeeId, { month: filterMonth }, {
    query: {
      queryKey: getGetEmployeesIdAttendanceQueryKey(employeeId, { month: filterMonth }),
      enabled: !!employeeId,
    },
  });

  const filtered = filterStatus === "all" ? records : records.filter((r) => r.status === filterStatus);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Attendance</h1>
        <Link href="/attendance/regularization">
          <Button variant="outline"><ArrowRight className="w-4 h-4 mr-2" />Regularizations</Button>
        </Link>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label className="text-xs">Month</Label>
          <Input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="w-40" />
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

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Sign In</th>
                    <th className="px-4 py-2 text-left">Sign Out</th>
                    <th className="px-4 py-2 text-left">Total</th>
                    <th className="px-4 py-2 text-left">OT</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2">{r.attendanceDate}</td>
                      <td className="px-4 py-2">{fmt(r.signInTime)}</td>
                      <td className="px-4 py-2">{fmt(r.signOutTime)}</td>
                      <td className="px-4 py-2">{fmtMins(r.totalMinutesWorked)}</td>
                      <td className="px-4 py-2">{fmtMins(r.overtimeMinutes)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status ?? ""] ?? ""}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-2">
                        {r.isHrOverride && <Badge variant="outline" className="text-xs">HR Override</Badge>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No attendance records found for this month.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { role, hrmsUser } = useCurrentHrmsUser();

  if (role === "employee") {
    const empId = hrmsUser?.employeeId ?? null;
    if (!empId) {
      return <div className="p-6 text-muted-foreground">Loading your attendance records...</div>;
    }
    return <EmployeeAttendanceView employeeId={empId} />;
  }

  return <HrAttendanceView />;
}
