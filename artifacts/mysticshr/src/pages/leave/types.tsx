import { useState } from "react";
import {
  useListLeaveTypes,
  useCreateLeaveType,
  useUpdateLeaveType,
  useDeleteLeaveType,
  getListLeaveTypesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2 } from "lucide-react";

type LeaveTypeForm = {
  name: string; code: string; description: string; annualQuota: string;
  carryForwardEnabled: boolean; carryForwardMax: string;
  encashmentEnabled: boolean; advanceNoticeDays: string;
  requiresHrApproval: boolean; requiresHodApproval: boolean;
  allowHalfDay: boolean; lopByDefault: boolean; isActive: boolean;
};

const defaultForm: LeaveTypeForm = {
  name: "", code: "", description: "", annualQuota: "12",
  carryForwardEnabled: false, carryForwardMax: "",
  encashmentEnabled: false, advanceNoticeDays: "0",
  requiresHrApproval: true, requiresHodApproval: true,
  allowHalfDay: true, lopByDefault: false, isActive: true,
};

export default function LeaveTypesPage() {
  const qc = useQueryClient();
  const { data: types, isLoading } = useListLeaveTypes({});
  const createMutation = useCreateLeaveType();
  const updateMutation = useUpdateLeaveType();
  const deleteMutation = useDeleteLeaveType();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<LeaveTypeForm>(defaultForm);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListLeaveTypesQueryKey({}) });

  function openCreate() {
    setForm(defaultForm);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(lt: any) {
    setForm({
      name: lt.name, code: lt.code, description: lt.description ?? "",
      annualQuota: lt.annualQuota ?? "12", carryForwardEnabled: lt.carryForwardEnabled,
      carryForwardMax: lt.carryForwardMax ?? "", encashmentEnabled: lt.encashmentEnabled,
      advanceNoticeDays: String(lt.advanceNoticeDays ?? 0), requiresHrApproval: lt.requiresHrApproval,
      requiresHodApproval: lt.requiresHodApproval, allowHalfDay: lt.allowHalfDay,
      lopByDefault: lt.lopByDefault, isActive: lt.isActive,
    });
    setEditId(lt.id);
    setShowForm(true);
  }

  async function handleSave() {
    const payload = {
      name: form.name, code: form.code.toUpperCase(), description: form.description || undefined,
      annualQuota: form.annualQuota, carryForwardEnabled: form.carryForwardEnabled,
      carryForwardMax: form.carryForwardEnabled && form.carryForwardMax ? form.carryForwardMax : null,
      encashmentEnabled: form.encashmentEnabled, advanceNoticeDays: Number(form.advanceNoticeDays),
      requiresHrApproval: form.requiresHrApproval, requiresHodApproval: form.requiresHodApproval,
      allowHalfDay: form.allowHalfDay, lopByDefault: form.lopByDefault, isActive: form.isActive,
    };
    try {
      if (editId) {
        await updateMutation.mutateAsync({ id: editId, data: payload as any });
      } else {
        await createMutation.mutateAsync({ data: payload as any });
      }
      invalidate();
      setShowForm(false);
    } catch (err: any) {
      alert(err?.response?.data?.error ?? "Failed to save");
    }
  }

  async function handleDeactivate(id: number) {
    if (!confirm("Deactivate this leave type?")) return;
    await deleteMutation.mutateAsync({ id });
    invalidate();
  }

  function set(field: keyof LeaveTypeForm, value: any) {
    setForm(f => ({ ...f, [field]: value }));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Types</h1>
          <p className="text-sm text-gray-500 mt-1">Configure leave types, quotas, and approval workflows</p>
        </div>
        <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />New Leave Type</Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : (types ?? []).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>No leave types configured yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(types ?? []).map((lt) => (
            <Card key={lt.id} className={`border shadow-none ${!lt.isActive ? "opacity-50" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">{lt.code}</Badge>
                      <span className="font-medium">{lt.name}</span>
                      {!lt.isActive && <Badge className="bg-gray-100 text-gray-500 text-xs">Inactive</Badge>}
                    </div>
                    {lt.description && <p className="text-xs text-gray-500">{lt.description}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1">
                      <span>Quota: <strong>{lt.annualQuota} days/yr</strong></span>
                      <span>Advance: <strong>{lt.advanceNoticeDays} days</strong></span>
                      {lt.carryForwardEnabled && <span>Carry-forward: <strong>{lt.carryForwardMax ? `up to ${lt.carryForwardMax}d` : "Yes"}</strong></span>}
                      {lt.encashmentEnabled && <span className="text-green-600">Encashable</span>}
                      {lt.lopByDefault && <span className="text-orange-500">LOP by default</span>}
                      <span>HOD: <strong>{lt.requiresHodApproval ? "✓" : "✗"}</strong></span>
                      <span>HR: <strong>{lt.requiresHrApproval ? "✓" : "✗"}</strong></span>
                      <span>Half-Day: <strong>{lt.allowHalfDay ? "✓" : "✗"}</strong></span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(lt)}><Pencil className="w-4 h-4" /></Button>
                    {lt.isActive && (
                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDeactivate(lt.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Leave Type" : "Create Leave Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Casual Leave" />
              </div>
              <div>
                <Label>Code *</Label>
                <Input value={form.code} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="CL" maxLength={10} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Annual Quota (days) *</Label>
                <Input type="number" step="0.5" min="0" value={form.annualQuota} onChange={e => set("annualQuota", e.target.value)} />
              </div>
              <div>
                <Label>Advance Notice (days)</Label>
                <Input type="number" min="0" value={form.advanceNoticeDays} onChange={e => set("advanceNoticeDays", e.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Requires HOD Approval</Label>
                <Switch checked={form.requiresHodApproval} onCheckedChange={v => set("requiresHodApproval", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Requires HR Approval</Label>
                <Switch checked={form.requiresHrApproval} onCheckedChange={v => set("requiresHrApproval", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Allow Half Day</Label>
                <Switch checked={form.allowHalfDay} onCheckedChange={v => set("allowHalfDay", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Carry Forward</Label>
                <Switch checked={form.carryForwardEnabled} onCheckedChange={v => set("carryForwardEnabled", v)} />
              </div>
              {form.carryForwardEnabled && (
                <div>
                  <Label>Max Carry Forward (days, blank = unlimited)</Label>
                  <Input type="number" step="0.5" min="0" value={form.carryForwardMax} onChange={e => set("carryForwardMax", e.target.value)} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>Encashment Eligible</Label>
                <Switch checked={form.encashmentEnabled} onCheckedChange={v => set("encashmentEnabled", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>LOP by Default (no-balance requests)</Label>
                <Switch checked={form.lopByDefault} onCheckedChange={v => set("lopByDefault", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={form.isActive} onCheckedChange={v => set("isActive", v)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.code || createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
