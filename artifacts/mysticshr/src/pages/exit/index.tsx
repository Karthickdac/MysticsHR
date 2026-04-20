import { useState } from "react";
import { Link } from "wouter";
import {
  useListExitRequests,
  useCreateExitRequest,
  getListExitRequestsQueryKey,
  type CreateExitRequestBody,
  type ExitRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, LogOut, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

const EXIT_TYPES = ["Resignation", "Termination", "Retirement", "Contract Expiry"] as const;
type ExitType = (typeof EXIT_TYPES)[number];

const STATUS_COLORS: Record<string, string> = {
  Submitted: "bg-blue-100 text-blue-800",
  "HR Reviewing": "bg-purple-100 text-purple-800",
  "Notice Period": "bg-yellow-100 text-yellow-800",
  "Clearance Pending": "bg-orange-100 text-orange-800",
  "FnF Pending": "bg-amber-100 text-amber-800",
  "FnF Approved": "bg-teal-100 text-teal-800",
  Separated: "bg-gray-100 text-gray-600",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-gray-100 text-gray-500",
};

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

function ResignationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateExitRequest();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ exitType: "Resignation" as ExitType, reason: "", requestedLwd: today });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim() || !form.requestedLwd) return;
    create.mutate(
      { data: form as CreateExitRequestBody },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExitRequestsQueryKey() });
          setForm({ exitType: "Resignation", reason: "", requestedLwd: today });
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit Resignation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Exit Type *</Label>
            <Select value={form.exitType} onValueChange={(v) => setForm((f) => ({ ...f, exitType: v as ExitType }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXIT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason for Leaving *</Label>
            <Textarea
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Please explain your reason for leaving..."
              rows={4}
              required
            />
          </div>
          <div>
            <Label>Requested Last Working Day *</Label>
            <Input
              type="date"
              value={form.requestedLwd}
              min={today}
              onChange={(e) => setForm((f) => ({ ...f, requestedLwd: e.target.value }))}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending} className="bg-red-600 hover:bg-red-700 text-white">
              {create.isPending ? "Submitting..." : "Submit Resignation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HrInitiateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateExitRequest();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ employeeId: "", exitType: "Termination" as ExitType, reason: "", requestedLwd: today });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim() || !form.requestedLwd || !form.employeeId) return;
    create.mutate(
      { data: { ...form, employeeId: Number(form.employeeId) } as unknown as CreateExitRequestBody },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExitRequestsQueryKey() });
          setForm({ employeeId: "", exitType: "Termination", reason: "", requestedLwd: today });
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Initiate Exit for Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Employee ID *</Label>
            <Input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder="e.g. 42" required />
          </div>
          <div>
            <Label>Exit Type *</Label>
            <Select value={form.exitType} onValueChange={(v) => setForm((f) => ({ ...f, exitType: v as ExitType }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXIT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason *</Label>
            <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={3} required />
          </div>
          <div>
            <Label>Last Working Day *</Label>
            <Input type="date" value={form.requestedLwd} min={today} onChange={(e) => setForm((f) => ({ ...f, requestedLwd: e.target.value }))} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Initiating..." : "Initiate Exit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ExitPage() {
  const { hrmsUser } = useCurrentHrmsUser();
  const isHr = HR_ROLES.includes(hrmsUser?.role as any);
  const [resignModal, setResignModal] = useState(false);
  const [initiateModal, setInitiateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data: requests = [], isLoading } = useListExitRequests({
    status: statusFilter || undefined,
    exitType: typeFilter || undefined,
  } as any);

  const kpi = {
    submitted: requests.filter((r: ExitRequest) => r.status === "Submitted").length,
    noticePeriod: requests.filter((r: ExitRequest) => r.status === "Notice Period").length,
    clearancePending: requests.filter((r: ExitRequest) => r.status === "Clearance Pending").length,
    fnfPending: requests.filter((r: ExitRequest) => r.status === "FnF Pending").length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LogOut className="w-6 h-6 text-red-600" />
            Exit & Offboarding
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isHr ? "Manage employee exits, clearance, FnF, and offboarding" : "Submit your resignation and track your offboarding status"}
          </p>
        </div>
        <div className="flex gap-2">
          {!isHr && (
            <Button onClick={() => setResignModal(true)} className="bg-red-600 hover:bg-red-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Submit Resignation
            </Button>
          )}
          {isHr && (
            <Button onClick={() => setInitiateModal(true)} variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Initiate Exit
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards (HR only) */}
      {isHr && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="text-sm text-blue-700 font-medium">New Submissions</div>
              <div className="text-2xl font-bold text-blue-900">{kpi.submitted}</div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4">
              <div className="text-sm text-yellow-700 font-medium">Notice Period</div>
              <div className="text-2xl font-bold text-yellow-900">{kpi.noticePeriod}</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4">
              <div className="text-sm text-orange-700 font-medium">Clearance Pending</div>
              <div className="text-2xl font-bold text-orange-900">{kpi.clearancePending}</div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <div className="text-sm text-amber-700 font-medium">FnF Pending</div>
              <div className="text-2xl font-bold text-amber-900">{kpi.fnfPending}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Select value={statusFilter || "_all"} onValueChange={(v) => setStatusFilter(v === "_all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter || "_all"} onValueChange={(v) => setTypeFilter(v === "_all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Exit Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Exit Types</SelectItem>
              {EXIT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {(statusFilter || typeFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(""); setTypeFilter(""); }}>Clear</Button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exit Requests ({requests.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <LogOut className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>{isHr ? "No exit requests found." : "You have no exit requests."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    {isHr && <th className="px-4 py-3 text-left font-medium text-gray-600">Employee</th>}
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Exit Type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Requested LWD</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Notice Days</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(requests as ExitRequest[]).map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      {isHr && (
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{(r as any).employeeName ?? `Emp #${r.employeeId}`}</div>
                          {(r as any).departmentName && <div className="text-xs text-gray-500">{(r as any).departmentName}</div>}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className="font-medium">{r.exitType}</span>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3">{r.requestedLwd ?? "—"}</td>
                      <td className="px-4 py-3">{r.noticePeriodDays ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(r.createdAt).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/exit/${r.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ResignationModal open={resignModal} onClose={() => setResignModal(false)} />
      <HrInitiateModal open={initiateModal} onClose={() => setInitiateModal(false)} />
    </div>
  );
}
