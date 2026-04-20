import { useState } from "react";
import {
  useListPayrollRuns, useCreatePayrollRun, useComputePayrollRun, useApprovePayrollRun,
  useFinalizePayrollRun, useListPayrollLocks, useLockPayroll, useUnlockPayroll,
  getListPayrollRunsQueryKey, getListPayrollLocksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { extractError } from "@/lib/utils";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, CheckCircle2, Lock, Unlock, FileText, RefreshCw, Plus, ChevronRight,
  Banknote, Users, TrendingUp, TrendingDown,
} from "lucide-react";

const RUN_STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Computed: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Locked: "bg-purple-100 text-purple-700",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

export default function PayrollDashboardPage() {
  const { role } = useCurrentHrmsUser();
  const isAdmin = ["super_admin", "payroll_admin"].includes(role ?? "");
  const isSuperAdmin = role === "super_admin";

  const qc = useQueryClient();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const { data: runs, isLoading } = useListPayrollRuns();
  const { data: locks } = useListPayrollLocks({ year: currentYear, month: currentMonth });

  const createRun = useCreatePayrollRun();
  const computeRun = useComputePayrollRun();
  const approveRun = useApprovePayrollRun();
  const finalizeRun = useFinalizePayrollRun();
  const lockPayroll = useLockPayroll();
  const unlockPayroll = useUnlockPayroll();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ periodYear: String(currentYear), periodMonth: String(currentMonth), notes: "" });
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentLock = locks?.[0];
  const isCurrentlyLocked = currentLock?.isLocked === true;

  const totalNetPaid = runs?.filter(r => r.status === "Locked").reduce((s, r) => s + Number(r.totalNet), 0) ?? 0;
  const lastRun = runs?.[0];

  async function handleCreate() {
    try {
      await createRun.mutateAsync({ data: { periodYear: Number(newForm.periodYear), periodMonth: Number(newForm.periodMonth), notes: newForm.notes || undefined } });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPayrollLocksQueryKey({}) });
      setShowNew(false);
    } catch (err: unknown) { setActionError(extractError(err, "Failed to create run")); }
  }

  async function handleCompute(id: number) {
    setBusy(id); setActionError(null);
    try {
      await computeRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to compute")); }
    finally { setBusy(null); }
  }

  async function handleApprove(id: number) {
    setBusy(id); setActionError(null);
    try {
      await approveRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to approve")); }
    finally { setBusy(null); }
  }

  async function handleFinalize(id: number) {
    setBusy(id); setActionError(null);
    try {
      await finalizeRun.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPayrollRunsQueryKey() });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to finalize")); }
    finally { setBusy(null); }
  }

  async function handleToggleLock() {
    setActionError(null);
    try {
      if (isCurrentlyLocked) {
        await unlockPayroll.mutateAsync({ year: currentYear, month: currentMonth });
      } else {
        await lockPayroll.mutateAsync({ year: currentYear, month: currentMonth });
      }
      qc.invalidateQueries({ queryKey: getListPayrollLocksQueryKey({}) });
    } catch (err: unknown) { setActionError(extractError(err, "Failed to toggle lock")); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Process monthly payroll, manage salary structures, and generate payslips.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button onClick={() => { setShowNew(true); setActionError(null); }}>
              <Plus className="w-4 h-4 mr-1" /> New Payroll Run
            </Button>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Salary Structures", href: "/payroll/salary-structures", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Payslips", href: "/payroll/payslips", icon: FileText, color: "text-green-600", bg: "bg-green-50" },
          { label: "Tax Declaration", href: "/payroll/tax-declaration", icon: Banknote, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Salary Revisions", href: "/payroll/salary-revisions", icon: TrendingUp, color: "text-orange-600", bg: "bg-orange-50" },
        ].map(item => (
          <Link key={item.href} href={item.href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${item.bg}`}>
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <span className="font-medium text-sm">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Runs</p>
            <p className="text-3xl font-bold mt-1">{runs?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Net Pay</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{lastRun ? fmt(lastRun.totalNet) : "—"}</p>
            <p className="text-xs text-muted-foreground">{lastRun ? `${MONTHS[lastRun.periodMonth - 1]} ${lastRun.periodYear}` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Period</p>
            <p className="text-lg font-bold mt-1">{MONTHS[currentMonth - 1]} {currentYear}</p>
            <Badge className={`mt-1 text-xs ${isCurrentlyLocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
              {isCurrentlyLocked ? "🔒 Locked" : "🔓 Open"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Disbursed (FY)</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{fmt(totalNetPaid)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Lock Control */}
      {isAdmin && (
        <Card className={`border-2 ${isCurrentlyLocked ? "border-red-200 bg-red-50/40" : "border-green-200 bg-green-50/40"}`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold">{MONTHS[currentMonth - 1]} {currentYear} — Payroll Lock</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isCurrentlyLocked
                  ? "Payroll is locked. Salary edits, attendance changes, and leave balance adjustments are blocked."
                  : "Payroll is open. Initiating a new run will auto-lock the period."}
              </p>
            </div>
            {isSuperAdmin && (
              <Button variant={isCurrentlyLocked ? "outline" : "secondary"} size="sm" onClick={handleToggleLock} disabled={lockPayroll.isPending || unlockPayroll.isPending}>
                {isCurrentlyLocked ? <><Unlock className="w-4 h-4 mr-1" />Unlock</> : <><Lock className="w-4 h-4 mr-1" />Lock</>}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {actionError && (
        <div className="bg-red-50 text-red-700 rounded-lg p-3 text-sm border border-red-200">{actionError}</div>
      )}

      {/* Payroll Runs Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Payroll Run History</CardTitle>
            {isAdmin && (
              <Link href="/payroll/reports">
                <Button variant="outline" size="sm">
                  <FileText className="w-4 h-4 mr-1" /> Statutory Reports
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : !runs?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No payroll runs yet</p>
              <p className="text-sm">Start the first payroll run for this month.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Period</th>
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Employees</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Gross</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Deductions</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Net Pay</th>
                    {isAdmin && <th className="text-center py-2 font-medium text-muted-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-3">
                        <Link href={`/payroll/runs/${run.id}`} className="font-semibold text-primary hover:underline">
                          {MONTHS[run.periodMonth - 1]} {run.periodYear}
                        </Link>
                        {run.initiatorName && <p className="text-xs text-muted-foreground">by {run.initiatorName}</p>}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge className={`text-xs ${RUN_STATUS_COLORS[run.status]}`}>{run.status}</Badge>
                      </td>
                      <td className="py-3 pr-3 text-right">{run.totalEmployees}</td>
                      <td className="py-3 pr-3 text-right">{fmt(run.totalGross)}</td>
                      <td className="py-3 pr-3 text-right text-red-600">{fmt(run.totalDeductions)}</td>
                      <td className="py-3 pr-3 text-right font-semibold text-green-700">{fmt(run.totalNet)}</td>
                      {isAdmin && (
                        <td className="py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {run.status === "Draft" && (
                              <Button size="sm" variant="outline" onClick={() => handleCompute(run.id)} disabled={busy === run.id}>
                                {busy === run.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                <span className="ml-1">Compute</span>
                              </Button>
                            )}
                            {run.status === "Computed" && (
                              <Button size="sm" variant="outline" onClick={() => handleCompute(run.id)} disabled={busy === run.id} title="Recompute">
                                <RefreshCw className="w-3 h-3" />
                              </Button>
                            )}
                            {run.status === "Computed" && isSuperAdmin && (
                              <Button size="sm" onClick={() => handleApprove(run.id)} disabled={busy === run.id}>
                                <CheckCircle2 className="w-3 h-3 mr-1" />Approve
                              </Button>
                            )}
                            {run.status === "Approved" && isSuperAdmin && (
                              <Button size="sm" variant="outline" onClick={() => handleFinalize(run.id)} disabled={busy === run.id}>
                                <Lock className="w-3 h-3 mr-1" />Finalize
                              </Button>
                            )}
                            <Link href={`/payroll/runs/${run.id}`}>
                              <Button size="sm" variant="ghost" title="View Records">
                                <ChevronRight className="w-3 h-3" />
                              </Button>
                            </Link>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Run Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Initiate Payroll Run</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Year</Label>
                <Input type="number" value={newForm.periodYear} onChange={e => setNewForm(f => ({ ...f, periodYear: e.target.value }))} min="2020" max="2030" />
              </div>
              <div className="space-y-1">
                <Label>Month</Label>
                <Select value={newForm.periodMonth} onValueChange={v => setNewForm(f => ({ ...f, periodMonth: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <p className="text-xs text-muted-foreground bg-yellow-50 p-3 rounded-lg border border-yellow-100">
              ⚠️ Initiating a payroll run will lock the period, preventing salary edits, attendance changes, and leave balance adjustments.
            </p>
            {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createRun.isPending}>
              {createRun.isPending ? "Initiating..." : "Initiate Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
