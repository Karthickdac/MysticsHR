import { useState } from "react";
import {
  useListPermissions,
  useSubmitPermission,
  useActionPermission,
  useCancelPermission,
  useGetPermissionRegister,
  useOverridePermissionLimit,
  getListPermissionsQueryKey,
  getGetPermissionRegisterQueryKey,
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
import { Plus, ChevronLeft, ChevronRight, Clock, CheckCircle, XCircle, Shield } from "lucide-react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-gray-100 text-gray-500",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMins(m: number) {
  if (m <= 0) return "0 min";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min > 0 ? min + "m" : ""}`.trim() : `${min}m`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function PermissionsPage() {
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = hrmsRole ?? "employee";
  const isHr = ["super_admin", "hr_manager", "hr_executive"].includes(role);
  const isHod = role === "hod";
  const canAction = isHr || isHod;

  const qc = useQueryClient();

  const [currentDate, setCurrentDate] = useState(new Date());
  const month = monthKey(currentDate);
  const [y, m] = month.split("-").map(Number);

  const { data: allApps, isLoading } = useListPermissions({ month });
  const { data: register } = useGetPermissionRegister({ month });
  const submitMutation = useSubmitPermission();
  const actionMutation = useActionPermission();
  const cancelMutation = useCancelPermission();
  const overrideMutation = useOverridePermissionLimit();

  const [showApply, setShowApply] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [showAction, setShowAction] = useState<{ id: number; action: "Approved" | "Rejected" } | null>(null);
  const [actionRemarks, setActionRemarks] = useState("");

  const [form, setForm] = useState({ permissionDate: "", startTime: "", endTime: "", reason: "" });
  const [overrideForm, setOverrideForm] = useState({ newLimitMinutes: "480", justification: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListPermissionsQueryKey({ month }) });
    qc.invalidateQueries({ queryKey: getGetPermissionRegisterQueryKey({ month }) });
  };

  function goMonth(delta: number) {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  async function handleSubmit() {
    if (!form.permissionDate || !form.startTime || !form.endTime || !form.reason.trim()) return;
    try {
      await submitMutation.mutateAsync({ data: { ...form } });
      invalidate();
      setShowApply(false);
      setForm({ permissionDate: "", startTime: "", endTime: "", reason: "" });
    } catch (err: any) {
      alert(err?.response?.data?.error ?? "Failed to submit permission");
    }
  }

  async function handleAction() {
    if (!showAction) return;
    try {
      await actionMutation.mutateAsync({ id: showAction.id, data: { action: showAction.action, remarks: actionRemarks || undefined } });
      invalidate();
      setShowAction(null);
      setActionRemarks("");
    } catch (err: any) {
      alert(err?.response?.data?.error ?? "Action failed");
    }
  }

  async function handleCancel(id: number) {
    if (!confirm("Cancel this permission request?")) return;
    try {
      await cancelMutation.mutateAsync({ id });
      invalidate();
    } catch { alert("Failed to cancel"); }
  }

  async function handleOverride() {
    if (!overrideForm.justification.trim()) return;
    try {
      await overrideMutation.mutateAsync({
        data: {
          employeeId: register?.employeeId ?? 0,
          year: y, month: m,
          newLimitMinutes: Number(overrideForm.newLimitMinutes),
          justification: overrideForm.justification,
        },
      });
      invalidate();
      setShowOverride(false);
    } catch { alert("Failed to override limit"); }
  }

  const apps = allApps ?? [];
  const usedMins = register?.usedMinutes ?? 0;
  const limitMins = register?.limitMinutes ?? 240;
  const remainingMins = register?.remainingMinutes ?? (limitMins - usedMins);
  const usedPct = Math.min(100, Math.round((usedMins / limitMins) * 100));

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">Hour-based short absence requests</p>
        </div>
        <Button size="sm" onClick={() => setShowApply(true)}>
          <Plus className="w-4 h-4 mr-1" />Apply Permission
        </Button>
      </div>

      {/* Month Navigator + Register Card */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => goMonth(-1)}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="font-medium text-sm min-w-[120px] text-center">{monthName}</span>
        <Button variant="ghost" size="sm" onClick={() => goMonth(1)}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* Balance Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Used</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-gray-800">{fmtMins(usedMins)}</div></CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Remaining</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${remainingMins <= 0 ? "text-red-600" : "text-green-600"}`}>{fmtMins(remainingMins)}</div>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-gray-500">Monthly Limit</CardTitle>
            {isHr && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowOverride(true)}>
                <Shield className="w-3 h-3 mr-1" />Override
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-600">{fmtMins(limitMins)}</div>
            <div className="mt-2 bg-gray-100 rounded-full h-2">
              <div className={`h-2 rounded-full ${usedPct > 80 ? "bg-red-500" : usedPct > 50 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${usedPct}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">{usedPct}% used</div>
          </CardContent>
        </Card>
      </div>

      {/* Applications Table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Applications — {monthName}</h2>
        {isLoading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : apps.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No permission requests for this month</p>
          </div>
        ) : (
          <div className="space-y-3">
            {apps.map((app) => (
              <Card key={app.id} className="border shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      {canAction && (
                        <div className="flex items-center gap-1 text-sm font-medium">
                          {app.employeeName}
                          {app.departmentName && <span className="text-xs text-gray-400 font-normal">• {app.departmentName}</span>}
                        </div>
                      )}
                      <div className="text-xs text-gray-600">
                        {fmtDate(app.permissionDate)} • {app.startTime} – {app.endTime}
                        <span className="ml-1 text-gray-400">({fmtMins(app.durationMinutes)})</span>
                      </div>
                      {app.reason && <div className="text-xs text-gray-400 italic">{app.reason}</div>}
                      {app.isOverride && <Badge className="text-xs bg-purple-100 text-purple-700">HR Override</Badge>}
                      {app.hodRemarks && <div className="text-xs text-blue-500">{app.hodRemarks}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={STATUS_COLORS[app.status] ?? ""}>{app.status}</Badge>
                      {canAction && app.status === "Pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-green-600 border-green-200"
                            onClick={() => { setShowAction({ id: app.id, action: "Approved" }); setActionRemarks(""); }}>
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-500 border-red-200"
                            onClick={() => { setShowAction({ id: app.id, action: "Rejected" }); setActionRemarks(""); }}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                      {app.status === "Pending" && !canAction && (
                        <Button size="sm" variant="ghost" className="text-red-500 h-7 px-2 text-xs"
                          onClick={() => handleCancel(app.id)}>
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

      {/* Apply Permission Dialog */}
      <Dialog open={showApply} onOpenChange={setShowApply}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apply for Permission</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.permissionDate} onChange={e => setForm(f => ({ ...f, permissionDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time *</Label>
                <Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div>
                <Label>End Time *</Label>
                <Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            {form.startTime && form.endTime && form.endTime > form.startTime && (
              <div className="text-xs text-gray-500 bg-blue-50 rounded p-2">
                Duration: <strong>{fmtMins((Number(form.endTime.split(":")[0]) * 60 + Number(form.endTime.split(":")[1])) - (Number(form.startTime.split(":")[0]) * 60 + Number(form.startTime.split(":")[1])))}</strong>
                {remainingMins > 0 && <span className="ml-2">• Remaining: {fmtMins(remainingMins)}</span>}
              </div>
            )}
            <div>
              <Label>Reason *</Label>
              <Textarea placeholder="Reason for permission..." value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApply(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitMutation.isPending || !form.permissionDate || !form.startTime || !form.endTime || !form.reason.trim()}>
              {submitMutation.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={!!showAction} onOpenChange={o => { if (!o) { setShowAction(null); setActionRemarks(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{showAction?.action} Permission</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Remarks (optional)</Label>
            <Textarea value={actionRemarks} onChange={e => setActionRemarks(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAction(null); setActionRemarks(""); }}>Cancel</Button>
            <Button
              className={showAction?.action === "Approved" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              onClick={handleAction} disabled={actionMutation.isPending}>
              {actionMutation.isPending ? "Processing..." : showAction?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override Limit Dialog */}
      <Dialog open={showOverride} onOpenChange={setShowOverride}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Override Permission Limit</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Override the monthly permission limit for this employee for {monthName}.</p>
            <div>
              <Label>New Limit (minutes)</Label>
              <Input type="number" min="0" value={overrideForm.newLimitMinutes} onChange={e => setOverrideForm(f => ({ ...f, newLimitMinutes: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">Current: {fmtMins(limitMins)}</p>
            </div>
            <div>
              <Label>Justification *</Label>
              <Textarea value={overrideForm.justification} onChange={e => setOverrideForm(f => ({ ...f, justification: e.target.value }))} rows={3} placeholder="Reason for override..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOverride(false)}>Cancel</Button>
            <Button onClick={handleOverride} disabled={!overrideForm.justification.trim() || overrideMutation.isPending}>
              {overrideMutation.isPending ? "Saving..." : "Apply Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
