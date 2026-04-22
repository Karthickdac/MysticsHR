import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetEssDashboard,
  useGetEssProfile,
  useUpdateEssProfile,
  useListIssuedDocuments,
  useListHelpdeskTickets,
  useCreateHelpdeskTicket,
  useListDocumentRequests,
  useCreateDocumentRequest,
  getListHelpdeskTicketsQueryKey,
  getListDocumentRequestsQueryKey,
  getGetEssDashboardQueryKey,
  type EssProfile,
  type IssuedDocument,
  type CreateHelpdeskTicketBody,
  type HelpdeskTicket,
  type DocumentRequest,
  type CreateDocumentRequestBody,
  type CreateDocumentRequestBodyDocumentType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { AttachmentUploader, type UploadedAttachment } from "@/components/AttachmentUploader";
import {
  User, FileText, Calendar, Clock, Target, Wallet, Home, Phone, AlertCircle,
  ChevronRight, CheckCircle2, Eye, Download, LifeBuoy, Plus, Ticket, Send, Bell,
} from "lucide-react";
import {
  useGetMyNotificationPreferences,
  useUpdateMyNotificationPreferences,
  getGetMyNotificationPreferencesQueryKey,
  useGetMySilencedNotifications,
  getGetMySilencedNotificationsQueryKey,
  useUnsilenceMyNotification,
  type NotificationPreferenceItem,
} from "@workspace/api-client-react";

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

const TICKET_CATEGORIES = ["IT", "HR", "Payroll", "Other"] as const;
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
type TicketCategory = (typeof TICKET_CATEGORIES)[number];
type TicketPriority = (typeof TICKET_PRIORITIES)[number];

const TICKET_PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-blue-100 text-blue-800",
  Medium: "bg-yellow-100 text-yellow-800",
  High: "bg-orange-100 text-orange-800",
  Urgent: "bg-red-100 text-red-800",
};

const TICKET_STATUS_COLORS: Record<string, string> = {
  Open: "bg-gray-100 text-gray-800",
  "In Progress": "bg-blue-100 text-blue-800",
  "Pending Employee Response": "bg-yellow-100 text-yellow-800",
  Resolved: "bg-green-100 text-green-800",
  Closed: "bg-gray-100 text-gray-500",
};

function RaiseTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateHelpdeskTicket();
  const [form, setForm] = useState<CreateHelpdeskTicketBody>({
    subject: "",
    description: "",
    category: "IT",
    priority: "Medium",
    attachmentUrl: null,
  });
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({ data: { ...form, attachments } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListHelpdeskTicketsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetEssDashboardQueryKey() });
        setForm({ subject: "", description: "", category: "IT", priority: "Medium", attachmentUrl: null });
        setAttachments([]);
        onClose();
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a Helpdesk Ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-raise-ticket">
          <div>
            <Label>Subject *</Label>
            <Input
              data-testid="input-ticket-subject"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief summary of the issue"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(v: TicketCategory) => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-ticket-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority *</Label>
              <Select value={form.priority} onValueChange={(v: TicketPriority) => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger data-testid="select-ticket-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description *</Label>
            <Textarea
              data-testid="input-ticket-description"
              rows={4}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the issue in detail..."
              required
            />
          </div>
          <AttachmentUploader value={attachments} onChange={setAttachments} disabled={create.isPending} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              data-testid="button-submit-ticket"
              disabled={create.isPending || !form.subject || !form.description}
            >
              {create.isPending ? "Submitting..." : "Submit Ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HelpdeskTab() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: tickets = [], isLoading } = useListHelpdeskTickets();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" /> My Helpdesk Tickets
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Raise IT, HR or Payroll requests and track their status.
          </p>
        </div>
        <Button size="sm" data-testid="button-raise-ticket" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> Raise Ticket
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
        ) : tickets.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Ticket className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">You haven't raised any tickets yet.</p>
            <p className="text-xs mt-1">Click "Raise Ticket" to submit a new request.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(tickets as HelpdeskTicket[]).map(t => (
              <Link key={t.id} href={`/helpdesk/${t.id}`}>
                <div
                  data-testid={`row-ticket-${t.id}`}
                  className="flex items-center gap-4 p-3 rounded-md border hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{t.subject}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-xs ${TICKET_STATUS_COLORS[t.status] ?? ""}`}>{t.status}</Badge>
                      <Badge className={`text-xs ${TICKET_PRIORITY_COLORS[t.priority] ?? ""}`}>{t.priority}</Badge>
                      <span className="text-xs text-muted-foreground">{t.category}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {new Date(t.createdAt).toLocaleDateString("en-IN")}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
      <RaiseTicketModal open={showCreate} onClose={() => setShowCreate(false)} />
    </Card>
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

function RecentlySilencedPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useGetMySilencedNotifications();
  const unsilence = useUnsilenceMyNotification();
  const items = (data?.items ?? []) as Array<{
    eventType: string; label: string; description: string; module: string;
    emailEnabled: boolean; whatsappEnabled: boolean; silencedAt: string;
  }>;
  const windowDays = data?.windowDays ?? 30;

  function handleReenable(eventType: string, label: string) {
    unsilence.mutate(
      { eventType },
      {
        onSuccess: async () => {
          toast({ title: "Re-enabled", description: `"${label}" notifications turned back on.` });
          await Promise.all([
            qc.invalidateQueries({ queryKey: getGetMySilencedNotificationsQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetMyNotificationPreferencesQueryKey() }),
          ]);
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : "Could not re-enable notification";
          toast({ title: "Re-enable failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function scrollToMaster() {
    const el = document.getElementById("notification-master-preferences");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <Card data-testid="card-recently-silenced">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="w-4 h-4 text-primary" /> Recently silenced
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Notifications you turned off in the last {windowDays} days. Re-enable any you didn't mean to silence.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-silenced-empty">
            You haven't silenced any notifications recently.{" "}
            <button
              type="button"
              onClick={scrollToMaster}
              className="underline text-primary hover:opacity-80"
              data-testid="link-jump-to-master-prefs"
            >
              Open master preferences
            </button>{" "}
            to fine-tune what you receive.
          </p>
        )}
        {!isLoading && items.length > 0 && (
          <ul className="divide-y border rounded-md">
            {items.map((it) => (
              <li
                key={it.eventType}
                className="p-3 flex items-start justify-between gap-4"
                data-testid={`row-silenced-${it.eventType}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{it.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Silenced {new Date(it.silencedAt).toLocaleString()} · {it.module}
                    {!it.emailEnabled && !it.whatsappEnabled
                      ? " · Email + WhatsApp off"
                      : !it.emailEnabled
                        ? " · Email off"
                        : " · WhatsApp off"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReenable(it.eventType, it.label)}
                  disabled={unsilence.isPending}
                  data-testid={`button-reenable-${it.eventType}`}
                >
                  Re-enable
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationPreferencesPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useGetMyNotificationPreferences();
  const update = useUpdateMyNotificationPreferences();
  const [draft, setDraft] = useState<NotificationPreferenceItem[] | null>(null);

  useEffect(() => {
    if (data?.items) setDraft(data.items);
  }, [data]);

  const items = draft ?? [];
  const isDirty = !!data?.items && draft !== null && JSON.stringify(draft) !== JSON.stringify(data.items);

  function setItem(eventType: string, patch: Partial<Pick<NotificationPreferenceItem, "emailEnabled" | "whatsappEnabled">>) {
    setDraft((prev) => prev?.map((it) => (it.eventType === eventType ? { ...it, ...patch } : it)) ?? null);
  }

  function setAll(field: "emailEnabled" | "whatsappEnabled", value: boolean) {
    setDraft((prev) => prev?.map((it) => ({ ...it, [field]: value })) ?? null);
  }

  function handleSave() {
    if (!draft) return;
    update.mutate(
      { data: { items: draft.map((it) => ({ eventType: it.eventType, emailEnabled: it.emailEnabled, whatsappEnabled: it.whatsappEnabled })) } },
      {
        onSuccess: () => {
          toast({ title: "Preferences saved", description: "Your notification choices have been updated." });
          qc.invalidateQueries({ queryKey: getGetMyNotificationPreferencesQueryKey() });
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : "Could not save preferences";
          toast({ title: "Save failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleReset() {
    if (data?.items) setDraft(data.items);
  }

  // Group by module for display.
  const grouped: Record<string, NotificationPreferenceItem[]> = {};
  for (const it of items) {
    const k = it.module || "Other";
    (grouped[k] ??= []).push(it);
  }

  if (isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading your notification preferences…</CardContent></Card>;

  return (
    <Card id="notification-master-preferences">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" /> Notification Preferences
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which notifications you want to receive by email or WhatsApp. Critical alerts cannot be turned off elsewhere — these toggles only affect this list.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 pb-4 border-b">
          <span className="text-sm font-medium mr-2">Quick actions:</span>
          <Button size="sm" variant="outline" onClick={() => setAll("emailEnabled", true)}>Enable all email</Button>
          <Button size="sm" variant="outline" onClick={() => setAll("emailEnabled", false)}>Disable all email</Button>
          <Button size="sm" variant="outline" onClick={() => setAll("whatsappEnabled", true)}>Enable all WhatsApp</Button>
          <Button size="sm" variant="outline" onClick={() => setAll("whatsappEnabled", false)}>Disable all WhatsApp</Button>
        </div>

        {Object.entries(grouped).map(([mod, list]) => (
          <div key={mod} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{mod}</h3>
            <div className="space-y-2">
              {list.map((it) => (
                <div key={it.eventType} className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{it.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{it.description}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Email</span>
                      <Switch
                        checked={it.emailEnabled}
                        onCheckedChange={(v) => setItem(it.eventType, { emailEnabled: v })}
                        aria-label={`Email notifications for ${it.label}`}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">WhatsApp</span>
                      <Switch
                        checked={it.whatsappEnabled}
                        onCheckedChange={(v) => setItem(it.eventType, { whatsappEnabled: v })}
                        aria-label={`WhatsApp notifications for ${it.label}`}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleReset} disabled={!isDirty || update.isPending}>Reset</Button>
          <Button onClick={handleSave} disabled={!isDirty || update.isPending}>
            {update.isPending ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EssPortalPage() {
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showDashboardTicket, setShowDashboardTicket] = useState(false);
  const search = useSearch();
  const { data: profile, isLoading: loadingProfile } = useGetEssProfile();
  const { data: dashboard } = useGetEssDashboard();
  const { data: issuedDocs = [] } = useListIssuedDocuments(
    profile?.employeeId ? { employeeId: profile.employeeId } : {}
  );

  const validTabs = ["dashboard", "profile", "services", "documents", "helpdesk", "notifications"];
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
          <TabsTrigger value="helpdesk">Helpdesk</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
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
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab("helpdesk")}
                  className="flex items-center gap-3 flex-1 text-left hover:opacity-80"
                  data-testid="card-open-tickets"
                >
                  <div className="p-2 rounded-lg bg-rose-100">
                    <LifeBuoy className="w-5 h-5 text-rose-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-bold" data-testid="text-open-ticket-count">
                      {dashboard.openTicketCount ?? 0}
                      <span className="text-base font-normal text-muted-foreground"> open</span>
                    </p>
                    <p className="text-sm text-muted-foreground">Helpdesk Tickets</p>
                    <p className="text-xs text-muted-foreground">Tap to view your tickets</p>
                  </div>
                </button>
                <Button
                  size="sm"
                  data-testid="button-dashboard-raise-ticket"
                  onClick={() => setShowDashboardTicket(true)}
                >
                  <Plus className="w-4 h-4 mr-1" /> Raise a Ticket
                </Button>
              </CardContent>
            </Card>
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

        <TabsContent value="helpdesk" className="space-y-4">
          <HelpdeskTab />
        </TabsContent>

        <TabsContent value="services" className="space-y-6">
          <DocumentRequestSection />

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
            <Link href="/ess?tab=helpdesk">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="p-2.5 rounded-lg flex-shrink-0 bg-rose-100 text-rose-600">
                    <LifeBuoy className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Helpdesk</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Raise IT, HR or Payroll tickets
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                </CardContent>
              </Card>
            </Link>
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

        <TabsContent value="notifications" className="space-y-4">
          <RecentlySilencedPanel />
          <NotificationPreferencesPanel />
        </TabsContent>
      </Tabs>

      <EditProfileModal open={showEditProfile} onClose={() => setShowEditProfile(false)} />
      <RaiseTicketModal open={showDashboardTicket} onClose={() => setShowDashboardTicket(false)} />
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

const DOC_REQUEST_TYPES: CreateDocumentRequestBodyDocumentType[] = [
  "Experience Certificate",
  "Appointment Letter",
  "NOC",
  "Offer Letter",
  "Relieving Letter",
];

const DOC_REQUEST_STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Fulfilled: "bg-green-100 text-green-800",
  Cancelled: "bg-gray-100 text-gray-500",
};

function DocumentRequestSection() {
  const qc = useQueryClient();
  const create = useCreateDocumentRequest();
  const { data: requests = [], isLoading } = useListDocumentRequests();
  const [form, setForm] = useState<CreateDocumentRequestBody>({
    documentType: "Experience Certificate",
    reason: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({ data: { ...form, reason: form.reason || null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
        setForm({ documentType: "Experience Certificate", reason: "" });
      },
    });
  }

  const myRequests = requests as DocumentRequest[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" /> Request HR Document
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pick a document type and HR will generate &amp; issue it to you. You can download it from the My Documents tab once it's ready.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" data-testid="form-document-request">
          <div className="md:col-span-1">
            <Label>Document Type *</Label>
            <Select
              value={form.documentType}
              onValueChange={(v: CreateDocumentRequestBodyDocumentType) =>
                setForm(f => ({ ...f, documentType: v }))
              }
            >
              <SelectTrigger data-testid="select-document-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_REQUEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-1">
            <Label>Reason (optional)</Label>
            <Input
              data-testid="input-document-reason"
              value={form.reason ?? ""}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g., visa application"
            />
          </div>
          <div>
            <Button
              type="submit"
              disabled={create.isPending}
              data-testid="button-submit-document-request"
              className="w-full"
            >
              <Send className="w-4 h-4 mr-1" />
              {create.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>

        <div className="mt-6">
          <p className="text-xs font-medium text-muted-foreground mb-2">My Recent Requests</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">You haven't submitted any document requests yet.</p>
          ) : (
            <div className="space-y-2">
              {myRequests.slice(0, 5).map(r => (
                <div
                  key={r.id}
                  data-testid={`row-doc-request-${r.id}`}
                  className="flex items-center gap-3 p-2.5 rounded border bg-muted/20"
                >
                  <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.documentType}</p>
                    {r.reason && <p className="text-xs text-muted-foreground truncate">{r.reason}</p>}
                    {r.hrNote && <p className="text-xs text-muted-foreground">HR note: {r.hrNote}</p>}
                  </div>
                  <Badge className={`text-xs ${DOC_REQUEST_STATUS_COLORS[r.status] ?? ""}`}>
                    {r.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(r.createdAt).toLocaleDateString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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
