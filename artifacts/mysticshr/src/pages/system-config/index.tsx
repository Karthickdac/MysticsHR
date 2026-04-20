import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSystemSettings,
  useUpdateSystemSettings,
  useListApprovalChains,
  useCreateApprovalChain,
  useUpdateApprovalChain,
  useDeleteApprovalChain,
  getListApprovalChainsQueryKey,
  type ApprovalChainConfig,
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
import { Settings, Building2, Scale, Banknote, CalendarDays, ShieldCheck, Plus, Pencil, Trash2, Lock } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

const ALL_ROLES = ["super_admin","hr_manager","hr_executive","hod","payroll_admin","employee"] as const;
type HrmsRole = typeof ALL_ROLES[number];

function RolePermissionsTab() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, HrmsRole[]>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/role-permissions", { credentials: "include" })
      .then(r => r.json())
      .then(data => { setMatrix(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function toggleRole(module: string, action: string, role: HrmsRole) {
    setMatrix(prev => {
      const current = prev[module]?.[action] ?? [];
      const next = current.includes(role)
        ? current.filter(r => r !== role)
        : [...current, role];
      return { ...prev, [module]: { ...prev[module], [action]: next } };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/role-permissions", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matrix),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Permissions saved", description: "Role permission matrix updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save permissions.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground p-4">Loading permissions...</div>;

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
          <Button onClick={save} disabled={saving}>Save Permissions</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SystemConfigPage() {
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
          </TabsList>

          <TabsContent value="org" className="mt-4"><OrgProfileTab /></TabsContent>
          <TabsContent value="statutory" className="mt-4"><StatutoryRatesTab /></TabsContent>
          <TabsContent value="financial" className="mt-4"><FinancialYearTab /></TabsContent>
          <TabsContent value="payroll" className="mt-4"><PayrollSettingsTab /></TabsContent>
          <TabsContent value="approval" className="mt-4"><ApprovalChainsTab /></TabsContent>
          <TabsContent value="security" className="mt-4"><SecurityTab /></TabsContent>
          <TabsContent value="permissions" className="mt-4"><RolePermissionsTab /></TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
