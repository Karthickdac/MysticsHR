import { useState } from "react";
import { useListLeavePolicies, useUpdateLeavePolicy } from "@workspace/api-client-react";
import type { LeavePolicy, UpdateLeavePolicyBody } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Settings2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LeavePoliciesPage() {
  const { toast } = useToast();
  const { data: policies, isLoading, refetch } = useListLeavePolicies();
  const { mutateAsync: updatePolicy } = useUpdateLeavePolicy();

  const [editing, setEditing] = useState<LeavePolicy | null>(null);
  const [form, setForm] = useState<UpdateLeavePolicyBody>({});
  const [saving, setSaving] = useState(false);

  function openEdit(policy: LeavePolicy) {
    setEditing(policy);
    setForm({
      requiresHodApproval: policy.requiresHodApproval,
      requiresHrApproval: policy.requiresHrApproval,
      advanceNoticeDays: policy.advanceNoticeDays,
      minConsecutiveDays: policy.minConsecutiveDays ?? undefined,
      maxConsecutiveDays: policy.maxConsecutiveDays ?? undefined,
      allowHalfDay: policy.allowHalfDay,
      lopByDefault: policy.lopByDefault,
      carryForwardEnabled: policy.carryForwardEnabled,
      carryForwardMax: policy.carryForwardMax ?? undefined,
      encashmentEnabled: policy.encashmentEnabled,
    });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await updatePolicy({ typeId: editing.leaveTypeId, data: form });
      toast({ title: "Policy saved", description: `Policy for ${editing.leaveTypeName} updated.` });
      setEditing(null);
      refetch();
    } catch {
      toast({ title: "Error", description: "Failed to save policy.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function BoolBadge({ value, yes, no }: { value: boolean; yes: string; no: string }) {
    return value
      ? <Badge variant="outline" className="gap-1 border-green-500 text-green-700"><CheckCircle2 className="w-3 h-3" />{yes}</Badge>
      : <Badge variant="outline" className="gap-1 border-slate-400 text-slate-500"><XCircle className="w-3 h-3" />{no}</Badge>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leave Policies</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure approval workflow, accrual, carry-forward, and eligibility rules for each leave type.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading policies…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(policies ?? []).map((policy) => (
            <Card key={policy.id} className={!policy.isActive ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{policy.leaveTypeName}</CardTitle>
                    <CardDescription className="text-xs font-mono">{policy.leaveTypeCode}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => openEdit(policy)}>
                    <Settings2 className="w-3 h-3" /> Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  <BoolBadge value={policy.requiresHodApproval} yes="HOD Approval" no="No HOD Approval" />
                  <BoolBadge value={policy.requiresHrApproval} yes="HR Approval" no="No HR Approval" />
                  <BoolBadge value={policy.allowHalfDay} yes="Half-Day OK" no="No Half-Day" />
                  <BoolBadge value={policy.carryForwardEnabled} yes="Carry-Forward" no="No Carry-Forward" />
                  <BoolBadge value={policy.encashmentEnabled} yes="Encashment" no="No Encashment" />
                  <BoolBadge value={policy.lopByDefault} yes="LOP Default" no="Not LOP" />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                  <span>Advance notice: <strong className="text-foreground">{policy.advanceNoticeDays}d</strong></span>
                  {policy.minConsecutiveDays && <span>Min days: <strong className="text-foreground">{policy.minConsecutiveDays}</strong></span>}
                  {policy.maxConsecutiveDays && <span>Max days: <strong className="text-foreground">{policy.maxConsecutiveDays}</strong></span>}
                  {policy.carryForwardMax && <span>Carry-fwd max: <strong className="text-foreground">{policy.carryForwardMax}</strong></span>}
                </div>
                {policy.applicableEmploymentTypes && policy.applicableEmploymentTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {policy.applicableEmploymentTypes.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Policy — {editing?.leaveTypeName}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>Requires HOD Approval</Label>
                  <Switch checked={!!form.requiresHodApproval} onCheckedChange={(v) => setForm({ ...form, requiresHodApproval: v })} />
                </div>
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>Requires HR Approval</Label>
                  <Switch checked={!!form.requiresHrApproval} onCheckedChange={(v) => setForm({ ...form, requiresHrApproval: v })} />
                </div>
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>Allow Half-Day</Label>
                  <Switch checked={!!form.allowHalfDay} onCheckedChange={(v) => setForm({ ...form, allowHalfDay: v })} />
                </div>
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>LOP by Default</Label>
                  <Switch checked={!!form.lopByDefault} onCheckedChange={(v) => setForm({ ...form, lopByDefault: v })} />
                </div>
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>Carry Forward</Label>
                  <Switch checked={!!form.carryForwardEnabled} onCheckedChange={(v) => setForm({ ...form, carryForwardEnabled: v })} />
                </div>
                <div className="flex items-center justify-between gap-2 col-span-2">
                  <Label>Encashment</Label>
                  <Switch checked={!!form.encashmentEnabled} onCheckedChange={(v) => setForm({ ...form, encashmentEnabled: v })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Advance Notice (days)</Label>
                  <Input type="number" min={0} value={form.advanceNoticeDays ?? 0}
                    onChange={(e) => setForm({ ...form, advanceNoticeDays: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Carry-Fwd Max (days)</Label>
                  <Input type="number" min={0} value={form.carryForwardMax ?? ""}
                    placeholder="Unlimited"
                    onChange={(e) => setForm({ ...form, carryForwardMax: e.target.value || undefined })} />
                </div>
                <div className="space-y-1">
                  <Label>Min Consecutive Days</Label>
                  <Input type="number" min={0} value={form.minConsecutiveDays ?? ""}
                    placeholder="None"
                    onChange={(e) => setForm({ ...form, minConsecutiveDays: e.target.value || undefined })} />
                </div>
                <div className="space-y-1">
                  <Label>Max Consecutive Days</Label>
                  <Input type="number" min={0} value={form.maxConsecutiveDays ?? ""}
                    placeholder="Unlimited"
                    onChange={(e) => setForm({ ...form, maxConsecutiveDays: e.target.value || undefined })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Save Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
