import { useState } from "react";
import {
  useListLeaveApplications,
  useHodActionLeave,
  useHrActionLeave,
  useCancelActionLeaveApplication,
  useInitializeLeaveBalances,
  getListLeaveApplicationsQueryKey,
  getListLeaveBalancesQueryKey,
  type InitializeLeaveBalances200,
  type LeaveApplication,
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
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

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

type ActionState =
  | { kind: "approval"; id: number; type: "hod" | "hr"; action: "Approved" | "Rejected" }
  | { kind: "cancel-action"; id: number; action: "Approved" | "Rejected" };

export default function LeaveApprovalsPage() {
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = hrmsRole ?? "employee";
  const isHr = ["super_admin", "hr_manager", "hr_executive"].includes(role);
  const isHod = role === "hod";

  const qc = useQueryClient();
  const { data: applications, isLoading } = useListLeaveApplications({});
  const hodMutation = useHodActionLeave();
  const hrMutation = useHrActionLeave();
  const cancelActionMutation = useCancelActionLeaveApplication();
  const initMutation = useInitializeLeaveBalances();

  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [remarks, setRemarks] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showInit, setShowInit] = useState(false);
  const [initYear, setInitYear] = useState(String(new Date().getFullYear()));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListLeaveApplicationsQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListLeaveBalancesQueryKey({}) });
  };

  async function handleAction() {
    if (!actionState) return;
    try {
      if (actionState.kind === "cancel-action") {
        await cancelActionMutation.mutateAsync({ id: actionState.id, data: { action: actionState.action, remarks: remarks || undefined } });
      } else if (actionState.type === "hod") {
        await hodMutation.mutateAsync({ id: actionState.id, data: { action: actionState.action, remarks: remarks || undefined } });
      } else {
        await hrMutation.mutateAsync({ id: actionState.id, data: { action: actionState.action, remarks: remarks || undefined } });
      }
      invalidate();
      setActionState(null);
      setRemarks("");
    } catch (err: any) {
      alert(err?.response?.data?.error ?? "Action failed");
    }
  }

  async function handleInitBalances() {
    try {
      const result: InitializeLeaveBalances200 = await initMutation.mutateAsync({ data: { year: Number(initYear) } });
      alert(`Initialized ${result.count} leave balance records for ${initYear}.`);
      setShowInit(false);
    } catch { alert("Failed to initialize balances"); }
  }

  const filtered = (applications ?? []).filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    return true;
  });

  function getApprovalActions(app: LeaveApplication): Array<{ type: "hod" | "hr"; action: "Approved" | "Rejected" }> {
    const actions: Array<{ type: "hod" | "hr"; action: "Approved" | "Rejected" }> = [];
    if (app.status === "Pending") {
      if (isHr) {
        // HR users action Pending apps directly with HR-type so backend bypasses/replaces HOD step
        actions.push({ type: "hr", action: "Approved" }, { type: "hr", action: "Rejected" });
      } else if (isHod) {
        actions.push({ type: "hod", action: "Approved" }, { type: "hod", action: "Rejected" });
      }
    }
    if (isHr && app.status === "HOD Approved") {
      actions.push({ type: "hr", action: "Approved" }, { type: "hr", action: "Rejected" });
    }
    return actions;
  }

  const isMutating = hodMutation.isPending || hrMutation.isPending || cancelActionMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Approvals</h1>
          <p className="text-sm text-gray-500 mt-1">Review and approve leave applications</p>
        </div>
        <div className="flex gap-2">
          {isHr && (
            <Button size="sm" variant="outline" onClick={() => setShowInit(true)}>
              <RefreshCw className="w-4 h-4 mr-1" />Initialize Balances
            </Button>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="HOD Approved">HOD Approved</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Cancel Requested">Cancel Requested</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
              <SelectItem value="Cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No applications found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => {
            const approvalActions = getApprovalActions(app);
            const canActionCancel = (isHod || isHr) && app.status === "Cancel Requested";
            return (
              <Card key={app.id} className="border shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{app.employeeName}</span>
                        {app.employeeCode && <span className="text-xs text-gray-400">({app.employeeCode})</span>}
                        {app.departmentName && <span className="text-xs text-gray-400">• {app.departmentName}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                        <Badge variant="outline" className="font-mono text-xs">{app.leaveTypeCode}</Badge>
                        <span>{app.leaveTypeName}</span>
                        {app.isLop && <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">LOP</Badge>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {fmtDate(app.fromDate)} — {fmtDate(app.toDate)} ({app.totalDays} day{parseFloat(app.totalDays) !== 1 ? "s" : ""})
                        {app.isHalfDay && ` • ${app.halfDaySession}`}
                      </div>
                      {app.reason && <div className="text-xs text-gray-400 italic">{app.reason}</div>}
                      {app.cancellationReason && app.status === "Cancel Requested" && (
                        <div className="text-xs text-orange-600">Cancel reason: {app.cancellationReason}</div>
                      )}
                      {app.hodRemarks && <div className="text-xs text-blue-500">HOD: {app.hodRemarks}</div>}
                      {app.hrRemarks && <div className="text-xs text-indigo-500">HR: {app.hrRemarks}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge className={STATUS_COLORS[app.status] ?? ""}>{app.status}</Badge>
                      {approvalActions.length > 0 && (
                        <div className="flex gap-1">
                          {approvalActions.filter(a => a.action === "Approved").length > 0 && (
                            <Button size="sm" variant="outline" className="text-green-600 border-green-200 h-7 text-xs gap-1"
                              onClick={() => { setActionState({ kind: "approval", id: app.id, type: approvalActions.find(a => a.action === "Approved")!.type, action: "Approved" }); setRemarks(""); }}>
                              <CheckCircle className="w-3 h-3" />Approve
                            </Button>
                          )}
                          {approvalActions.filter(a => a.action === "Rejected").length > 0 && (
                            <Button size="sm" variant="outline" className="text-red-500 border-red-200 h-7 text-xs gap-1"
                              onClick={() => { setActionState({ kind: "approval", id: app.id, type: approvalActions.find(a => a.action === "Rejected")!.type, action: "Rejected" }); setRemarks(""); }}>
                              <XCircle className="w-3 h-3" />Reject
                            </Button>
                          )}
                        </div>
                      )}
                      {canActionCancel && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-green-600 border-green-200 h-7 text-xs gap-1"
                            onClick={() => { setActionState({ kind: "cancel-action", id: app.id, action: "Approved" }); setRemarks(""); }}>
                            <CheckCircle className="w-3 h-3" />Allow Cancel
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-500 border-red-200 h-7 text-xs gap-1"
                            onClick={() => { setActionState({ kind: "cancel-action", id: app.id, action: "Rejected" }); setRemarks(""); }}>
                            <XCircle className="w-3 h-3" />Deny Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Action dialog */}
      <Dialog open={!!actionState} onOpenChange={(o) => { if (!o) { setActionState(null); setRemarks(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionState?.kind === "cancel-action"
                ? `${actionState.action === "Approved" ? "Allow" : "Deny"} Cancellation Request`
                : `${actionState?.action} Leave Application`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Remarks {actionState?.action === "Rejected" ? "(recommended)" : "(optional)"}</Label>
            <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Add remarks..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionState(null); setRemarks(""); }}>Close</Button>
            <Button
              className={actionState?.action === "Approved" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              onClick={handleAction}
              disabled={isMutating}>
              {isMutating ? "Processing..." : actionState?.action === "Approved" ? "Confirm" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Initialize balances dialog */}
      <Dialog open={showInit} onOpenChange={setShowInit}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Initialize Leave Balances</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">This will create leave balance records for all active employees for the selected year, based on each active leave type's annual quota.</p>
            <div>
              <Label>Year</Label>
              <Input type="number" value={initYear} onChange={e => setInitYear(e.target.value)} min="2020" max="2030" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInit(false)}>Close</Button>
            <Button onClick={handleInitBalances} disabled={initMutation.isPending}>
              {initMutation.isPending ? "Initializing..." : "Initialize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
