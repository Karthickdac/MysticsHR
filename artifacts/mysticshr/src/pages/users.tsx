import { useState } from "react";
import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import type { HrmsUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Pencil, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  hod: "Head of Department",
  payroll_admin: "Payroll Admin",
  employee: "Employee",
};
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-800",
  hr_manager: "bg-blue-100 text-blue-800",
  hr_executive: "bg-sky-100 text-sky-800",
  hod: "bg-purple-100 text-purple-800",
  payroll_admin: "bg-orange-100 text-orange-800",
  employee: "bg-gray-100 text-gray-700",
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: users, isLoading } = useListUsers();
  const updateMut = useUpdateUser();
  const [editUser, setEditUser] = useState<HrmsUser | null>(null);
  const [role, setRole] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");

  function openEdit(u: HrmsUser) {
    setEditUser(u);
    setRole(u.role);
    setIsActive(u.isActive);
    setError("");
  }

  async function handleSave() {
    if (!editUser) return;
    setError("");
    try {
      await updateMut.mutateAsync({ id: editUser.id, data: { ...editUser, role, isActive } });
      await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setEditUser(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <p className="text-muted-foreground mt-1">Manage HRMS user accounts and roles</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Card key={i} className="animate-pulse h-16 border-border" />)}
        </div>
      ) : !users?.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No users provisioned yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u.id} className="border-border hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Avatar className="w-10 h-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                      {u.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${u.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editUser} onOpenChange={v => !v && setEditUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit User: {editUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Account active</Label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMut.isPending}>{updateMut.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
