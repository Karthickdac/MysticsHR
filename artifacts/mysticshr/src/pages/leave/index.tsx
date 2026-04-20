import { useState } from "react";
import {
  useListLeaveTypes,
  useListLeaveApplications,
  useListLeaveBalances,
  useSubmitLeaveApplication,
  useCancelLeaveApplication,
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
import { Plus, Calendar, AlertCircle, ArrowRight } from "lucide-react";
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

  const { data: leaveTypes } = useListLeaveTypes({ isActive: true });
  const { data: applications, isLoading } = useListLeaveApplications({});
  const { data: balances } = useListLeaveBalances({ year });

  const submitMutation = useSubmitLeaveApplication();
  const cancelMutation = useCancelLeaveApplication();

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
            <Link href="/leave/types">
              <Button variant="outline" size="sm">Leave Types</Button>
            </Link>
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
      {balances && balances.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Leave Balance — {year}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {balances.map((b) => {
              const available = parseFloat(b.available);
              return (
                <Card key={b.id} className="border shadow-none">
                  <CardContent className="p-3">
                    <div className="text-xs font-medium text-gray-500 truncate">{b.leaveTypeCode}</div>
                    <div className={`text-2xl font-bold mt-1 ${available <= 0 ? "text-red-600" : "text-green-600"}`}>
                      {available}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">of {b.allocated} days</div>
                    <div className="text-xs text-gray-400">{b.pending > "0" ? `${b.pending} pending` : ""}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* My Applications */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">My Applications</h2>
          {isHr && (
            <Link href="/leave/approvals">
              <Button variant="ghost" size="sm" className="text-xs">All Applications <ArrowRight className="w-3 h-3 ml-1" /></Button>
            </Link>
          )}
        </div>

        {isLoading ? (
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
