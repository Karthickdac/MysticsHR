import { useState } from "react";
import { useListDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListDepartmentsQueryKey } from "@workspace/api-client-react";

interface DeptFormState { name: string; code: string; description: string; }

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const { data: departments, isLoading } = useListDepartments();
  const createMut = useCreateDepartment();
  const updateMut = useUpdateDepartment();
  const deleteMut = useDeleteDepartment();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<DeptFormState>({ name: "", code: "", description: "" });
  const [error, setError] = useState("");

  function openCreate() {
    setForm({ name: "", code: "", description: "" });
    setEditingId(null);
    setError("");
    setShowForm(true);
  }

  function openEdit(dept: any) {
    setForm({ name: dept.name, code: dept.code, description: dept.description ?? "" });
    setEditingId(dept.id);
    setError("");
    setShowForm(true);
  }

  async function handleSubmit() {
    setError("");
    if (!form.name || !form.code) { setError("Name and code are required"); return; }
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: form });
      } else {
        await createMut.mutateAsync({ data: form });
      }
      await qc.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      setShowForm(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteMut.mutateAsync({ id: deleteId });
      await qc.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      setDeleteId(null);
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Departments</h1>
          <p className="text-muted-foreground mt-1">{departments?.length ?? 0} departments</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Department</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Card key={i} className="animate-pulse h-28 border-border" />)}
        </div>
      ) : !departments?.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No departments yet</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>Create your first department</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept) => (
            <Card key={dept.id} className="border-border hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{dept.code}</span>
                      {!dept.isActive && <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Inactive</span>}
                    </div>
                    <p className="font-semibold text-foreground">{dept.name}</p>
                    {dept.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{dept.description}</p>}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(dept)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(dept.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Department" : "New Department"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Engineering" />
            </div>
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="ENG" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the department. This action cannot be undone.</AlertDialogDescription>
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
