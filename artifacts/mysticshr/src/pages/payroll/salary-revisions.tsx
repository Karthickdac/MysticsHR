import { useState } from "react";
import {
  useListSalaryRevisions, useCreateSalaryRevision, useActionSalaryRevision,
  useListSalaryStructures, getListSalaryRevisionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, TrendingUp, CheckCircle2, XCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
};

function fmt(n: string | number | null | undefined) {
  if (!n) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SalaryRevisionsPage() {
  const { role } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"].includes(role ?? "");
  const isSuperAdmin = role === "super_admin";

  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("_all");
  const [showCreate, setShowCreate] = useState(false);
  const [actionRevision, setActionRevision] = useState<any | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [error, setError] = useState<string | null>(null);

  const { data: revisions, isLoading } = useListSalaryRevisions({ status: statusFilter === "_all" ? undefined : statusFilter });
  const { data: structures } = useListSalaryStructures({ isActive: "true" });

  const createMutation = useCreateSalaryRevision();
  const actionMutation = useActionSalaryRevision();

  const [form, setForm] = useState({
    employeeId: "",
    newStructureId: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    reason: "",
  });
  const [actionRemarks, setActionRemarks] = useState("");

  async function handleCreate() {
    setError(null);
    if (!form.employeeId || !form.newStructureId || !form.reason) { setError("Please fill all required fields"); return; }
    try {
      await createMutation.mutateAsync({
        data: {
          employeeId: Number(form.employeeId),
          newStructureId: Number(form.newStructureId),
          effectiveDate: form.effectiveDate,
          reason: form.reason,
        },
      });
      qc.invalidateQueries({ queryKey: getListSalaryRevisionsQueryKey({}) });
      setShowCreate(false);
      setForm({ employeeId: "", newStructureId: "", effectiveDate: new Date().toISOString().split("T")[0], reason: "" });
    } catch (e: any) { setError(e?.response?.data?.error ?? "Failed"); }
  }

  async function handleAction() {
    if (!actionRevision) return;
    setError(null);
    try {
      await actionMutation.mutateAsync({ id: actionRevision.id, data: { action: actionType, approvalRemarks: actionRemarks || undefined } });
      qc.invalidateQueries({ queryKey: getListSalaryRevisionsQueryKey({}) });
      setActionRevision(null); setActionRemarks("");
    } catch (e: any) { setError(e?.response?.data?.error ?? "Failed"); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Salary Revisions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage salary revision requests with effective date workflow.</p>
        </div>
        {isHr && (
          <Button onClick={() => { setShowCreate(true); setError(null); }}>
            <Plus className="w-4 h-4 mr-1" />Request Revision
          </Button>
        )}
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Statuses</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : !revisions?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No salary revisions found</p>
          <p className="text-sm">Create a revision request to update an employee's salary structure.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {revisions.map(r => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.employeeName ?? `Employee #${r.employeeId}`}</span>
                      {r.employeeCode && <Badge variant="outline" className="text-xs">{r.employeeCode}</Badge>}
                      <Badge className={`text-xs ${STATUS_COLORS[r.status]}`}>{r.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Effective: {fmtDate(r.effectiveDate)} · Requested: {fmtDate(r.createdAt)}
                    </p>
                    <p className="text-sm mt-1">Reason: {r.reason}</p>
                    {r.approvalRemarks && (
                      <p className="text-sm text-muted-foreground mt-1">Remarks: {r.approvalRemarks}</p>
                    )}
                  </div>
                  {isSuperAdmin && r.status === "Pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setActionRevision(r); setActionType("approve"); setError(null); setActionRemarks(""); }}>
                        <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setActionRevision(r); setActionType("reject"); setError(null); setActionRemarks(""); }}>
                        <XCircle className="w-3 h-3 mr-1 text-red-600" />Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Request Salary Revision</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Employee ID <span className="text-red-500">*</span></Label>
              <Input type="number" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="Employee DB ID" />
            </div>
            <div className="space-y-1">
              <Label>New Salary Structure <span className="text-red-500">*</span></Label>
              <Select value={form.newStructureId} onValueChange={v => setForm(f => ({ ...f, newStructureId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select new structure" /></SelectTrigger>
                <SelectContent>
                  {structures?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.employeeName ? `${s.employeeName} — ` : ""}{s.name} (₹{Number(s.grossCtc).toLocaleString("en-IN")}/mo)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Effective Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Annual appraisal, promotion, market correction..." rows={3} />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={!!actionRevision} onOpenChange={v => !v && setActionRevision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === "approve" ? "Approve" : "Reject"} Salary Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {actionType === "approve"
                ? "This will activate the new salary structure from the effective date."
                : "This will reject the revision request."}
            </p>
            <div className="space-y-1">
              <Label>Remarks (optional)</Label>
              <Textarea value={actionRemarks} onChange={e => setActionRemarks(e.target.value)} rows={2} />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionRevision(null)}>Cancel</Button>
            <Button onClick={handleAction} disabled={actionMutation.isPending}
              className={actionType === "reject" ? "bg-red-600 hover:bg-red-700" : ""}>
              {actionMutation.isPending ? "Processing..." : (actionType === "approve" ? "Approve" : "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
