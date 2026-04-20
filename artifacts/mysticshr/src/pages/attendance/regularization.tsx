import { useState } from "react";
import {
  useGetAttendanceRegularizations,
  usePostAttendanceRegularizations,
  usePostAttendanceRegularizationsIdAction,
  getGetAttendanceRegularizationsQueryKey,
} from "@workspace/api-client-react";
import type { GetAttendanceRegularizationsQueryResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, CheckCircle, XCircle } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type RegularizationRecord = GetAttendanceRegularizationsQueryResult[number];

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
};

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RegularizationPage() {
  const qc = useQueryClient();
  const { role } = useCurrentUser();
  const canApprove = ["super_admin", "hr_manager", "hr_executive", "hod"].includes(role ?? "");
  const isEmployee = role === "employee";

  const [filterStatus, setFilterStatus] = useState("all");
  const { data: requests = [], isLoading } = useGetAttendanceRegularizations(filterStatus === "all" ? {} : { status: filterStatus as any });

  const createReg = usePostAttendanceRegularizations();
  const actionReg = usePostAttendanceRegularizationsIdAction();

  const [showForm, setShowForm] = useState(false);
  const [actionItem, setActionItem] = useState<RegularizationRecord | null>(null);
  const [actionRemarks, setActionRemarks] = useState("");
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ attendanceDate: "", requestedSignIn: "", requestedSignOut: "", reason: "" });

  async function handleSubmitRequest() {
    setFormError("");
    if (!form.attendanceDate || !form.reason) { setFormError("Date and reason are required"); return; }
    try {
      const today = new Date().toISOString().split("T")[0];
      await createReg.mutateAsync({
        data: {
          attendanceDate: form.attendanceDate,
          requestedSignIn: form.requestedSignIn ? new Date(`${form.attendanceDate}T${form.requestedSignIn}`).toISOString() : undefined,
          requestedSignOut: form.requestedSignOut ? new Date(`${form.attendanceDate}T${form.requestedSignOut}`).toISOString() : undefined,
          reason: form.reason,
        }
      });
      await qc.invalidateQueries({ queryKey: getGetAttendanceRegularizationsQueryKey({}) });
      setShowForm(false);
      setForm({ attendanceDate: "", requestedSignIn: "", requestedSignOut: "", reason: "" });
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to submit");
    }
  }

  async function handleAction(action: "Approved" | "Rejected") {
    if (!actionItem) return;
    try {
      await actionReg.mutateAsync({ id: actionItem.id, data: { action, remarks: actionRemarks || undefined } });
      await qc.invalidateQueries({ queryKey: getGetAttendanceRegularizationsQueryKey({}) });
      setActionItem(null);
      setActionRemarks("");
    } catch (e: any) {
      alert(e?.message ?? "Action failed");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Attendance Regularization</h1>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => { setForm({ attendanceDate: "", requestedSignIn: "", requestedSignOut: "", reason: "" }); setFormError(""); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" />New Request
          </Button>
        </div>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="space-y-3">
          {requests.map((r: RegularizationRecord) => (
            <Card key={r.id}>
              <CardContent className="py-3 flex flex-wrap items-start gap-4 justify-between">
                <div className="text-sm space-y-1">
                  <div className="font-medium">{r.employeeName ?? `Employee #${r.employeeId}`} — {r.attendanceDate}</div>
                  <div className="text-muted-foreground">
                    Requested: {fmt(r.requestedSignIn)} – {fmt(r.requestedSignOut)}
                  </div>
                  <div className="text-muted-foreground">Reason: {r.reason}</div>
                  {r.hodRemarks && <div className="text-muted-foreground text-xs">HOD Remarks: {r.hodRemarks}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                  {canApprove && r.status === "Pending" && (
                    <Button size="sm" variant="outline" onClick={() => { setActionItem(r); setActionRemarks(""); }}>
                      Review
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {requests.length === 0 && <p className="text-muted-foreground">No regularization requests found.</p>}
        </div>
      )}

      {/* Submit Request Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Regularization Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-red-500 text-sm">{formError}</p>}
            <div><Label>Attendance Date *</Label><Input type="date" value={form.attendanceDate} onChange={e => setForm({ ...form, attendanceDate: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Requested Sign In</Label><Input type="time" value={form.requestedSignIn} onChange={e => setForm({ ...form, requestedSignIn: e.target.value })} /></div>
              <div><Label>Requested Sign Out</Label><Input type="time" value={form.requestedSignOut} onChange={e => setForm({ ...form, requestedSignOut: e.target.value })} /></div>
            </div>
            <div><Label>Reason *</Label><Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmitRequest} disabled={createReg.isPending}>Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={!!actionItem} onOpenChange={() => setActionItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Regularization — {actionItem?.attendanceDate}</DialogTitle>
          </DialogHeader>
          {actionItem && (
            <div className="text-sm space-y-2">
              <div><span className="font-medium">Employee:</span> {actionItem.employeeName}</div>
              <div><span className="font-medium">Date:</span> {actionItem.attendanceDate}</div>
              <div><span className="font-medium">Requested:</span> {fmt(actionItem.requestedSignIn)} – {fmt(actionItem.requestedSignOut)}</div>
              <div><span className="font-medium">Reason:</span> {actionItem.reason}</div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Remarks (optional)</Label>
            <Textarea value={actionRemarks} onChange={e => setActionRemarks(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionItem(null)}>Cancel</Button>
            <Button variant="outline" className="text-red-600" onClick={() => handleAction("Rejected")} disabled={actionReg.isPending}>
              <XCircle className="w-4 h-4 mr-1" />Reject
            </Button>
            <Button onClick={() => handleAction("Approved")} disabled={actionReg.isPending}>
              <CheckCircle className="w-4 h-4 mr-1" />Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
