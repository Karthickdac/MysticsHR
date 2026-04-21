import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetEssDashboard,
  useGetEssProfile,
  useUpdateEssProfile,
  useListIssuedDocuments,
  type EssProfile,
  type IssuedDocument,
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
  ChevronRight, CheckCircle2, Eye, Download,
} from "lucide-react";

type LeaveBalanceItem = {
  leaveTypeName: string;
  balance: string | number | null;
  allocated?: string | number | null;
  used: string | number | null;
  pending?: string | number | null;
  carryForward?: string | number | null;
};

type PermissionRegisterSummary = {
  year: number;
  month: number;
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
};

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

type GoalSummaryItem = {
  id: number;
  title: string;
  weightage: number;
};

type PayslipSummaryItem = {
  periodYear: number | null;
  periodMonth: number | null;
};

function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: profile } = useGetEssProfile();
  const update = useUpdateEssProfile();
  const [form, setForm] = useState({
    phone: profile?.phone ?? "",
    personalEmail: profile?.personalEmail ?? "",
    currentAddress: profile?.currentAddress ?? "",
    emergencyContactName: profile?.emergencyContactName ?? "",
    emergencyContactPhone: profile?.emergencyContactPhone ?? "",
    emergencyContactRelation: profile?.emergencyContactRelation ?? "",
  });

  useEffect(() => {
    if (open && profile) {
      setForm({
        phone: profile.phone ?? "",
        personalEmail: profile.personalEmail ?? "",
        currentAddress: profile.currentAddress ?? "",
        emergencyContactName: profile.emergencyContactName ?? "",
        emergencyContactPhone: profile.emergencyContactPhone ?? "",
        emergencyContactRelation: profile.emergencyContactRelation ?? "",
      });
    }
  }, [open, profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ data: form }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/ess/me"] });
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
  const search = useSearch();
  const { data: profile, isLoading: loadingProfile } = useGetEssProfile();
  const { data: dashboard } = useGetEssDashboard();
  const { data: issuedDocs = [] } = useListIssuedDocuments(
    profile?.employeeId ? { employeeId: profile.employeeId } : {}
  );

  const validTabs = ["dashboard", "profile", "services", "documents"];
  const tabFromUrl = new URLSearchParams(search).get("tab");
  const urlTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "dashboard";
  const [activeTab, setActiveTab] = useState(urlTab);

  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  if (loadingProfile) return <div className="p-6">Loading...</div>;

  const myDocuments = issuedDocs as IssuedDocument[];
  const leaveBalances = (dashboard?.leaveBalances ?? []) as LeaveBalanceItem[];
  const performanceGoals = (dashboard?.performanceGoals ?? []) as GoalSummaryItem[];
  const recentPayslip = dashboard?.recentPayslip as PayslipSummaryItem | null | undefined;
  const permissionRegister = dashboard?.permissionRegister as PermissionRegisterSummary | null | undefined;

  const totalLeaveRemaining = leaveBalances.reduce((sum, lb) => sum + num(lb.balance), 0);
  const permRemainingHrs = permissionRegister ? (permissionRegister.remainingMinutes / 60) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Home className="w-6 h-6 text-primary" />
            Employee Self-Service
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Your personal HR portal</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="profile">My Profile</TabsTrigger>
          <TabsTrigger value="documents">My Documents</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {dashboard && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link href="/leave">
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-100">
                      <Calendar className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-2xl font-bold">
                        {totalLeaveRemaining}
                        <span className="text-base font-normal text-muted-foreground"> days</span>
                      </p>
                      <p className="text-sm text-muted-foreground">Leave Remaining</p>
                      <p className="text-xs text-muted-foreground">across {leaveBalances.length} leave type{leaveBalances.length !== 1 ? "s" : ""}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link href="/permissions">
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-violet-100">
                      <Clock className="w-5 h-5 text-violet-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-2xl font-bold">
                        {permRemainingHrs.toFixed(1)}
                        <span className="text-base font-normal text-muted-foreground"> hrs</span>
                      </p>
                      <p className="text-sm text-muted-foreground">Permission Remaining</p>
                      <p className="text-xs text-muted-foreground">
                        {permissionRegister
                          ? `${(permissionRegister.usedMinutes / 60).toFixed(1)} of ${(permissionRegister.limitMinutes / 60).toFixed(1)} hrs used this month`
                          : "this month"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          )}

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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Leave Balances
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leaveBalances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leave balances found.</p>
                ) : (
                  <div className="space-y-3">
                    {leaveBalances.map((lb, i) => {
                      const available = num(lb.balance);
                      const allocated = num(lb.allocated) + num(lb.carryForward);
                      const used = num(lb.used);
                      const pending = num(lb.pending);
                      const usedPct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
                      const pendingPct = allocated > 0 ? Math.min(100 - usedPct, Math.round((pending / allocated) * 100)) : 0;
                      return (
                        <div key={i}>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-sm">{lb.leaveTypeName}</span>
                            <span className="text-xs">
                              <span className={`font-semibold ${available <= 0 ? "text-red-600" : "text-green-700"}`}>{available}</span>
                              <span className="text-muted-foreground"> / {allocated} left</span>
                            </span>
                          </div>
                          <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden flex">
                            <div className="bg-blue-500 h-1.5" style={{ width: `${usedPct}%` }} />
                            <div className="bg-yellow-400 h-1.5" style={{ width: `${pendingPct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Link href="/leave" className="text-xs text-primary hover:underline mt-3 block">
                  View all leave →
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" /> Active Goals
                </CardTitle>
              </CardHeader>
              <CardContent>
                {performanceGoals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active performance goals.</p>
                ) : (
                  <div className="space-y-2">
                    {performanceGoals.map(g => (
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

            {recentPayslip && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="w-4 h-4" /> Recent Payslip
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {recentPayslip.periodYear} — Month {recentPayslip.periodMonth}
                  </p>
                  <Link href="/payroll/payslips" className="text-xs text-primary hover:underline mt-2 block">
                    View all payslips →
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

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
                <ProfileDetails profile={profile} />
              ) : (
                <p className="text-sm text-muted-foreground">No employee record linked to your account.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                My HR Documents
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                View and download HR documents issued to you (offer letter, ID card, experience letter, salary certificates, etc.)
              </p>
            </CardHeader>
            <CardContent>
              {myDocuments.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No documents issued yet.</p>
                  <p className="text-xs mt-1">Contact HR to request an HR document.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myDocuments.map((doc: IssuedDocument) => (
                    <div
                      key={doc.id}
                      data-testid={`row-document-${doc.id}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="p-2 rounded-lg bg-blue-100 text-blue-600 flex-shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium capitalize truncate">
                            {(doc.documentType ?? "").replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {doc.filename ?? "—"} · Issued{" "}
                            {doc.generatedAt ? new Date(doc.generatedAt).toLocaleDateString() : "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a
                          href={`/api/documents/issued/${doc.id}/download?inline=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`link-preview-${doc.id}`}
                        >
                          <Button variant="outline" size="sm" className="gap-1">
                            <Eye className="w-3.5 h-3.5" /> Preview
                          </Button>
                        </a>
                        <a
                          href={`/api/documents/issued/${doc.id}/download`}
                          data-testid={`link-download-${doc.id}`}
                        >
                          <Button size="sm" className="gap-1">
                            <Download className="w-3.5 h-3.5" /> Download
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-6">
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
            <Link href="/ess?tab=documents">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="p-2.5 rounded-lg flex-shrink-0 bg-blue-100 text-blue-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">My Documents</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      View & download your HR documents
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                </CardContent>
              </Card>
            </Link>
          </div>
        </TabsContent>
      </Tabs>

      <EditProfileModal open={showEditProfile} onClose={() => setShowEditProfile(false)} />
    </div>
  );
}

function ProfileDetails({ profile }: { profile: EssProfile }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <InfoRow label="Full Name" value={profile.name} />
      <InfoRow label="Employee Code" value={profile.employeeCode ?? "—"} />
      <InfoRow label="Email" value={profile.email} />
      <InfoRow label="Designation" value={profile.designation ?? "—"} />
      <InfoRow label="Department" value={profile.department ?? "—"} />
      <InfoRow label="Date of Joining" value={profile.dateOfJoining ?? "—"} />
      <InfoRow label="Phone" value={profile.phone ?? "—"} />
      <InfoRow label="Personal Email" value={profile.personalEmail ?? "—"} />
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
