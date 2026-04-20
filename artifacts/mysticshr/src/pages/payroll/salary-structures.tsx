import { useState, useEffect } from "react";
import {
  useListSalaryStructures, useCreateSalaryStructure, useUpdateSalaryStructure, useGetSalaryStructure,
  getListSalaryStructuresQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Eye, Trash2, IndianRupee } from "lucide-react";

const EARNING_TYPES = [
  "Basic", "HRA", "Special Allowance", "Travel Allowance", "Medical Allowance",
  "Performance Bonus", "Shift Allowance", "Night Differential Pay", "Other Earning",
];
const DEDUCTION_TYPES = [
  "PF Employee", "PF Employer", "ESI Employee", "ESI Employer",
  "Professional Tax", "TDS", "LOP Deduction", "Loan Repayment", "Other Deduction",
];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

type Component = {
  id?: number;
  componentType: string;
  componentName: string;
  amount: string;
  percentageOfBasic?: string;
  isEarning: boolean;
  sequence: number;
};

const DEFAULT_COMPONENTS: Component[] = [
  { componentType: "Basic", componentName: "Basic Salary", amount: "0", isEarning: true, sequence: 1 },
  { componentType: "HRA", componentName: "HRA", amount: "0", isEarning: true, sequence: 2 },
  { componentType: "Special Allowance", componentName: "Special Allowance", amount: "0", isEarning: true, sequence: 3 },
  { componentType: "Travel Allowance", componentName: "Travel Allowance", amount: "0", isEarning: true, sequence: 4 },
  { componentType: "Medical Allowance", componentName: "Medical Allowance", amount: "0", isEarning: true, sequence: 5 },
  { componentType: "PF Employee", componentName: "PF (Employee)", amount: "0", isEarning: false, sequence: 10 },
  { componentType: "PF Employer", componentName: "PF (Employer)", amount: "0", isEarning: false, sequence: 11 },
  { componentType: "Professional Tax", componentName: "Professional Tax", amount: "0", isEarning: false, sequence: 12 },
];

export default function SalaryStructuresPage() {
  const { role } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"].includes(role ?? "");

  const qc = useQueryClient();
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [viewId, setViewId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: structures, isLoading } = useListSalaryStructures({ isActive: "true" });
  const { data: viewDetail } = useGetSalaryStructure(viewId ?? 0);
  const { data: editDetail } = useGetSalaryStructure(editId ?? 0);

  const createMutation = useCreateSalaryStructure();
  const updateMutation = useUpdateSalaryStructure();

  const [form, setForm] = useState({
    employeeId: "",
    name: "Standard Structure",
    effectiveFrom: new Date().toISOString().split("T")[0],
    grossCtc: "",
    annualCtc: "",
    notes: "",
    components: DEFAULT_COMPONENTS,
  });

  function resetForm() {
    setForm({
      employeeId: "", name: "Standard Structure",
      effectiveFrom: new Date().toISOString().split("T")[0],
      grossCtc: "", annualCtc: "", notes: "",
      components: DEFAULT_COMPONENTS.map(c => ({ ...c })),
    });
  }

  function openCreate() {
    resetForm(); setError(null); setShowCreate(true);
  }

  // When editDetail loads, populate the form with actual existing components
  useEffect(() => {
    if (editId && editDetail) {
      setForm({
        employeeId: String(editDetail.employeeId),
        name: editDetail.name,
        effectiveFrom: editDetail.effectiveFrom,
        grossCtc: editDetail.grossCtc,
        annualCtc: editDetail.annualCtc,
        notes: editDetail.notes ?? "",
        components: editDetail.components && editDetail.components.length > 0
          ? editDetail.components.map((c) => ({
              id: c.id,
              componentType: c.componentType,
              componentName: c.componentName,
              amount: c.amount,
              percentageOfBasic: c.percentageOfBasic ?? undefined,
              isEarning: c.isEarning,
              sequence: c.sequence,
            }))
          : DEFAULT_COMPONENTS.map(c => ({ ...c })),
      });
    }
  }, [editId, editDetail]);

  function openEdit(s: { id: number; employeeId: number; name: string; effectiveFrom: string; grossCtc: string; annualCtc: string; notes?: string | null }) {
    setEditId(s.id);
    setError(null);
    // form will be populated via useEffect once editDetail loads
  }

  function updateComp(idx: number, field: keyof Component, val: any) {
    setForm(f => {
      const comps = [...f.components];
      (comps[idx] as any)[field] = val;
      return { ...f, components: comps };
    });
  }

  function addCustomComp(isEarning: boolean) {
    setForm(f => ({
      ...f,
      components: [...f.components, {
        componentType: isEarning ? "Other Earning" : "Other Deduction",
        componentName: isEarning ? "Other Earning" : "Other Deduction",
        amount: "0", isEarning, sequence: f.components.length + 1,
      }],
    }));
  }

  function removeComp(idx: number) {
    setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }));
  }

  async function handleCreate() {
    setError(null);
    if (!form.employeeId) { setError("Please enter employee ID"); return; }
    try {
      await createMutation.mutateAsync({
        data: {
          employeeId: Number(form.employeeId),
          name: form.name,
          effectiveFrom: form.effectiveFrom,
          grossCtc: form.grossCtc || "0",
          annualCtc: form.annualCtc || "0",
          notes: form.notes || undefined,
          components: form.components.map(c => ({
            componentType: c.componentType,
            componentName: c.componentName,
            amount: c.amount || "0",
            isEarning: c.isEarning,
            sequence: c.sequence,
          })),
        },
      });
      qc.invalidateQueries({ queryKey: getListSalaryStructuresQueryKey({}) });
      setShowCreate(false);
    } catch (e: any) { setError(e?.response?.data?.error ?? "Failed to create"); }
  }

  async function handleUpdate() {
    if (!editId) return;
    setError(null);
    try {
      await updateMutation.mutateAsync({
        id: editId,
        data: {
          name: form.name,
          effectiveFrom: form.effectiveFrom,
          grossCtc: form.grossCtc,
          annualCtc: form.annualCtc,
          notes: form.notes || undefined,
          components: form.components.map(c => ({
            componentType: c.componentType,
            componentName: c.componentName,
            amount: c.amount || "0",
            isEarning: c.isEarning,
            sequence: c.sequence,
          })),
        },
      });
      qc.invalidateQueries({ queryKey: getListSalaryStructuresQueryKey({}) });
      setEditId(null);
    } catch (e: any) { setError(e?.response?.data?.error ?? "Failed to update"); }
  }

  const filtered = structures?.filter(s => !employeeFilter || (s.employeeName?.toLowerCase().includes(employeeFilter.toLowerCase()) || s.employeeCode?.toLowerCase().includes(employeeFilter.toLowerCase())));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Salary Structures</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Configure salary components for each employee.</p>
        </div>
        {isHr && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Structure</Button>}
      </div>

      <div className="flex gap-3">
        <Input placeholder="Search by employee name or code..." value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className="max-w-sm" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : !filtered?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No salary structures found</p>
          <p className="text-sm">Create a salary structure for an employee to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(s => (
            <Card key={s.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{s.employeeName ?? `Employee #${s.employeeId}`}</span>
                      {s.employeeCode && <Badge variant="outline" className="text-xs">{s.employeeCode}</Badge>}
                      <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{s.name} · From {fmtDate(s.effectiveFrom)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-700">{fmt(s.grossCtc)} <span className="text-xs text-muted-foreground font-normal">/month</span></p>
                    <p className="text-xs text-muted-foreground">Annual CTC: {fmt(s.annualCtc)}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={() => setViewId(s.id)}>
                    <Eye className="w-3 h-3 mr-1" />View
                  </Button>
                  {isHr && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                      <Pencil className="w-3 h-3 mr-1" />Edit
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewId} onOpenChange={v => !v && setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Salary Structure Detail</DialogTitle></DialogHeader>
          {viewDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Employee: </span><span className="font-medium">{(viewDetail as any).employeeName ?? `#${viewDetail.employeeId}`}</span></div>
                <div><span className="text-muted-foreground">Structure: </span><span className="font-medium">{viewDetail.name}</span></div>
                <div><span className="text-muted-foreground">From: </span><span className="font-medium">{fmtDate(viewDetail.effectiveFrom)}</span></div>
                <div><span className="text-muted-foreground">Gross CTC: </span><span className="font-semibold text-green-700">{fmt(viewDetail.grossCtc)}/mo</span></div>
                <div><span className="text-muted-foreground">Annual CTC: </span><span className="font-semibold">{fmt(viewDetail.annualCtc)}</span></div>
              </div>
              {(viewDetail as any).components?.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Components</h4>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 pl-3">Component</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-right p-2 pr-3">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(viewDetail as any).components.map((c: any) => (
                          <tr key={c.id} className="border-t">
                            <td className="p-2 pl-3">{c.componentName}</td>
                            <td className="p-2">
                              <Badge className={`text-xs ${c.isEarning ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                {c.isEarning ? "Earning" : "Deduction"}
                              </Badge>
                            </td>
                            <td className="p-2 pr-3 text-right font-medium">{fmt(c.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Dialog */}
      {(showCreate || !!editId) && (
        <Dialog open={showCreate || !!editId} onOpenChange={v => { if (!v) { setShowCreate(false); setEditId(null); } }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editId ? "Edit Salary Structure" : "Create Salary Structure"}</DialogTitle></DialogHeader>
            <div className="space-y-5">
              {!editId && (
                <div className="space-y-1">
                  <Label>Employee ID <span className="text-red-500">*</span></Label>
                  <Input type="number" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="Enter employee DB ID" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Structure Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Effective From</Label>
                  <Input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Monthly Gross CTC (₹)</Label>
                  <Input type="number" value={form.grossCtc} onChange={e => setForm(f => ({ ...f, grossCtc: e.target.value }))} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <Label>Annual CTC (₹)</Label>
                  <Input type="number" value={form.annualCtc} onChange={e => setForm(f => ({ ...f, annualCtc: e.target.value }))} placeholder="0" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>

              {/* Earnings */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-green-700">Earnings</h4>
                  <Button size="sm" variant="outline" onClick={() => addCustomComp(true)}>
                    <Plus className="w-3 h-3 mr-1" />Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.components.filter(c => c.isEarning).map((c, i) => {
                    const realIdx = form.components.indexOf(c);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-center">
                        <Select value={c.componentType} onValueChange={v => updateComp(realIdx, "componentType", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>{EARNING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="h-8 text-sm" value={c.componentName} onChange={e => updateComp(realIdx, "componentName", e.target.value)} placeholder="Label" />
                        <Input className="h-8 text-sm text-right" type="number" value={c.amount} onChange={e => updateComp(realIdx, "amount", e.target.value)} placeholder="₹0" />
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => removeComp(realIdx)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Deductions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-red-700">Deductions</h4>
                  <Button size="sm" variant="outline" onClick={() => addCustomComp(false)}>
                    <Plus className="w-3 h-3 mr-1" />Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.components.filter(c => !c.isEarning).map((c, i) => {
                    const realIdx = form.components.indexOf(c);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-center">
                        <Select value={c.componentType} onValueChange={v => updateComp(realIdx, "componentType", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>{DEDUCTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="h-8 text-sm" value={c.componentName} onChange={e => updateComp(realIdx, "componentName", e.target.value)} placeholder="Label" />
                        <Input className="h-8 text-sm text-right" type="number" value={c.amount} onChange={e => updateComp(realIdx, "amount", e.target.value)} placeholder="₹0" />
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => removeComp(realIdx)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowCreate(false); setEditId(null); }}>Cancel</Button>
              <Button onClick={editId ? handleUpdate : handleCreate} disabled={createMutation.isPending || updateMutation.isPending}>
                {editId ? (updateMutation.isPending ? "Saving..." : "Save Changes") : (createMutation.isPending ? "Creating..." : "Create Structure")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
