import { useState } from "react";
import { Link } from "wouter";
import {
  useGetEssDashboard,
  useGetEssProfile,
  useUpdateEssProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User, FileText, Calendar, Clock, Target, Wallet, Home, Phone, AlertCircle,
  ChevronRight, TrendingUp, CheckCircle2, Bell,
} from "lucide-react";

function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: profile } = useGetEssProfile();
  const update = useUpdateEssProfile();
  const [form, setForm] = useState({
    phone: profile?.phone ?? "",
    personalEmail: (profile as any)?.personalEmail ?? "",
    currentAddress: profile?.currentAddress ?? "",
    emergencyContactName: profile?.emergencyContactName ?? "",
    emergencyContactPhone: profile?.emergencyContactPhone ?? "",
    emergencyContactRelation: profile?.emergencyContactRelation ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ data: form }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/ess/me"] });
        onClose();
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Personal Information</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Personal Email</Label>
              <Input type="email" value={form.personalEmail} onChange={e => setForm(f => ({ ...f, personalEmail: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Current Address</Label>
            <Input value={form.currentAddress} onChange={e => setForm(f => ({ ...f, currentAddress: e.target.value }))} />
          </div>
          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-2">Emergency Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.emergencyContactName} onChange={e => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} />
              </div>
              <div>
                <Label>Relation</Label>
                <Input value={form.emergencyContactRelation} onChange={e => setForm(f => ({ ...f, emergencyContactRelation: e.target.value }))} />
              </div>
            </div>
            <div className="mt-2">
              <Label>Phone</Label>
              <Input value={form.emergencyContactPhone} onChange={e => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ESS_MODULES = [
  {
    label: "Payslips",
    description: "View & download payslips",
    href: "/payroll/payslips",
    icon: Wallet,
    color: "bg-green-100 text-green-600",
  },
  {
    label: "Leave",
    description: "Apply for leave & check balances",
    href: "/leave",
    icon: Calendar,
    color: "bg-blue-100 text-blue-600",
  },
  {
    label: "Attendance",
    description: "View attendance & regularize",
    href: "/attendance",
    icon: Clock,
    color: "bg-orange-100 text-orange-600",
  },
  {
    label: "Goals & KPIs",
    description: "View your performance goals",
    href: "/performance/goals",
    icon: Target,
    color: "bg-violet-100 text-violet-600",
  },
  {
    label: "Self Appraisal",
    description: "Submit self-appraisal ratings",
    href: "/performance/appraisals",
    icon: CheckCircle2,
    color: "bg-amber-100 text-amber-600",
  },
  {
    label: "Tax Declaration",
    description: "Declare investments for TDS",
    href: "/payroll/tax-declaration",
    icon: FileText,
    color: "bg-teal-100 text-teal-600",
  },
];

export default function EssPortalPage() {
  const [showEditProfile, setShowEditProfile] = useState(false);
  const { data: profile, isLoading: loadingProfile } = useGetEssProfile();
  const { data: dashboard, isLoading: loadingDashboard } = useGetEssDashboard();

  if (loadingProfile) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Home className="w-6 h-6 text-primary" />
            Employee Self-Service
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Your personal HR portal</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="profile">My Profile</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
        </TabsList>

        {/* DASHBOARD TAB */}
        <TabsContent value="dashboard" className="space-y-4">
          {/* Attendance summary */}
          {dashboard && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{dashboard.attendance?.presentDays ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Present Days</p>
                    <p className="text-xs text-muted-foreground">{dashboard.attendance?.month}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-100">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{dashboard.attendance?.absentDays ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Absent Days</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-100">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{dashboard.attendance?.lateDays ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Late Days</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Leave Balances */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Leave Balances
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard?.leaveBalances?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leave balances found.</p>
                ) : (
                  <div className="space-y-2">
                    {(dashboard?.leaveBalances ?? []).map((lb: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm">{lb.leaveTypeName}</span>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                            {lb.balance ?? 0} left
                          </Badge>
                          <span className="text-xs text-muted-foreground">{lb.used ?? 0} used</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/leave" className="text-xs text-primary hover:underline mt-3 block">
                  View all leave →
                </Link>
              </CardContent>
            </Card>

            {/* Performance Goals */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" /> Active Goals
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard?.performanceGoals?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active performance goals.</p>
                ) : (
                  <div className="space-y-2">
                    {(dashboard?.performanceGoals ?? []).map((g: any) => (
                      <div key={g.id} className="flex items-center justify-between">
                        <span className="text-sm line-clamp-1">{g.title}</span>
                        <Badge variant="outline" className="text-xs">{g.weightage}%</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/performance/goals" className="text-xs text-primary hover:underline mt-3 block">
                  View all goals →
                </Link>
              </CardContent>
            </Card>

            {/* Recent Payslip */}
            {dashboard?.recentPayslip && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="w-4 h-4" /> Recent Payslip
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {(dashboard.recentPayslip as any)?.periodYear} — Month {(dashboard.recentPayslip as any)?.periodMonth}
                  </p>
                  <Link href="/payroll/payslips" className="text-xs text-primary hover:underline mt-2 block">
                    View all payslips →
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* PROFILE TAB */}
        <TabsContent value="profile">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" /> Personal Information
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowEditProfile(true)}>
                Edit
              </Button>
            </CardHeader>
            <CardContent>
              {profile ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Full Name" value={profile.name} />
                  <InfoRow label="Employee Code" value={profile.employeeCode ?? "—"} />
                  <InfoRow label="Email" value={profile.email} />
                  <InfoRow label="Designation" value={profile.designation ?? "—"} />
                  <InfoRow label="Department" value={profile.department ?? "—"} />
                  <InfoRow label="Date of Joining" value={profile.dateOfJoining ?? "—"} />
                  <InfoRow label="Phone" value={profile.phone ?? "—"} />
                  <InfoRow label="Current Address" value={profile.currentAddress ?? "—"} />
                  <div className="col-span-2 border-t pt-3">
                    <p className="text-sm font-medium mb-2 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Emergency Contact
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <InfoRow label="Name" value={profile.emergencyContactName ?? "—"} />
                      <InfoRow label="Relation" value={profile.emergencyContactRelation ?? "—"} />
                      <InfoRow label="Phone" value={profile.emergencyContactPhone ?? "—"} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No employee record linked to your account.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SERVICES TAB */}
        <TabsContent value="services">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {ESS_MODULES.map(mod => (
              <Link key={mod.href} href={mod.href}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className={`p-2.5 rounded-lg flex-shrink-0 ${mod.color}`}>
                      <mod.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{mod.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <EditProfileModal open={showEditProfile} onClose={() => setShowEditProfile(false)} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value || "—"}</p>
    </div>
  );
}
