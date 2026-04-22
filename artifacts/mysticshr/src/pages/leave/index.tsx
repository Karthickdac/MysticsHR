import { useState } from "react";
import {
  useListLeaveTypes,
  useListLeaveApplications,
  useListLeaveBalances,
  useListLeaveAccrualHistory,
  useGetLeaveUsageTrend,
  getGetLeaveUsageTrendQueryKey,
  useSubmitLeaveApplication,
  useCancelLeaveApplication,
  useEditLeaveApplicationDates,
  getListLeaveApplicationsQueryKey,
  getListLeaveBalancesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Calendar, AlertCircle, ArrowRight, ChevronLeft, ChevronRight, List, CalendarDays } from "lucide-react";
import {
  ResponsiveContainer as RCResponsiveContainer,
  BarChart as RCBarChart,
  Bar as RCBar,
  XAxis as RCXAxis,
  YAxis as RCYAxis,
  Tooltip as RCTooltip,
  Legend as RCLegend,
  CartesianGrid as RCCartesianGrid,
} from "recharts";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-700",
  "HOD Approved": "bg-blue-100 text-blue-700",
  "HR Approved": "bg-indigo-100 text-indigo-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-gray-100 text-gray-500",
  "Cancel Requested": "bg-orange-100 text-orange-700",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function LeavePage() {
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = hrmsRole ?? "employee";
  const isHr = ["super_admin", "hr_manager", "hr_executive"].includes(role);

  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [historyYear, setHistoryYear] = useState<number>(year);

  const { data: leaveTypes } = useListLeaveTypes({ isActive: true });
  const { data: applications, isLoading } = useListLeaveApplications({});
  const { data: balances } = useListLeaveBalances({ year });
  const { data: accrualHistory } = useListLeaveAccrualHistory({ year: historyYear });

  const submitMutation = useSubmitLeaveApplication();
  const cancelMutation = useCancelLeaveApplication();
  const editDatesMutation = useEditLeaveApplicationDates();

  // HR-only edit-dates dialog
  type EditingApp = {
    id: number; fromDate: string; toDate: string; isHalfDay: boolean;
    halfDaySession?: string | null; leaveTypeName?: string | null;
    leaveTypeCode?: string | null;
  };
  const [editingApp, setEditingApp] = useState<EditingApp | null>(null);
  const [editForm, setEditForm] = useState({
    fromDate: "", toDate: "", isHalfDay: false, halfDaySession: "First Half", reason: "",
  });
  function openEditDates(app: EditingApp) {
    setEditingApp(app);
    setEditForm({
      fromDate: String(app.fromDate),
      toDate: String(app.toDate),
      isHalfDay: !!app.isHalfDay,
      halfDaySession: app.halfDaySession ?? "First Half",
      reason: "",
    });
  }
  async function handleEditDates() {
    if (!editingApp) return;
    if (!editForm.fromDate || !editForm.toDate) { alert("Both dates are required"); return; }
    if (!editForm.reason.trim()) { alert("A reason is required for the edit"); return; }
    if (editForm.isHalfDay && editForm.fromDate !== editForm.toDate) {
      alert("Half-day leave must have the same from and to date"); return;
    }
    try {
      await editDatesMutation.mutateAsync({
        id: editingApp.id,
        data: {
          fromDate: editForm.fromDate,
          toDate: editForm.toDate,
          isHalfDay: editForm.isHalfDay,
          halfDaySession: editForm.isHalfDay ? editForm.halfDaySession : null,
          reason: editForm.reason,
        },
      });
      invalidate();
      setEditingApp(null);
    } catch (err: any) {
      alert(err?.response?.data?.error ?? "Failed to update leave dates");
    }
  }

  const [myView, setMyView] = useState<"list" | "calendar">("list");
  const [showApply, setShowApply] = useState(false);
  const [showLopWarning, setShowLopWarning] = useState(false);
  const [lopInfo, setLopInfo] = useState<{ available: number; requested: number } | null>(null);

  const [form, setForm] = useState({
    leaveTypeId: "",
    fromDate: "",
    toDate: "",
    isHalfDay: false,
    halfDaySession: "First Half",
    reason: "",
    lopConfirmed: false,
  });

  const resetForm = () => {
    setForm({ leaveTypeId: "", fromDate: "", toDate: "", isHalfDay: false, halfDaySession: "First Half", reason: "", lopConfirmed: false });
    setShowLopWarning(false);
    setLopInfo(null);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListLeaveApplicationsQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListLeaveBalancesQueryKey({ year }) });
  };

  async function handleSubmit(lopConfirmed = false) {
    if (!form.leaveTypeId || !form.fromDate || !form.toDate || !form.reason.trim()) return;
    try {
      await submitMutation.mutateAsync({
        data: {
          leaveTypeId: Number(form.leaveTypeId),
          fromDate: form.fromDate,
          toDate: form.toDate,
          isHalfDay: form.isHalfDay,
          halfDaySession: form.isHalfDay ? form.halfDaySession : null,
          reason: form.reason,
          lopConfirmed,
        },
      });
      invalidate();
      setShowApply(false);
      setShowLopWarning(false);
      resetForm();
    } catch (err: any) {
      const body = err?.response?.data ?? err;
      if (body?.isLopWarning) {
        setLopInfo({ available: body.available, requested: body.requested });
        setShowLopWarning(true);
      } else {
        alert(body?.error ?? "Failed to submit leave");
      }
    }
  }

  async function handleCancel(id: number) {
    if (!confirm("Cancel this leave application?")) return;
    try {
      await cancelMutation.mutateAsync({ id, data: {} });
      invalidate();
    } catch { alert("Failed to cancel"); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
          <p className="text-sm text-gray-500 mt-1">Apply for leave and track your applications</p>
        </div>
        <div className="flex gap-2">
          {isHr && (
            <>
              <Link href="/leave/types">
                <Button variant="outline" size="sm">Leave Types</Button>
              </Link>
              <Link href="/leave/policies">
                <Button variant="outline" size="sm">Policies</Button>
              </Link>
            </>
          )}
          <Link href="/leave/calendar">
            <Button variant="outline" size="sm"><Calendar className="w-4 h-4 mr-1" />Calendar</Button>
          </Link>
          {(isHr || role === "hod") && (
            <Link href="/leave/approvals">
              <Button variant="outline" size="sm">Approvals</Button>
            </Link>
          )}
          <Button onClick={() => setShowApply(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />Apply Leave
          </Button>
        </div>
      </div>

      {/* Balance Cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Leave Balance — {year}</h2>
        {!balances ? (
          <div className="text-sm text-gray-400">Loading balances...</div>
        ) : balances.length === 0 ? (
          <div className="text-center py-6 text-gray-400 border rounded-lg bg-gray-50/50">
            <Calendar className="w-6 h-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No leave types configured yet. Contact HR.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {balances.map((b) => {
              const allocated = parseFloat(b.allocated) + parseFloat(b.carryForward ?? "0");
              const used = parseFloat(b.used);
              const pending = parseFloat(b.pending);
              const available = parseFloat(b.available);
              const usedPct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
              const pendingPct = allocated > 0 ? Math.min(100 - usedPct, Math.round((pending / allocated) * 100)) : 0;
              return (
                <Card key={b.id} className="border shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="text-sm font-medium text-gray-700 truncate">
                        {b.leaveTypeName ?? b.leaveTypeCode}
                      </div>
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">{b.leaveTypeCode}</span>
                    </div>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className={`text-2xl font-bold ${available <= 0 ? "text-red-600" : "text-green-600"}`}>
                        {available}
                      </span>
                      <span className="text-xs text-gray-400">/ {allocated} days remaining</span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden flex" title={`${used} used, ${pending} pending`}>
                      <div className="bg-blue-500 h-2" style={{ width: `${usedPct}%` }} />
                      <div className="bg-yellow-400 h-2" style={{ width: `${pendingPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-gray-500">
                      <span>{used} used</span>
                      {pending > 0 && <span className="text-yellow-600">{pending} pending</span>}
                      {parseFloat(b.carryForward ?? "0") > 0 && (
                        <span className="text-gray-400">+{b.carryForward} CF</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Accrual & Carry-Forward History */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Accrual &amp; Carry-Forward History
          </h2>
          <Select value={String(historyYear)} onValueChange={(v) => setHistoryYear(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => year - i).map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!accrualHistory ? (
          <div className="text-sm text-gray-400">Loading history...</div>
        ) : accrualHistory.length === 0 ? (
          <div className="text-center py-6 text-gray-400 border rounded-lg bg-gray-50/50 text-sm">
            No accrual or carry-forward entries for {year} yet.
          </div>
        ) : (
          <Card className="border shadow-none">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Date</th>
                      <th className="text-left px-4 py-2 font-medium">Leave Type</th>
                      <th className="text-left px-4 py-2 font-medium">Type</th>
                      <th className="text-right px-4 py-2 font-medium">Days</th>
                      <th className="text-left px-4 py-2 font-medium">Notes</th>
                      <th className="text-left px-4 py-2 font-medium">Processed By</th>
                      {!["employee"].includes(role) && (
                        <th className="text-left px-4 py-2 font-medium">Employee&nbsp;ID</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {accrualHistory.slice(0, 200).map((h) => {
                      const isCF = h.accrualType === "Carry Forward";
                      return (
                        <tr key={h.id} className="border-t">
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(h.createdAt)}</td>
                          <td className="px-4 py-2">{h.leaveTypeName ?? h.leaveTypeCode}</td>
                          <td className="px-4 py-2">
                            <Badge
                              variant="outline"
                              className={
                                isCF
                                  ? "text-indigo-700 border-indigo-200 bg-indigo-50"
                                  : "text-gray-600 border-gray-200"
                              }
                            >
                              {h.accrualType}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">{h.days}</td>
                          <td className="px-4 py-2 text-gray-500 max-w-xs truncate" title={h.notes ?? undefined}>
                            {h.notes ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-gray-500">{h.processedByName ?? "System"}</td>
                          {!["employee"].includes(role) && (
                            <td className="px-4 py-2 text-gray-500">{h.employeeId}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {accrualHistory.length > 200 && (
                <div className="px-4 py-2 text-xs text-gray-400 border-t">
                  Showing 200 most recent of {accrualHistory.length} entries.
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Year-over-Year Usage Trend */}
      <LeaveUsageTrendChart isEmployee={role === "employee"} />

      {/* My Applications */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">My Applications</h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setMyView("list")}
                className={`px-2.5 py-1 text-xs flex items-center gap-1 ${myView === "list" ? "bg-indigo-50 text-indigo-700" : "text-gray-500 hover:bg-gray-50"}`}
                aria-pressed={myView === "list"}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                type="button"
                onClick={() => setMyView("calendar")}
                className={`px-2.5 py-1 text-xs flex items-center gap-1 border-l ${myView === "calendar" ? "bg-indigo-50 text-indigo-700" : "text-gray-500 hover:bg-gray-50"}`}
                aria-pressed={myView === "calendar"}
              >
                <CalendarDays className="w-3.5 h-3.5" /> Calendar
              </button>
            </div>
            {isHr && (
              <Link href="/leave/approvals">
                <Button variant="ghost" size="sm" className="text-xs">All Applications <ArrowRight className="w-3 h-3 ml-1" /></Button>
              </Link>
            )}
          </div>
        </div>

        {myView === "calendar" ? (
          <MyLeaveCalendar applications={applications ?? []} />
        ) : isLoading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : (applications ?? []).length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No leave applications yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(applications ?? []).slice(0, 20).map((app) => (
              <Card key={app.id} className="border shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{app.leaveTypeName ?? app.leaveTypeCode}</span>
                        {app.isLop && <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">LOP</Badge>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {fmtDate(app.fromDate)} — {fmtDate(app.toDate)} ({app.totalDays} day{parseFloat(app.totalDays) !== 1 ? "s" : ""})
                        {app.isHalfDay && <span className="ml-1">• {app.halfDaySession}</span>}
                      </div>
                      {app.reason && <div className="text-xs text-gray-400 truncate max-w-xs">{app.reason}</div>}
                      {(app.hodRemarks || app.hrRemarks) && (
                        <div className="text-xs text-gray-400 italic">{app.hrRemarks ?? app.hodRemarks}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={STATUS_COLORS[app.status] ?? ""}>{app.status}</Badge>
                      {app.status === "Pending" && (
                        <Button size="sm" variant="ghost" className="text-red-500 h-7 px-2 text-xs"
                          onClick={() => handleCancel(app.id)} disabled={cancelMutation.isPending}>
                          Cancel
                        </Button>
                      )}
                      {isHr && app.status === "Approved" && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                          onClick={() => openEditDates({
                            id: app.id,
                            fromDate: String(app.fromDate),
                            toDate: String(app.toDate),
                            isHalfDay: !!app.isHalfDay,
                            halfDaySession: app.halfDaySession ?? null,
                            leaveTypeName: app.leaveTypeName ?? null,
                            leaveTypeCode: app.leaveTypeCode ?? null,
                          })}>
                          Edit dates
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Apply Leave Dialog */}
      <Dialog open={showApply} onOpenChange={(o) => { if (!o) resetForm(); setShowApply(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply for Leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Leave Type *</Label>
              <Select value={form.leaveTypeId} onValueChange={(v) => setForm(f => ({ ...f, leaveTypeId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {(leaveTypes ?? []).map((lt) => (
                    <SelectItem key={lt.id} value={String(lt.id)}>{lt.name} ({lt.annualQuota} days/yr)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From Date *</Label>
                <Input type="date" value={form.fromDate} onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div>
                <Label>To Date *</Label>
                <Input type="date" value={form.toDate} onChange={e => setForm(f => ({ ...f, toDate: e.target.value, ...(e.target.value < form.fromDate ? { fromDate: e.target.value } : {}) }))} min={form.fromDate} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="half-day" checked={form.isHalfDay} onCheckedChange={(v) => setForm(f => ({ ...f, isHalfDay: Boolean(v) }))} />
              <Label htmlFor="half-day" className="cursor-pointer">Half Day</Label>
              {form.isHalfDay && (
                <Select value={form.halfDaySession} onValueChange={(v) => setForm(f => ({ ...f, halfDaySession: v }))}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="First Half">First Half</SelectItem>
                    <SelectItem value="Second Half">Second Half</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>Reason *</Label>
              <Textarea placeholder="Reason for leave..." value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowApply(false); resetForm(); }}>Cancel</Button>
            <Button onClick={() => handleSubmit(false)} disabled={submitMutation.isPending || !form.leaveTypeId || !form.fromDate || !form.toDate || !form.reason.trim()}>
              {submitMutation.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HR — Edit Approved Leave Dates Dialog */}
      <Dialog open={!!editingApp} onOpenChange={(o) => { if (!o) setEditingApp(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Approved Leave Dates</DialogTitle>
          </DialogHeader>
          {editingApp && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 space-y-0.5">
                <div><span className="font-medium">{editingApp.leaveTypeName ?? editingApp.leaveTypeCode ?? "Leave"}</span></div>
                <div>Currently: {fmtDate(editingApp.fromDate)} — {fmtDate(editingApp.toDate)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>From *</Label>
                  <Input type="date" value={editForm.fromDate} onChange={e => setEditForm(f => ({ ...f, fromDate: e.target.value }))} />
                </div>
                <div>
                  <Label>To *</Label>
                  <Input type="date" value={editForm.toDate} onChange={e => setEditForm(f => ({ ...f, toDate: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-half-day" checked={editForm.isHalfDay}
                  onCheckedChange={(v) => setEditForm(f => ({ ...f, isHalfDay: !!v, toDate: v ? f.fromDate : f.toDate }))} />
                <Label htmlFor="edit-half-day" className="text-sm font-normal cursor-pointer">Half-day</Label>
              </div>
              {editForm.isHalfDay && (
                <div>
                  <Label>Session</Label>
                  <Select value={editForm.halfDaySession} onValueChange={(v) => setEditForm(f => ({ ...f, halfDaySession: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="First Half">First Half</SelectItem>
                      <SelectItem value="Second Half">Second Half</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Reason for edit *</Label>
                <Textarea rows={3} placeholder="e.g. Employee requested to shift dates by 2 days due to travel"
                  value={editForm.reason} onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                Saving will adjust the leave balance and re-sync attendance for changed days. The applicant and approvers will be notified.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingApp(null)} disabled={editDatesMutation.isPending}>Cancel</Button>
            <Button onClick={handleEditDates} disabled={editDatesMutation.isPending}>
              {editDatesMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LOP Warning Dialog */}
      <Dialog open={showLopWarning} onOpenChange={setShowLopWarning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertCircle className="w-5 h-5" />
              Insufficient Leave Balance
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 space-y-2">
            <p>You don't have enough leave balance for this request.</p>
            {lopInfo && (
              <div className="bg-orange-50 rounded p-3 space-y-1">
                <div>Available: <strong>{lopInfo.available} days</strong></div>
                <div>Requested: <strong>{lopInfo.requested} days</strong></div>
                <div>Shortfall: <strong className="text-red-600">{(lopInfo.requested - lopInfo.available).toFixed(1)} days</strong></div>
              </div>
            )}
            <p>Proceeding will mark this as <strong>Loss of Pay (LOP)</strong>. Do you want to continue?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLopWarning(false)}>Go Back</Button>
            <Button variant="destructive" onClick={() => handleSubmit(true)}>Submit as LOP</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AppLite = {
  id: number;
  fromDate: string;
  toDate: string;
  status: string;
  leaveTypeCode?: string | null;
  leaveTypeName?: string | null;
  totalDays: string;
  isHalfDay?: boolean | null;
  halfDaySession?: string | null;
  reason?: string | null;
};

const TYPE_PALETTE = [
  "bg-indigo-200 text-indigo-800",
  "bg-emerald-200 text-emerald-800",
  "bg-amber-200 text-amber-800",
  "bg-sky-200 text-sky-800",
  "bg-rose-200 text-rose-800",
  "bg-violet-200 text-violet-800",
  "bg-teal-200 text-teal-800",
  "bg-pink-200 text-pink-800",
];

function colorForCode(code: string | null | undefined) {
  if (!code) return TYPE_PALETTE[0];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}

function MyLeaveCalendar({ applications }: { applications: AppLite[] }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedApp, setSelectedApp] = useState<AppLite | null>(null);
  const [dayDetail, setDayDetail] = useState<{ date: Date; apps: AppLite[] } | null>(null);

  // Only show approved + pending (incl. mid-flow). Skip cancelled / rejected.
  const visible = applications.filter((a) =>
    ["Approved", "Pending", "HOD Approved", "HR Approved", "Cancel Requested"].includes(a.status),
  );

  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();
  const numDays = new Date(year, monthIdx + 1, 0).getDate();
  const firstDay = new Date(year, monthIdx, 1).getDay();

  const monthStart = new Date(year, monthIdx, 1);
  const monthEnd = new Date(year, monthIdx, numDays);

  // day-of-month → AppLite[]
  const dayMap = new Map<number, AppLite[]>();
  for (const app of visible) {
    const from = new Date(app.fromDate);
    const to = new Date(app.toDate);
    if (to < monthStart || from > monthEnd) continue;
    const start = from < monthStart ? monthStart : from;
    const end = to > monthEnd ? monthEnd : to;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDate();
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d)!.push(app);
      cur.setDate(cur.getDate() + 1);
    }
  }

  const monthName = cursor.toLocaleString("default", { month: "long", year: "numeric" });
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  // Distinct leave types in this month for the legend.
  const legendCodes = Array.from(
    new Map(
      Array.from(dayMap.values()).flat().map((a) => [a.leaveTypeCode ?? "", a]),
    ).values(),
  );

  return (
    <div className="border rounded-lg bg-white">
      <div className="flex items-center justify-between p-3 border-b">
        <Button variant="ghost" size="sm" onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-semibold text-gray-700 text-sm">{monthName}</h3>
        <Button variant="ghost" size="sm" onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 p-3">
        {weekDays.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
          const apps = dayMap.get(day) ?? [];
          const isToday = today.getDate() === day && today.getMonth() === monthIdx && today.getFullYear() === year;
          return (
            <div
              key={day}
              onClick={() => apps.length > 0 && setDayDetail({ date: new Date(year, monthIdx, day), apps })}
              className={`min-h-[72px] rounded p-1 border ${isToday ? "border-blue-400 bg-blue-50" : "border-gray-100"} ${apps.length > 0 ? "cursor-pointer hover:bg-gray-50" : ""}`}
            >
              <div className={`text-xs font-medium mb-1 ${isToday ? "text-blue-600" : "text-gray-600"}`}>{day}</div>
              <div className="space-y-0.5">
                {apps.slice(0, 3).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedApp(a); }}
                    title={`${a.leaveTypeName ?? a.leaveTypeCode ?? ""} • ${a.status}`}
                    className={`w-full text-left text-[10px] rounded px-1 truncate hover:opacity-80 ${colorForCode(a.leaveTypeCode)} ${a.status === "Pending" || a.status === "HOD Approved" || a.status === "HR Approved" || a.status === "Cancel Requested" ? "ring-1 ring-yellow-400/60" : ""}`}
                  >
                    {a.leaveTypeCode ?? a.leaveTypeName ?? "Leave"}
                  </button>
                ))}
                {apps.length > 3 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDayDetail({ date: new Date(year, monthIdx, day), apps }); }}
                    className="text-[10px] text-indigo-500 hover:underline"
                  >
                    +{apps.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {legendCodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-3 pb-3 border-t pt-3">
          {legendCodes.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded ${colorForCode(a.leaveTypeCode)}`} />
              <span className="text-[11px] text-gray-500">{a.leaveTypeCode ?? a.leaveTypeName}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded ring-1 ring-yellow-400/60 bg-gray-100" />
            <span className="text-[11px] text-gray-500">Pending approval</span>
          </div>
        </div>
      )}

      <Dialog open={!!dayDetail} onOpenChange={(o) => !o && setDayDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dayDetail?.date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {dayDetail?.apps.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setSelectedApp(a); setDayDetail(null); }}
                className="w-full text-left border rounded p-2 hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.leaveTypeName ?? a.leaveTypeCode}</div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(a.fromDate)} — {fmtDate(a.toDate)} ({a.totalDays}d){a.isHalfDay ? ` • ${a.halfDaySession}` : ""}
                  </div>
                </div>
                <Badge className={STATUS_COLORS[a.status] ?? ""}>{a.status}</Badge>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDayDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedApp} onOpenChange={(o) => !o && setSelectedApp(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedApp?.leaveTypeName ?? selectedApp?.leaveTypeCode ?? "Leave"}</DialogTitle>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Status</span>
                <Badge className={STATUS_COLORS[selectedApp.status] ?? ""}>{selectedApp.status}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Dates</span>
                <span>{fmtDate(selectedApp.fromDate)} — {fmtDate(selectedApp.toDate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Total days</span>
                <span>{selectedApp.totalDays}{selectedApp.isHalfDay ? ` • ${selectedApp.halfDaySession}` : ""}</span>
              </div>
              {selectedApp.reason && (
                <div>
                  <div className="text-gray-500 mb-1">Reason</div>
                  <div className="text-gray-700 bg-gray-50 rounded p-2 text-xs">{selectedApp.reason}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedApp(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeaveUsageTrendChart({ isEmployee }: { isEmployee: boolean }) {
  const { data } = useGetLeaveUsageTrend({ years: 3 }, { query: { enabled: isEmployee, queryKey: getGetLeaveUsageTrendQueryKey({ years: 3 }) } });

  if (!isEmployee) return null;
  if (!data || data.byLeaveType.length === 0 || data.years.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Leave Usage Trend ({data?.years.length ? `${data.years[0]}–${data.years[data.years.length - 1]}` : "last 3 years"})
        </h2>
        <div className="text-center py-6 text-gray-400 border rounded-lg bg-gray-50/50 text-sm">
          No leave usage in the last 3 years yet.
        </div>
      </div>
    );
  }

  // Pivot to recharts: one row per leave type, one bar per year.
  const chartData = data.byLeaveType.map((t) => {
    const row: Record<string, string | number> = { name: t.leaveTypeName };
    for (const y of data.years) row[String(y)] = t.usageByYear[String(y)] ?? 0;
    return row;
  });

  const yearColors = ["#c7d2fe", "#818cf8", "#4f46e5"]; // last → current
  const startColorIdx = Math.max(0, yearColors.length - data.years.length);

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Leave Usage Trend ({data.years[0]}–{data.years[data.years.length - 1]})
      </h2>
      <div className="border rounded-lg p-4 bg-white">
        <LazyTrendChart data={chartData} years={data.years} colors={yearColors.slice(startColorIdx)} />
      </div>
    </div>
  );
}

function LazyTrendChart({ data, years, colors }: { data: Array<Record<string, string | number>>; years: number[]; colors: string[] }) {
  return (
    <RCResponsiveContainer width="100%" height={260}>
      <RCBarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <RCCartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <RCXAxis dataKey="name" tick={{ fontSize: 12 }} />
        <RCYAxis tick={{ fontSize: 12 }} label={{ value: "Days used", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#64748b" } }} />
        <RCTooltip />
        <RCLegend wrapperStyle={{ fontSize: 12 }} />
        {years.map((y, i) => (
          <RCBar key={y} dataKey={String(y)} fill={colors[i] ?? "#4f46e5"} radius={[4, 4, 0, 0]} />
        ))}
      </RCBarChart>
    </RCResponsiveContainer>
  );
}
