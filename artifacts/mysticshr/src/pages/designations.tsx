import { useState } from "react";
import { useListDesignations, useCreateDesignation, useUpdateDesignation, useDeleteDesignation, useListDepartments, getListDesignationsQueryKey } from "@workspace/api-client-react";
import type { ListDesignationsQueryResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Briefcase } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface DesigForm { title: string; code: string; departmentId: string; level: string; }
type Designation = ListDesignationsQueryResult[number];

export default function DesignationsPage() {
  const qc = useQueryClient();
  const { data: designations, isLoading } = useListDesignations();
  const { data: departments } = useListDepartments();
  const createMut = useCreateDesignation();
  const updateMut = useUpdateDesignation();
  const deleteMut = useDeleteDesignation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<DesigForm>({ title: "", code: "", departmentId: "", level: "1" });
  const [error, setError] = useState("");

  const deptMap = Object.fromEntries((departments ?? []).map(d => [d.id, d.name]));

  function openCreate() {
    setForm({ title: "", code: "", departmentId: "", level: "1" });
    setEditingId(null);
    setError("");
    setShowForm(true);
  }

  function openEdit(d: Designation) {
    setForm({ title: d.title, code: d.code, departmentId: d.departmentId ? String(d.departmentId) : "", level: String(d.level ?? 1) });
    setEditingId(d.id);
    setError("");
    setShowForm(true);
  }

  async function handleSubmit() {
    setError("");
    if (!form.title || !form.code) { setError("Title and code are required"); return; }
    const payload = {
      title: form.title,
      code: form.code,
      departmentId: form.departmentId ? parseInt(form.departmentId, 10) : undefined,
      level: parseInt(form.level || "1", 10),
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: getListDesignationsQueryKey() });
      setShowForm(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await deleteMut.mutateAsync({ id: deleteId });
    await qc.invalidateQueries({ queryKey: getListDesignationsQueryKey() });
    setDeleteId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Designations</h1>
          <p className="text-muted-foreground mt-1">{designations?.length ?? 0} designations</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Designation</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i} className="animate-pulse h-24 border-border" />)}
        </div>
      ) : !designations?.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No designations yet</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>Create first designation</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {designations.map((d) => (
            <Card key={d.id} className="border-border hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{d.code}</span>
                      <span className="text-xs text-muted-foreground">Level {d.level}</span>
                    </div>
                    <p className="font-semibold text-foreground">{d.title}</p>
                    {d.departmentId && <p className="text-xs text-muted-foreground mt-1">{deptMap[d.departmentId] ?? "—"}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(d.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Designation" : "New Designation"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Software Engineer" /></div>
            <div className="space-y-1.5"><Label>Code *</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="SWE" /></div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.departmentId} onValueChange={v => setForm(f => ({ ...f, departmentId: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No department</SelectItem>
                  {departments?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Level</Label><Input type="number" min={1} max={10} value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{createMut.isPending || updateMut.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Designation</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this designation?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
