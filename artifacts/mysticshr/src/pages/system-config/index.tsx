import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSystemSettings,
  useUpdateSystemSettings,
  useGetNotificationDefaults,
  useUpdateNotificationDefaults,
  useListApprovalChains,
  useCreateApprovalChain,
  useUpdateApprovalChain,
  useDeleteApprovalChain,
  getListApprovalChainsQueryKey,
  useGetRolePermissions,
  useUpdateRolePermissions,
  getGetRolePermissionsQueryKey,
  useGetAttendanceSuspicionConfig,
  useUpdateAttendanceSuspicionConfig,
  getGetAttendanceSuspicionConfigQueryKey,
  type ApprovalChainConfig,
  type RolePermissions,
  type RolePermissionsItem,
} from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Settings, Building2, Scale, Banknote, CalendarDays, ShieldCheck, Plus, Pencil, Trash2, Lock, FormInput, Ban, HardDrive, RefreshCw, Play, AlertTriangle, Mail, MessageSquare, Database, Server } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@clerk/react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── Settings form helper ─────────────────────────────────────────────────────

function useSettingsForm(category: string) {
  const { data: settings, isLoading } = useGetSystemSettings(category);
  const updateMut = useUpdateSystemSettings();
  const [form, setForm] = useState<Record<string, string>>({});
  const saved = (settings as Record<string, string> | undefined) ?? {};

  useEffect(() => { if (!isLoading && settings) setForm(saved); }, [isLoading]);

  const merged = { ...saved, ...form };
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    await updateMut.mutateAsync({ category, data: merged });
    toast({ title: "Settings saved" });
  }

  return { merged, set, save, isSaving: updateMut.isPending };
}

// ─── Org Profile Tab ──────────────────────────────────────────────────────────

function OrgProfileTab() {
  const { merged, set, save, isSaving } = useSettingsForm("org_profile");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Organization Profile</CardTitle>
        <CardDescription>Configure organization details used in letterheads, offer letters, and system branding.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Organization Name</Label>
            <Input value={merged.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Automystics Technologies" />
          </div>
          <div>
            <Label>Legal Entity Name</Label>
            <Input value={merged.legalName ?? ""} onChange={(e) => set("legalName", e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Registered Address</Label>
          <Input value={merged.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123, Tech Park, Chennai, TN 600001" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>PAN</Label>
            <Input value={merged.pan ?? ""} onChange={(e) => set("pan", e.target.value)} placeholder="AAACT1234Z" />
          </div>
          <div>
            <Label>TAN</Label>
            <Input value={merged.tan ?? ""} onChange={(e) => set("tan", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>GSTIN</Label>
            <Input value={merged.gstin ?? ""} onChange={(e) => set("gstin", e.target.value)} />
          </div>
          <div>
            <Label>CIN</Label>
            <Input value={merged.cin ?? ""} onChange={(e) => set("cin", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>PF Registration Number</Label>
            <Input value={merged.pfRegNo ?? ""} onChange={(e) => set("pfRegNo", e.target.value)} />
          </div>
          <div>
            <Label>ESI Registration Number</Label>
            <Input value={merged.esiRegNo ?? ""} onChange={(e) => set("esiRegNo", e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Support Email</Label>
          <Input value={merged.supportEmail ?? ""} onChange={(e) => set("supportEmail", e.target.value)} placeholder="hr@automystics.com" />
        </div>
        <div>
          <Label>Website</Label>
          <Input value={merged.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="https://automystics.com" />
        </div>
        <Button onClick={save} disabled={isSaving}>Save Organization Profile</Button>
      </CardContent>
    </Card>
  );
}

// ─── Statutory Rates Tab ──────────────────────────────────────────────────────

function StatutoryRatesTab() {
  const { merged, set, save, isSaving } = useSettingsForm("statutory");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Scale className="w-4 h-4" />Provident Fund (PF)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Employee Contribution (%)</Label>
              <Input type="number" value={merged.pfEmployee ?? "12"} onChange={(e) => set("pfEmployee", e.target.value)} />
            </div>
            <div>
              <Label>Employer Contribution (%)</Label>
              <Input type="number" value={merged.pfEmployer ?? "12"} onChange={(e) => set("pfEmployer", e.target.value)} />
            </div>
            <div>
              <Label>Wage Ceiling (₹)</Label>
              <Input type="number" value={merged.pfWageCeiling ?? "15000"} onChange={(e) => set("pfWageCeiling", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={merged.pfOnActualWage === "true"} onCheckedChange={(v) => set("pfOnActualWage", String(v))} />
            <Label>Apply PF on actual wages (no ceiling cap)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee State Insurance (ESI)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Employee Rate (%)</Label>
              <Input type="number" step="0.01" value={merged.esiEmployee ?? "0.75"} onChange={(e) => set("esiEmployee", e.target.value)} />
            </div>
            <div>
              <Label>Employer Rate (%)</Label>
              <Input type="number" step="0.01" value={merged.esiEmployer ?? "3.25"} onChange={(e) => set("esiEmployer", e.target.value)} />
            </div>
            <div>
              <Label>Gross Wage Ceiling (₹)</Label>
              <Input type="number" value={merged.esiCeiling ?? "21000"} onChange={(e) => set("esiCeiling", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Professional Tax (PT) Slabs — Tamil Nadu</CardTitle>
          <CardDescription>Enter monthly PT slabs as JSON array: [{"{"}"min":0,"max":10000,"tax":0{"}"}]</CardDescription>
        </CardHeader>
        <CardContent className="max-w-lg">
          <div>
            <Label>PT Slabs (JSON)</Label>
            <textarea
              className="w-full h-32 text-sm font-mono border rounded p-2 mt-1 resize-none"
              value={merged.ptSlabs ?? '[{"min":0,"max":10000,"tax":0},{"min":10001,"max":15000,"tax":110},{"min":15001,"max":99999999,"tax":130}]'}
              onChange={(e) => set("ptSlabs", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income Tax Slabs</CardTitle>
          <CardDescription>Slabs apply for TDS computation. Enter as JSON for both regimes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div>
            <Label>Old Regime Slabs (JSON)</Label>
            <textarea
              className="w-full h-24 text-sm font-mono border rounded p-2 mt-1 resize-none"
              value={merged.itOldSlabs ?? '[{"min":0,"max":250000,"rate":0},{"min":250001,"max":500000,"rate":5},{"min":500001,"max":1000000,"rate":20},{"min":1000001,"max":99999999,"rate":30}]'}
              onChange={(e) => set("itOldSlabs", e.target.value)}
            />
          </div>
          <div>
            <Label>New Regime Slabs (JSON — FY 2024-25)</Label>
            <textarea
              className="w-full h-24 text-sm font-mono border rounded p-2 mt-1 resize-none"
              value={merged.itNewSlabs ?? '[{"min":0,"max":300000,"rate":0},{"min":300001,"max":600000,"rate":5},{"min":600001,"max":900000,"rate":10},{"min":900001,"max":1200000,"rate":15},{"min":1200001,"max":1500000,"rate":20},{"min":1500001,"max":99999999,"rate":30}]'}
              onChange={(e) => set("itNewSlabs", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Standard Deduction (Old Regime, ₹)</Label>
              <Input type="number" value={merged.standardDeductionOld ?? "50000"} onChange={(e) => set("standardDeductionOld", e.target.value)} />
            </div>
            <div>
              <Label>Standard Deduction (New Regime, ₹)</Label>
              <Input type="number" value={merged.standardDeductionNew ?? "75000"} onChange={(e) => set("standardDeductionNew", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={isSaving}>Save Statutory Settings</Button>
    </div>
  );
}

// ─── Financial Year Tab ───────────────────────────────────────────────────────

function FinancialYearTab() {
  const { merged, set, save, isSaving } = useSettingsForm("financial_year");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" />Financial Year & Leave Year</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Financial Year Start Month</Label>
            <Select value={merged.fyStartMonth ?? "4"} onValueChange={(v) => set("fyStartMonth", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Financial Year End Month</Label>
            <Select value={merged.fyEndMonth ?? "3"} onValueChange={(v) => set("fyEndMonth", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Separator />
        <div>
          <Label className="font-semibold">Leave Year</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Leave Year Start Month</Label>
            <Select value={merged.leaveYearStart ?? "1"} onValueChange={(v) => set("leaveYearStart", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Max Carry-Forward Days</Label>
            <Input type="number" value={merged.maxCarryForward ?? "15"} onChange={(e) => set("maxCarryForward", e.target.value)} />
          </div>
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Payroll Cut-Off Day</Label>
            <Input type="number" min={1} max={31} value={merged.payrollCutOff ?? "25"} onChange={(e) => set("payrollCutOff", e.target.value)} />
          </div>
          <div>
            <Label>Payroll Processing Day</Label>
            <Input type="number" min={1} max={31} value={merged.payrollProcessingDay ?? "1"} onChange={(e) => set("payrollProcessingDay", e.target.value)} />
          </div>
        </div>
        <Button onClick={save} disabled={isSaving}>Save Financial Year Settings</Button>
      </CardContent>
    </Card>
  );
}

// ─── Approval Chains Tab ──────────────────────────────────────────────────────

const TRANSACTION_TYPES = [
  "leave", "payroll", "recruitment", "exit", "document", "performance", "helpdesk",
];
const APPROVER_ROLES = [
  { value: "hod", label: "HOD" },
  { value: "hr_executive", label: "HR Executive" },
  { value: "hr_manager", label: "HR Manager" },
  { value: "payroll_admin", label: "Payroll Admin" },
  { value: "super_admin", label: "Super Admin" },
];

function ApprovalChainsTab() {
  const qc = useQueryClient();
  const { data: chains = [], isLoading } = useListApprovalChains();
  const createMut = useCreateApprovalChain();
  const updateMut = useUpdateApprovalChain();
  const deleteMut = useDeleteApprovalChain();

  const [editing, setEditing] = useState<ApprovalChainConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<ApprovalChainConfig>>({});

  function openCreate() {
    setForm({ step: 1, isActive: true });
    setCreating(true);
    setEditing(null);
  }

  function openEdit(c: ApprovalChainConfig) {
    setForm({ ...c });
    setEditing(c);
    setCreating(false);
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form as import("@workspace/api-client-react").CreateApprovalChainBody });
      } else {
        await createMut.mutateAsync({ data: form as import("@workspace/api-client-react").CreateApprovalChainBody });
      }
      qc.invalidateQueries({ queryKey: getListApprovalChainsQueryKey() });
      toast({ title: editing ? "Approval chain updated" : "Approval chain created" });
      setEditing(null);
      setCreating(false);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this step?")) return;
    await deleteMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListApprovalChainsQueryKey() });
    toast({ title: "Step deleted" });
  }

  const grouped = (chains as ApprovalChainConfig[]).reduce<Record<string, ApprovalChainConfig[]>>((acc, c) => {
    (acc[c.transactionType] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />Add Step</Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!isLoading && Object.keys(grouped).length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No approval chains configured yet.</p>
          <p className="text-sm mt-1">Approval workflows use built-in role defaults when no chain is set.</p>
        </div>
      )}

      {Object.entries(grouped).map(([txType, steps]) => (
        <Card key={txType}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm capitalize">{txType} Approval Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {steps.sort((a, b) => a.step - b.step).map((step) => (
                <div key={step.id} className="flex items-center gap-3 p-2 rounded border">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{step.step}</div>
                  <div className="flex-1">
                    <span className="text-sm font-medium">{step.approverLabel}</span>
                    <span className="text-xs text-muted-foreground ml-2">({step.approverRole})</span>
                    {step.escalationAfterHours && (
                      <span className="text-xs text-amber-600 ml-2">Escalate after {step.escalationAfterHours}h</span>
                    )}
                  </div>
                  <Badge className={step.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                    {step.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(step)}><Pencil className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => handleDelete(step.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Step" : "Add Approval Chain Step"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Transaction Type</Label>
              <Select value={form.transactionType ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, transactionType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Step #</Label>
                <Input type="number" min={1} value={form.step ?? 1} onChange={(e) => setForm((f) => ({ ...f, step: parseInt(e.target.value) }))} />
              </div>
              <div>
                <Label>Approver Role</Label>
                <Select value={form.approverRole ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, approverRole: v }))}>
                  <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
                  <SelectContent>
                    {APPROVER_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Approver Label</Label>
              <Input value={form.approverLabel ?? ""} onChange={(e) => setForm((f) => ({ ...f, approverLabel: e.target.value }))} placeholder="e.g. Department Head" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Escalate After (hours)</Label>
                <Input type="number" value={form.escalationAfterHours ?? ""} onChange={(e) => setForm((f) => ({ ...f, escalationAfterHours: e.target.value ? parseInt(e.target.value) : undefined }))} placeholder="24" />
              </div>
              <div>
                <Label>Escalate To (role)</Label>
                <Input value={form.escalateTo ?? ""} onChange={(e) => setForm((f) => ({ ...f, escalateTo: e.target.value }))} placeholder="hr_manager" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive ?? true} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Security Tab ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const { merged, set, save, isSaving } = useSettingsForm("security");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Session & Security Settings</CardTitle>
        <CardDescription>Configure authentication, session management, and access control settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Session Timeout (minutes)</Label>
            <Input type="number" value={merged.sessionTimeout ?? "480"} onChange={(e) => set("sessionTimeout", e.target.value)} />
          </div>
          <div>
            <Label>Max Login Attempts</Label>
            <Input type="number" value={merged.maxLoginAttempts ?? "5"} onChange={(e) => set("maxLoginAttempts", e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merged.mfaRequired === "true"} onCheckedChange={(v) => set("mfaRequired", String(v))} />
          <Label>Require Multi-Factor Authentication for all users</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merged.ipWhitelistEnabled === "true"} onCheckedChange={(v) => set("ipWhitelistEnabled", String(v))} />
          <Label>Enable IP Whitelist</Label>
        </div>
        {merged.ipWhitelistEnabled === "true" && (
          <div>
            <Label>Allowed IP Addresses (comma separated)</Label>
            <Input value={merged.ipWhitelist ?? ""} onChange={(e) => set("ipWhitelist", e.target.value)} placeholder="192.168.1.0/24, 10.0.0.1" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={merged.auditAllActions === "true"} onCheckedChange={(v) => set("auditAllActions", String(v))} />
          <Label>Audit all user actions</Label>
        </div>
        <div>
          <Label>Audit Log Retention (days)</Label>
          <Input type="number" value={merged.auditRetentionDays ?? "365"} onChange={(e) => set("auditRetentionDays", e.target.value)} />
        </div>
        <Button onClick={save} disabled={isSaving}>Save Security Settings</Button>
      </CardContent>
    </Card>
  );
}

// ─── Payroll Settings Tab ─────────────────────────────────────────────────────

function PayrollSettingsTab() {
  const { merged, set, save, isSaving } = useSettingsForm("payroll");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Banknote className="w-4 h-4" />Payroll Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Working Days in Month</Label>
            <Select value={merged.workingDaysMode ?? "actual"} onValueChange={(v) => set("workingDaysMode", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="actual">Actual calendar days</SelectItem>
                <SelectItem value="26">Fixed 26 days</SelectItem>
                <SelectItem value="30">Fixed 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Overtime Rate Multiplier</Label>
            <Input type="number" step="0.5" value={merged.overtimeMultiplier ?? "1.5"} onChange={(e) => set("overtimeMultiplier", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Overtime Threshold (hours/day)</Label>
            <Input type="number" value={merged.overtimeThreshold ?? "9"} onChange={(e) => set("overtimeThreshold", e.target.value)} />
          </div>
          <div>
            <Label>LOP per Day = CTC ÷</Label>
            <Input type="number" value={merged.lopDivisor ?? "30"} onChange={(e) => set("lopDivisor", e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merged.roundPayslipComponents === "true"} onCheckedChange={(v) => set("roundPayslipComponents", String(v))} />
          <Label>Round payslip components to nearest rupee</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merged.includeHraByDefault === "true"} onCheckedChange={(v) => set("includeHraByDefault", String(v))} />
          <Label>Include HRA in default salary structure</Label>
        </div>
        <div>
          <Label>Default HRA Percentage of Basic (%)</Label>
          <Input type="number" value={merged.hraPercent ?? "50"} onChange={(e) => set("hraPercent", e.target.value)} />
        </div>
        <Button onClick={save} disabled={isSaving}>Save Payroll Settings</Button>
      </CardContent>
    </Card>
  );
}

// ─── RBAC Permissions Tab ─────────────────────────────────────────────────────

const ALL_ROLES: RolePermissionsItem[] = ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"];

function RolePermissionsTab() {
  const queryClient = useQueryClient();
  const { data: serverMatrix, isLoading } = useGetRolePermissions();
  const [matrix, setMatrix] = useState<RolePermissions>({});

  useEffect(() => {
    if (serverMatrix) setMatrix(serverMatrix);
  }, [serverMatrix]);

  const updateMutation = useUpdateRolePermissions({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRolePermissionsQueryKey() });
        toast({ title: "Permissions saved", description: "Role permission matrix updated." });
      },
      onError: () => toast({ title: "Error", description: "Failed to save permissions.", variant: "destructive" }),
    },
  });

  function toggleRole(module: string, action: string, role: RolePermissionsItem) {
    setMatrix(prev => {
      const current: RolePermissionsItem[] = prev[module]?.[action] ?? [];
      const next: RolePermissionsItem[] = current.includes(role)
        ? current.filter(r => r !== role)
        : [...current, role];
      return { ...prev, [module]: { ...prev[module], [action]: next } };
    });
  }

  function save() {
    updateMutation.mutate({ data: matrix });
  }

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Loading permissions...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Lock className="w-4 h-4" />Role Permission Matrix</CardTitle>
        <CardDescription>Configure which roles can perform each action across modules. Only super admin can modify this.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">Module / Action</TableHead>
                {ALL_ROLES.map(r => (
                  <TableHead key={r} className="text-center text-xs capitalize">{r.replace("_", " ")}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(matrix).map(([module, actions]) =>
                Object.entries(actions).map(([action, roles], idx) => (
                  <TableRow key={`${module}.${action}`}>
                    <TableCell className="text-xs">
                      {idx === 0 && <span className="font-semibold capitalize block">{module}</span>}
                      <span className="text-muted-foreground capitalize">{action}</span>
                    </TableCell>
                    {ALL_ROLES.map(role => (
                      <TableCell key={role} className="text-center">
                        <input
                          type="checkbox"
                          checked={roles.includes(role)}
                          onChange={() => toggleRole(module, action, role)}
                          className="h-4 w-4 cursor-pointer"
                          disabled={role === "super_admin"}
                          title={role === "super_admin" ? "Super admin always has full access" : `Toggle ${role} for ${module}.${action}`}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4">
          <Button onClick={save} disabled={updateMutation.isPending}>Save Permissions</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom Employee Fields Tab ───────────────────────────────────────────────

type CustomField = { id: string; name: string; type: string; required: boolean; options: string[]; placeholder?: string };

function CustomEmployeeFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editField, setEditField] = useState<CustomField | null>(null);
  const [form, setForm] = useState({ name: "", type: "text", required: false, options: "", placeholder: "" });

  const fetchFields = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/custom-fields`, { credentials: "include" });
      if (r.ok) setFields(await r.json() as CustomField[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { void fetchFields(); }, []);

  function openCreate() {
    setEditField(null);
    setForm({ name: "", type: "text", required: false, options: "", placeholder: "" });
    setDialogOpen(true);
  }

  function openEdit(f: CustomField) {
    setEditField(f);
    setForm({ name: f.name, type: f.type, required: f.required, options: f.options.join(", "), placeholder: f.placeholder ?? "" });
    setDialogOpen(true);
  }

  async function save() {
    const payload = { name: form.name, type: form.type, required: form.required, options: form.options.split(",").map(s => s.trim()).filter(Boolean), placeholder: form.placeholder };
    const url = editField ? `${BASE_URL}/api/custom-fields/${editField.id}` : `${BASE_URL}/api/custom-fields`;
    const r = await fetch(url, { method: editField ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
    if (r.ok) { toast({ title: editField ? "Field updated" : "Field created" }); setDialogOpen(false); void fetchFields(); }
    else toast({ title: "Error", description: "Failed to save field", variant: "destructive" });
  }

  async function deleteField(id: string) {
    if (!confirm("Delete this custom field?")) return;
    const r = await fetch(`${BASE_URL}/api/custom-fields/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { toast({ title: "Field deleted" }); void fetchFields(); }
    else toast({ title: "Error", description: "Failed to delete field", variant: "destructive" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FormInput className="w-4 h-4" />Custom Employee Fields</CardTitle>
        <CardDescription>Define additional data fields to capture on employee profiles. These appear in the employee form.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={openCreate} size="sm" className="gap-1"><Plus className="w-4 h-4" />Add Custom Field</Button>
        {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">No custom fields defined yet.</TableCell></TableRow>
              )}
              {fields.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium text-sm">{f.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{f.type}</Badge></TableCell>
                  <TableCell>{f.required ? <Badge variant="destructive" className="text-xs">Required</Badge> : <span className="text-muted-foreground text-xs">Optional</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{f.options?.length > 0 ? f.options.join(", ") : "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}><Pencil className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteField(f.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editField ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Field Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Blood Group" /></div>
            <div>
              <Label>Field Type *</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["text", "number", "date", "email", "phone", "dropdown", "textarea"].map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.type === "dropdown" && (
              <div><Label>Options (comma-separated) *</Label><Input value={form.options} onChange={e => setForm(f => ({ ...f, options: e.target.value }))} placeholder="Option A, Option B, Option C" /></div>
            )}
            <div><Label>Placeholder Text</Label><Input value={form.placeholder} onChange={e => setForm(f => ({ ...f, placeholder: e.target.value }))} placeholder="e.g. Enter blood group" /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.required} onCheckedChange={v => setForm(f => ({ ...f, required: v }))} id="cf-required" />
              <Label htmlFor="cf-required">Required field</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!form.name || !form.type}>Save Field</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Leave Blackout Dates Tab ─────────────────────────────────────────────────

type LeaveBlackout = { id: string; name: string; startDate: string; endDate: string; reason: string };

function LeaveBlackoutsTab() {
  const [blackouts, setBlackouts] = useState<LeaveBlackout[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", reason: "" });

  const fetchBlackouts = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/leave-blackouts`, { credentials: "include" });
      if (r.ok) setBlackouts(await r.json() as LeaveBlackout[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { void fetchBlackouts(); }, []);

  async function save() {
    const r = await fetch(`${BASE_URL}/api/leave-blackouts`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(form),
    });
    if (r.ok) { toast({ title: "Blackout period added" }); setDialogOpen(false); setForm({ name: "", startDate: "", endDate: "", reason: "" }); void fetchBlackouts(); }
    else toast({ title: "Error", description: "Failed to add blackout period", variant: "destructive" });
  }

  async function deleteBlackout(id: string) {
    if (!confirm("Remove this blackout period?")) return;
    const r = await fetch(`${BASE_URL}/api/leave-blackouts/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { toast({ title: "Blackout period removed" }); void fetchBlackouts(); }
    else toast({ title: "Error", description: "Failed to delete blackout", variant: "destructive" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Ban className="w-4 h-4" />Leave Blackout Dates</CardTitle>
        <CardDescription>Define date ranges during which leave applications are blocked (e.g. financial year-end, audits, peak project periods).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1"><Plus className="w-4 h-4" />Add Blackout Period</Button>
        {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / Reason</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blackouts.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">No blackout periods defined. Leaves can be applied for any date.</TableCell></TableRow>
              )}
              {blackouts.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-sm">{b.name}</TableCell>
                  <TableCell className="text-sm">{b.startDate}</TableCell>
                  <TableCell className="text-sm">{b.endDate}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{b.reason || "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteBlackout(b.id)}><Trash2 className="w-3 h-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Leave Blackout Period</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Period Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Financial Year Close, Q1 Audit" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date *</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>End Date *</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Notes / Reason</Label><Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for leave restriction during this period" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!form.name || !form.startDate || !form.endDate}>Add Blackout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Storage Cleanup Tab ──────────────────────────────────────────────────────

interface StorageCleanupRunRow {
  id: number;
  startedAt: string;
  finishedAt?: string | null;
  scanned: number;
  candidates: number;
  orphans: number;
  deleted: number;
  errors: number;
  ageDays: number;
  dryRun: boolean;
  durationMs?: number | null;
  triggeredBy: string;
  errorMessage?: string | null;
}

function StorageCleanupTab() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [runs, setRuns] = useState<StorageCleanupRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const queryKey = ["storage-cleanup-runs"];

  async function load() {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE_URL}/api/storage-cleanup/runs?limit=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StorageCleanupRunRow[];
      setRuns(data);
    } catch (e) {
      toast({ title: "Failed to load cleanup history", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function triggerRun() {
    if (running) return;
    setRunning(true);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE_URL}/api/storage-cleanup/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ dryRun }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      toast({
        title: dryRun ? "Dry-run complete" : "Cleanup complete",
        description: `Scanned ${result.scanned}, ${result.orphans} orphans found, ${result.deleted} deleted, ${result.errors} errors.`,
      });
      qc.invalidateQueries({ queryKey });
      await load();
    } catch (e) {
      toast({ title: "Cleanup failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  const lastRun = runs[0];
  const successInLast7 = runs.filter(r => {
    const ts = new Date(r.startedAt).getTime();
    return ts > Date.now() - 7 * 24 * 60 * 60 * 1000 && r.errors === 0 && !r.errorMessage;
  }).length;
  const errorInLast7 = runs.filter(r => {
    const ts = new Date(r.startedAt).getTime();
    return ts > Date.now() - 7 * 24 * 60 * 60 * 1000 && (r.errors > 0 || !!r.errorMessage);
  }).length;

  function fmtDate(s?: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }
  function fmtDuration(ms?: number | null) {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }
  function triggerLabel(t: string) {
    if (t === "cron") return "Scheduled";
    if (t.startsWith("manual:")) return `Manual (user #${t.slice(7)})`;
    return t;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="w-4 h-4" />Orphan Attachment Cleanup
          </CardTitle>
          <CardDescription>
            A daily job (3:15 AM server time) deletes ticket-attachment files in object storage that are
            older than 7 days and not referenced by any helpdesk ticket. This panel shows the most recent runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Last Run</div>
              <div className="text-sm font-semibold mt-1">{lastRun ? fmtDate(lastRun.startedAt) : "Never"}</div>
              {lastRun && (
                <div className="text-xs text-muted-foreground mt-1">{triggerLabel(lastRun.triggeredBy)}</div>
              )}
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Files Deleted (last run)</div>
              <div className="text-sm font-semibold mt-1">{lastRun?.deleted ?? "—"}</div>
              {lastRun && lastRun.dryRun && (
                <div className="text-xs text-amber-600 mt-1">Dry run — nothing was deleted</div>
              )}
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Successful runs (7d)</div>
              <div className="text-sm font-semibold mt-1 text-green-700">{successInLast7}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Runs with errors (7d)</div>
              <div className={`text-sm font-semibold mt-1 ${errorInLast7 > 0 ? "text-red-700" : ""}`}>{errorInLast7}</div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={dryRun} onCheckedChange={setDryRun} disabled={running} />
              <Label className="cursor-pointer" onClick={() => !running && setDryRun(!dryRun)}>
                Dry-run (preview only — no deletes)
              </Label>
            </div>
            <Button onClick={triggerRun} disabled={running} size="sm">
              <Play className="w-4 h-4 mr-1" />
              {running ? "Running…" : dryRun ? "Run dry-run now" : "Run cleanup now"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || running}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Runs</CardTitle>
          <CardDescription>Showing the {runs.length} most recent runs (newest first).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && runs.length === 0 && (
            <p className="text-sm text-muted-foreground">No cleanup runs recorded yet. The first scheduled run will appear here.</p>
          )}
          {!loading && runs.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Scanned</TableHead>
                    <TableHead className="text-right">Candidates</TableHead>
                    <TableHead className="text-right">Orphans</TableHead>
                    <TableHead className="text-right">Deleted</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => {
                    const failed = !!r.errorMessage || r.errors > 0;
                    const inProgress = !r.finishedAt;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.startedAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{triggerLabel(r.triggeredBy)}</Badge>
                          {r.dryRun && <Badge className="ml-1 text-xs bg-amber-100 text-amber-800">Dry</Badge>}
                        </TableCell>
                        <TableCell className="text-right">{r.scanned}</TableCell>
                        <TableCell className="text-right">{r.candidates}</TableCell>
                        <TableCell className="text-right">{r.orphans}</TableCell>
                        <TableCell className="text-right font-medium">{r.deleted}</TableCell>
                        <TableCell className={`text-right ${r.errors > 0 ? "text-red-700 font-semibold" : ""}`}>{r.errors}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.ageDays}d</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtDuration(r.durationMs)}</TableCell>
                        <TableCell>
                          {inProgress ? (
                            <Badge className="bg-blue-100 text-blue-800">Running</Badge>
                          ) : failed ? (
                            <Badge className="bg-red-100 text-red-800 flex items-center gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3" />
                              {r.errorMessage ? "Failed" : "Errors"}
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-800">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {runs.some(r => r.errorMessage) && (
                <div className="mt-3 text-xs text-muted-foreground">
                  {runs.filter(r => r.errorMessage).slice(0, 3).map(r => (
                    <div key={r.id}>
                      <span className="text-red-700">Run #{r.id}:</span> {r.errorMessage}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── Notification Credentials Tab ─────────────────────────────────────────────
// Shows SMTP and WhatsApp credential fields. Each field gets a small badge
// telling the admin whether the value is sourced from the database (an admin
// has saved it) or from a server env-var default. The actual default value is
// never returned to the client — only the source label.

type CredentialSource = "db" | "default";
type CredentialEnvelope = { values: Record<string, unknown>; sources: Record<string, CredentialSource> };

/**
 * Small badge that says where a credential's runtime value comes from.
 * Wrapped in a tooltip so the admin gets a one-line explanation on hover.
 */
function SourceBadge({ source }: { source: CredentialSource | undefined }) {
  if (!source) return null;
  const isDb = source === "db";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isDb ? "default" : "secondary"}
            className="ml-2 gap-1 px-1.5 py-0 text-[10px] font-normal cursor-help"
            data-testid={`badge-source-${isDb ? "db" : "default"}`}
          >
            {isDb ? <Database className="w-2.5 h-2.5" /> : <Server className="w-2.5 h-2.5" />}
            {isDb ? "From database" : "From server default"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {isDb
            ? "This value is stored in the database (set here in the admin UI). It overrides any server default."
            : "No DB value is set, so the server falls back to its environment-variable default."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const SMTP_FIELDS: { key: string; label: string; placeholder?: string; type?: string }[] = [
  { key: "host", label: "SMTP Host", placeholder: "smtp.example.com" },
  { key: "port", label: "Port", placeholder: "587", type: "number" },
  { key: "secure", label: "Secure (TLS)", placeholder: "true / false" },
  { key: "username", label: "Username" },
  { key: "password", label: "Password", type: "password" },
  { key: "from", label: "From Address", placeholder: "noreply@example.com" },
];

const WA_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: "phone_number_id", label: "Phone Number ID" },
  { key: "access_token", label: "Access Token" },
];

function CredentialCategoryCard({
  category, title, icon, fields,
}: {
  category: "email" | "whatsapp";
  title: string;
  icon: React.ReactNode;
  fields: { key: string; label: string; placeholder?: string; type?: string }[];
}) {
  const queryClient = useQueryClient();
  // Pull the envelope shape with per-field sources. The OpenAPI response is
  // intentionally loose (additionalProperties:true) so we narrow it here on
  // the client through `unknown`. The query params themselves are properly
  // typed via the generated GetSystemSettingsParams.
  const { data, isLoading, refetch } = useGetSystemSettings(category, { withSource: "true" });
  const envelope = (data as unknown as CredentialEnvelope | undefined);
  const sources = envelope?.sources ?? {};
  const saved = envelope?.values ?? {};

  const updateMut = useUpdateSystemSettings();
  const [form, setForm] = useState<Record<string, string>>({});
  // Reset the local form whenever the server payload arrives or changes.
  useEffect(() => {
    if (!isLoading && envelope) {
      const next: Record<string, string> = {};
      for (const f of fields) {
        const v = saved[f.key];
        next[f.key] = v == null ? "" : String(v);
      }
      setForm(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data]);

  async function save() {
    // Send only fields the admin actually filled in (non-empty strings),
    // so blank fields don't accidentally write empty rows that flip the
    // badge to "From database" with no real value behind it.
    const payload: Record<string, string> = {};
    for (const f of fields) {
      const v = form[f.key];
      if (v != null && v !== "") payload[f.key] = v;
    }
    await updateMut.mutateAsync({ category, data: payload });
    toast({ title: `${title} saved` });
    // Invalidate so the source badges flip immediately on success.
    await queryClient.invalidateQueries({ queryKey: ["/api/system-settings/" + category] });
    await refetch();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
        <CardDescription>
          Each field shows whether the running value comes from the database or from a server env-var default.
          Saving a value here always switches that field to "From database".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        {fields.map((f) => (
          <div key={f.key}>
            <div className="flex items-center">
              <Label htmlFor={`cred-${category}-${f.key}`}>{f.label}</Label>
              <SourceBadge source={sources[f.key]} />
            </div>
            <Input
              id={`cred-${category}-${f.key}`}
              type={f.type ?? "text"}
              value={form[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              data-testid={`input-cred-${category}-${f.key}`}
            />
          </div>
        ))}
        <Button onClick={save} disabled={updateMut.isPending} data-testid={`button-save-cred-${category}`}>
          {updateMut.isPending ? "Saving…" : `Save ${title}`}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Notification Defaults Tab ────────────────────────────────────────────────
// Lets HR set company-wide ON/OFF defaults for each notification event type.
// These seed every new joiner's `notification_preferences` rows; existing
// employees are not affected. Mirrors the ESS preferences UI shape.

type DefaultItem = {
  eventType: string;
  label: string;
  description: string;
  module: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
};

function NotificationDefaultsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetNotificationDefaults();
  const updateMut = useUpdateNotificationDefaults();
  const [items, setItems] = useState<DefaultItem[]>([]);

  useEffect(() => {
    const incoming = (data as { items?: DefaultItem[] } | undefined)?.items;
    if (incoming) setItems(incoming);
  }, [data]);

  function setItem(eventType: string, patch: Partial<DefaultItem>) {
    setItems((cur) => cur.map((it) => (it.eventType === eventType ? { ...it, ...patch } : it)));
  }

  async function save() {
    await updateMut.mutateAsync({
      data: {
        items: items.map((it) => ({
          eventType: it.eventType,
          emailEnabled: it.emailEnabled,
          whatsappEnabled: it.whatsappEnabled,
        })),
      },
    });
    toast({ title: "Default notification preferences saved" });
    await queryClient.invalidateQueries({ queryKey: ["/api/notification-defaults"] });
  }

  // Group by module for a less-overwhelming layout — same grouping the ESS
  // preferences page uses.
  const grouped = items.reduce<Record<string, DefaultItem[]>>((acc, it) => {
    (acc[it.module] ||= []).push(it);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default notification preferences</CardTitle>
          <CardDescription>
            Toggle which channels are enabled by default for every newly created employee. Existing
            employees are unaffected — they keep whatever they have already chosen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && Object.entries(grouped).map(([module, list]) => (
            <div key={module} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{module}</h3>
              <div className="border rounded-md divide-y">
                {list.map((it) => (
                  <div key={it.eventType} className="p-3 flex items-start gap-4" data-testid={`row-default-${it.eventType}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{it.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{it.description}</div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={it.emailEnabled}
                          onCheckedChange={(v) => setItem(it.eventType, { emailEnabled: v })}
                          data-testid={`switch-default-email-${it.eventType}`}
                        />
                        <span>Email</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={it.whatsappEnabled}
                          onCheckedChange={(v) => setItem(it.eventType, { whatsappEnabled: v })}
                          data-testid={`switch-default-whatsapp-${it.eventType}`}
                        />
                        <span>WhatsApp</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div>
            <Button
              onClick={save}
              disabled={updateMut.isPending || isLoading || items.length === 0}
              data-testid="button-save-notification-defaults"
            >
              {updateMut.isPending ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceSuspicionTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetAttendanceSuspicionConfig();
  const update = useUpdateAttendanceSuspicionConfig();
  const { role } = useCurrentHrmsUser();
  const canWrite = role === "super_admin" || role === "hr_manager";

  const [maxAccuracy, setMaxAccuracy] = useState<string>("200");
  const [maxRadius, setMaxRadius] = useState<string>("500");
  const [offices, setOffices] = useState<Array<{ name: string; latitude: number; longitude: number; location?: string | null }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data && !loaded) {
      setMaxAccuracy(String(data.maxAccuracyMeters ?? 200));
      setMaxRadius(String(data.maxRadiusMeters ?? 500));
      setOffices(data.offices ?? []);
      setLoaded(true);
    }
  }, [data, loaded]);

  function addOffice() {
    setOffices((p) => [...p, { name: "", latitude: 0, longitude: 0, location: "" }]);
  }
  function removeOffice(idx: number) {
    setOffices((p) => p.filter((_, i) => i !== idx));
  }
  function updateOffice(idx: number, patch: Partial<{ name: string; latitude: number; longitude: number; location: string | null }>) {
    setOffices((p) => p.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  async function save() {
    const acc = Number(maxAccuracy);
    const rad = Number(maxRadius);
    if (!Number.isFinite(acc) || acc < 0 || !Number.isFinite(rad) || rad < 0) {
      toast({ title: "Invalid thresholds", description: "Accuracy and radius must be non-negative numbers.", variant: "destructive" });
      return;
    }
    for (const o of offices) {
      if (!o.name.trim()) { toast({ title: "Office name required", variant: "destructive" }); return; }
      if (!Number.isFinite(o.latitude) || o.latitude < -90 || o.latitude > 90) { toast({ title: `Invalid latitude for ${o.name}`, variant: "destructive" }); return; }
      if (!Number.isFinite(o.longitude) || o.longitude < -180 || o.longitude > 180) { toast({ title: `Invalid longitude for ${o.name}`, variant: "destructive" }); return; }
    }
    await update.mutateAsync({ data: { maxAccuracyMeters: acc, maxRadiusMeters: rad, offices } });
    toast({ title: "Suspicion settings saved" });
    void qc.invalidateQueries({ queryKey: getGetAttendanceSuspicionConfigQueryKey() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Attendance Suspicion Rules</CardTitle>
        <CardDescription>
          Clock-ins that have no GPS, low accuracy, or are far from every registered office will be flagged for HR review.
          Distances use straight-line (haversine) calculation in metres.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Max acceptable GPS accuracy (metres)</Label>
                <Input
                  type="number" min={0} value={maxAccuracy} onChange={(e) => setMaxAccuracy(e.target.value)}
                  disabled={!canWrite} data-testid="input-max-accuracy"
                />
                <p className="text-xs text-muted-foreground mt-1">Punches with worse accuracy than this are flagged.</p>
              </div>
              <div>
                <Label className="text-xs">Max distance from any office (metres)</Label>
                <Input
                  type="number" min={0} value={maxRadius} onChange={(e) => setMaxRadius(e.target.value)}
                  disabled={!canWrite} data-testid="input-max-radius"
                />
                <p className="text-xs text-muted-foreground mt-1">Punches farther than this from every registered office are flagged.</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Registered office locations</h3>
                  <p className="text-xs text-muted-foreground">Used as anchor points for the radius check. With no offices registered, the distance check is skipped (only missing-GPS and low-accuracy flags apply).</p>
                </div>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={addOffice} className="gap-1" data-testid="button-add-office">
                    <Plus className="w-4 h-4" />Add office
                  </Button>
                )}
              </div>

              {offices.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No offices registered.</p>
              ) : (
                <div className="space-y-2">
                  {offices.map((o, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-md p-3" data-testid={`row-office-${idx}`}>
                      <div className="col-span-12 md:col-span-3">
                        <Label className="text-xs">Name</Label>
                        <Input value={o.name} onChange={(e) => updateOffice(idx, { name: e.target.value })} disabled={!canWrite} />
                      </div>
                      <div className="col-span-12 md:col-span-3">
                        <Label className="text-xs">Applies to work location</Label>
                        <Input
                          value={o.location ?? ""}
                          placeholder="(global fallback)"
                          onChange={(e) => updateOffice(idx, { location: e.target.value })}
                          disabled={!canWrite}
                          data-testid={`input-office-location-${idx}`}
                        />
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <Label className="text-xs">Latitude</Label>
                        <Input type="number" step="any" value={o.latitude}
                          onChange={(e) => updateOffice(idx, { latitude: Number(e.target.value) })} disabled={!canWrite} />
                      </div>
                      <div className="col-span-6 md:col-span-3">
                        <Label className="text-xs">Longitude</Label>
                        <Input type="number" step="any" value={o.longitude}
                          onChange={(e) => updateOffice(idx, { longitude: Number(e.target.value) })} disabled={!canWrite} />
                      </div>
                      <div className="col-span-12 md:col-span-1 flex md:justify-end">
                        {canWrite && (
                          <Button size="icon" variant="ghost" onClick={() => removeOffice(idx)} data-testid={`button-remove-office-${idx}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={update.isPending} data-testid="button-save-suspicion">
                  {update.isPending ? "Saving…" : "Save settings"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationCredentialsTab() {
  return (
    <div className="space-y-6">
      <CredentialCategoryCard
        category="email"
        title="SMTP / Email"
        icon={<Mail className="w-4 h-4" />}
        fields={SMTP_FIELDS}
      />
      <CredentialCategoryCard
        category="whatsapp"
        title="WhatsApp Cloud API"
        icon={<MessageSquare className="w-4 h-4" />}
        fields={WA_FIELDS}
      />
    </div>
  );
}

export default function SystemConfigPage() {
  const { role } = useCurrentHrmsUser();
  const isSuperAdmin = role === "super_admin";
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="w-6 h-6" />System Configuration</h1>
          <p className="text-muted-foreground mt-1">Configure organization settings, statutory rates, approval workflows, and system preferences.</p>
        </div>

        <Tabs defaultValue="org">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="org">Org Profile</TabsTrigger>
            <TabsTrigger value="statutory">Statutory Rates</TabsTrigger>
            <TabsTrigger value="financial">Financial Year</TabsTrigger>
            <TabsTrigger value="payroll">Payroll Settings</TabsTrigger>
            <TabsTrigger value="approval">Approval Chains</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="permissions">Role Permissions</TabsTrigger>
            <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
            <TabsTrigger value="leave-blackouts">Leave Blackouts</TabsTrigger>
            <TabsTrigger value="attendance-suspicion">Attendance Suspicion</TabsTrigger>
            <TabsTrigger value="notification-defaults">Notification Defaults</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="credentials">Notification Credentials</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="storage-cleanup">Storage Cleanup</TabsTrigger>}
          </TabsList>

          <TabsContent value="org" className="mt-4"><OrgProfileTab /></TabsContent>
          <TabsContent value="statutory" className="mt-4"><StatutoryRatesTab /></TabsContent>
          <TabsContent value="financial" className="mt-4"><FinancialYearTab /></TabsContent>
          <TabsContent value="payroll" className="mt-4"><PayrollSettingsTab /></TabsContent>
          <TabsContent value="approval" className="mt-4"><ApprovalChainsTab /></TabsContent>
          <TabsContent value="security" className="mt-4"><SecurityTab /></TabsContent>
          <TabsContent value="permissions" className="mt-4"><RolePermissionsTab /></TabsContent>
          <TabsContent value="custom-fields" className="mt-4"><CustomEmployeeFieldsTab /></TabsContent>
          <TabsContent value="leave-blackouts" className="mt-4"><LeaveBlackoutsTab /></TabsContent>
          <TabsContent value="attendance-suspicion" className="mt-4"><AttendanceSuspicionTab /></TabsContent>
          <TabsContent value="notification-defaults" className="mt-4"><NotificationDefaultsTab /></TabsContent>
          {isSuperAdmin && (
            <TabsContent value="credentials" className="mt-4"><NotificationCredentialsTab /></TabsContent>
          )}
          {isSuperAdmin && (
            <TabsContent value="storage-cleanup" className="mt-4"><StorageCleanupTab /></TabsContent>
          )}
        </Tabs>
      </div>
    </MainLayout>
  );
}
