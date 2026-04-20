import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotificationLogs,
  useListNotificationTemplates,
  useCreateNotificationTemplate,
  useUpdateNotificationTemplate,
  useDeleteNotificationTemplate,
  useTestSmtpConfig,
  useTestWhatsAppConfig,
  useGetSystemSettings,
  useUpdateSystemSettings,
  getListNotificationLogsQueryKey,
  getListNotificationTemplatesQueryKey,
  type NotificationTemplate,
} from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, Mail, MessageSquare, CheckCircle, XCircle, AlertCircle, Pencil, Trash2, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const EVENT_TYPES = [
  { value: "leave_submitted", label: "Leave Application Submitted" },
  { value: "leave_approved", label: "Leave Approved" },
  { value: "leave_rejected", label: "Leave Rejected" },
  { value: "payslip_published", label: "Payslip Published" },
  { value: "payroll_locked", label: "Payroll Locked" },
  { value: "payroll_run_pending_approval", label: "Payroll Run Awaiting Approval" },
  { value: "offer_letter_issued", label: "Offer Letter Issued" },
  { value: "onboarding_access", label: "Pre-Onboarding Portal Access" },
  { value: "document_issued", label: "Document Issued" },
  { value: "helpdesk_ticket_raised", label: "Helpdesk Ticket Raised" },
  { value: "helpdesk_sla_breach", label: "Helpdesk SLA Breach" },
  { value: "exit_clearance_completed", label: "Exit Clearance Completed" },
  { value: "id_card_generated", label: "ID Card Generated" },
  { value: "no_sign_in", label: "No Sign-In Detected" },
  { value: "no_sign_out", label: "No Sign-Out Detected" },
  { value: "overtime_alert", label: "Overtime Threshold Exceeded" },
  { value: "consecutive_absence", label: "Consecutive Absences" },
  { value: "onboarding_doc_pending", label: "Pre-Onboarding Document Pending" },
];

function statusBadge(status: string) {
  if (status === "sent") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle className="w-3 h-3 mr-1" />{status}</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100"><XCircle className="w-3 h-3 mr-1" />{status}</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100"><AlertCircle className="w-3 h-3 mr-1" />{status}</Badge>;
}

// ─── Notification Logs Tab ────────────────────────────────────────────────────

function NotificationLogsTab() {
  const [channel, setChannel] = useState("");
  const [mod, setMod] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 20;

  const { data, isLoading } = useListNotificationLogs({
    channel: channel || undefined,
    module: mod || undefined,
    status: status || undefined,
    search: search || undefined,
    limit: String(PAGE),
    offset: String(page * PAGE),
  });

  const logs = (data as { logs: unknown[]; total: number } | undefined)?.logs ?? [];
  const total = (data as { logs: unknown[]; total: number } | undefined)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={channel || "_all"} onValueChange={(v) => { setChannel(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="Channel" /></SelectTrigger>
          <SelectContent>
            {["_all", "email", "whatsapp", "in_app"].map((c) => <SelectItem key={c} value={c}>{c === "_all" ? "All Channels" : c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mod || "_all"} onValueChange={(v) => { setMod(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>
            {["_all", "leave", "payroll", "helpdesk", "documents", "exit", "recruitment"].map((m) => <SelectItem key={m} value={m}>{m === "_all" ? "All Modules" : m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || "_all"} onValueChange={(v) => { setStatus(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {["_all", "sent", "failed", "pending"].map((s) => <SelectItem key={s} value={s}>{s === "_all" ? "All Status" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Search recipient or event…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="h-8 text-sm w-48" />
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && logs.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No notifications logged yet.</TableCell></TableRow>
            )}
            {(logs as Array<Record<string, unknown>>).map((log) => (
              <TableRow key={String(log.id)}>
                <TableCell>
                  {log.channel === "email" ? <Badge variant="outline"><Mail className="w-3 h-3 mr-1" />Email</Badge> :
                   log.channel === "whatsapp" ? <Badge variant="outline"><MessageSquare className="w-3 h-3 mr-1" />WhatsApp</Badge> :
                   <Badge variant="outline">{String(log.channel)}</Badge>}
                </TableCell>
                <TableCell className="text-sm">{String(log.eventType).replace(/_/g, " ")}</TableCell>
                <TableCell><Badge variant="secondary">{String(log.module)}</Badge></TableCell>
                <TableCell className="text-sm">{String(log.recipientEmail ?? log.recipientPhone ?? "—")}</TableCell>
                <TableCell>{statusBadge(String(log.status))}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(String(log.sentAt)).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useListNotificationTemplates();
  const createMut = useCreateNotificationTemplate();
  const updateMut = useUpdateNotificationTemplate();
  const deleteMut = useDeleteNotificationTemplate();

  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<NotificationTemplate>>({});

  function openCreate() {
    setForm({ channel: "email", isActive: true });
    setCreating(true);
    setEditing(null);
  }

  function openEdit(t: NotificationTemplate) {
    setForm({ ...t });
    setEditing(t);
    setCreating(false);
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form as import("@workspace/api-client-react").UpdateNotificationTemplateBody });
        toast({ title: "Template updated" });
      } else {
        await createMut.mutateAsync({ data: form as import("@workspace/api-client-react").CreateNotificationTemplateBody });
        toast({ title: "Template created" });
      }
      qc.invalidateQueries({ queryKey: getListNotificationTemplatesQueryKey() });
      setEditing(null);
      setCreating(false);
    } catch {
      toast({ title: "Failed to save template", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this template?")) return;
    await deleteMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListNotificationTemplatesQueryKey() });
    toast({ title: "Template deleted" });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />Add Template</Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event Type</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && (templates as NotificationTemplate[]).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No custom templates yet. Default templates are used automatically.
              </TableCell></TableRow>
            )}
            {(templates as NotificationTemplate[]).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm font-medium">{EVENT_TYPES.find((e) => e.value === t.eventType)?.label ?? t.eventType}</TableCell>
                <TableCell><Badge variant="outline">{t.channel}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{t.emailSubject ?? "—"}</TableCell>
                <TableCell><Badge className={t.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>{t.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}><Pencil className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => handleDelete(t.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Notification Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editing && (
              <div>
                <Label>Event Type</Label>
                <Select value={form.eventType ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, eventType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Channel</Label>
              <Select value={form.channel ?? "email"} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email Only</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp Only</SelectItem>
                  <SelectItem value="both">Both Email + WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(form.channel === "email" || form.channel === "both") && (
              <>
                <div>
                  <Label>Email Subject</Label>
                  <Input value={form.emailSubject ?? ""} onChange={(e) => setForm((f) => ({ ...f, emailSubject: e.target.value }))} placeholder="Use {{variable}} for dynamic values" />
                </div>
                <div>
                  <Label>Email Body (HTML supported)</Label>
                  <Textarea rows={8} value={form.emailBody ?? ""} onChange={(e) => setForm((f) => ({ ...f, emailBody: e.target.value }))} placeholder="<p>Dear {{recipientName}},</p><p>...</p>" className="font-mono text-sm" />
                </div>
              </>
            )}
            {(form.channel === "whatsapp" || form.channel === "both") && (
              <div>
                <Label>WhatsApp Message</Label>
                <Textarea rows={4} value={form.whatsappTemplate ?? ""} onChange={(e) => setForm((f) => ({ ...f, whatsappTemplate: e.target.value }))} placeholder="MysticsHR: {{message}}" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive ?? true} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Email Config Tab ─────────────────────────────────────────────────────────

function EmailConfigTab() {
  const { data: settings } = useGetSystemSettings("email");
  const updateMut = useUpdateSystemSettings();
  const testMut = useTestSmtpConfig();

  const cfg = (settings as Record<string, string> | undefined) ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const merged = { ...cfg, ...form };

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ category: "email", data: merged });
      toast({ title: "SMTP settings saved" });
    } catch {
      toast({ title: "Failed to save SMTP settings", variant: "destructive" });
    }
  }

  async function handleTest() {
    try {
      const result = await testMut.mutateAsync({ data: { ...merged, secure: merged.secure === "true" } });
      if ((result as { success?: boolean }).success) {
        toast({ title: "SMTP connection successful" });
      } else {
        toast({ title: `SMTP test failed: ${(result as { error?: string }).error}`, variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: "SMTP test failed", variant: "destructive" });
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" />Email (SMTP) Configuration</CardTitle>
        <CardDescription>Configure the outgoing email server used for all HR notifications.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>SMTP Host</Label>
            <Input value={merged.host ?? ""} onChange={(e) => set("host", e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div>
            <Label>Port</Label>
            <Input type="number" value={merged.port ?? "587"} onChange={(e) => set("port", e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merged.secure === "true"} onCheckedChange={(v) => set("secure", String(v))} />
          <Label>Use SSL/TLS (port 465)</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Username</Label>
            <Input value={merged.username ?? ""} onChange={(e) => set("username", e.target.value)} placeholder="your@email.com" />
          </div>
          <div>
            <Label>Password / App Password</Label>
            <Input type="password" value={merged.password ?? ""} onChange={(e) => set("password", e.target.value)} />
          </div>
        </div>
        <div>
          <Label>From Address</Label>
          <Input value={merged.from ?? ""} onChange={(e) => set("from", e.target.value)} placeholder="MysticsHR <noreply@example.com>" />
        </div>
        <div>
          <Label>Test Email Address</Label>
          <Input value={merged.testTo ?? ""} onChange={(e) => set("testTo", e.target.value)} placeholder="Send test to this address" />
        </div>
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={updateMut.isPending}>Save Settings</Button>
          <Button variant="outline" onClick={handleTest} disabled={testMut.isPending}>
            <RefreshCw className={`w-4 h-4 mr-1 ${testMut.isPending ? "animate-spin" : ""}`} />
            Test Connection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── WhatsApp Config Tab ──────────────────────────────────────────────────────

function WhatsAppConfigTab() {
  const { data: settings } = useGetSystemSettings("whatsapp");
  const updateMut = useUpdateSystemSettings();
  const testMut = useTestWhatsAppConfig();

  const cfg = (settings as Record<string, string> | undefined) ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const merged = { ...cfg, ...form };

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ category: "whatsapp", data: merged });
      toast({ title: "WhatsApp settings saved" });
    } catch {
      toast({ title: "Failed to save WhatsApp settings", variant: "destructive" });
    }
  }

  async function handleTest() {
    try {
      const result = await testMut.mutateAsync({ data: { phone_number_id: merged.phone_number_id, access_token: merged.access_token, testTo: merged.testTo } });
      if ((result as { success?: boolean }).success) {
        toast({ title: "WhatsApp test message sent successfully" });
      } else {
        toast({ title: `WhatsApp test failed: ${(result as { error?: string }).error}`, variant: "destructive" });
      }
    } catch {
      toast({ title: "WhatsApp test failed", variant: "destructive" });
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />WhatsApp Business API Configuration</CardTitle>
        <CardDescription>Configure WhatsApp Cloud API for automated HR notifications via WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
          Requires a WhatsApp Business Account on Meta Business Platform. Obtain credentials from <strong>Meta for Developers → Your App → WhatsApp → API Setup</strong>.
        </div>
        <div>
          <Label>Phone Number ID</Label>
          <Input value={merged.phone_number_id ?? ""} onChange={(e) => set("phone_number_id", e.target.value)} placeholder="123456789012345" />
        </div>
        <div>
          <Label>Permanent Access Token</Label>
          <Input type="password" value={merged.access_token ?? ""} onChange={(e) => set("access_token", e.target.value)} />
        </div>
        <div>
          <Label>Test Recipient Phone (with country code)</Label>
          <Input value={merged.testTo ?? ""} onChange={(e) => set("testTo", e.target.value)} placeholder="+91XXXXXXXXXX" />
        </div>
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={updateMut.isPending}>Save Settings</Button>
          <Button variant="outline" onClick={handleTest} disabled={testMut.isPending}>
            <RefreshCw className={`w-4 h-4 mr-1 ${testMut.isPending ? "animate-spin" : ""}`} />
            Send Test Message
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommunicationsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-6 h-6" />Communications & Notifications</h1>
          <p className="text-muted-foreground mt-1">Manage email and WhatsApp notifications across all HR workflows.</p>
        </div>

        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs">Notification Log</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="email">Email Config</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp Config</TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4">
            <NotificationLogsTab />
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Customize notification content per event. If no template is configured for an event, the built-in default template is used automatically.
                Use <code className="bg-muted px-1 rounded">{"{{variable}}"}</code> placeholders in subject and body.
              </p>
            </div>
            <TemplatesTab />
          </TabsContent>

          <TabsContent value="email" className="mt-4">
            <EmailConfigTab />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-4">
            <WhatsAppConfigTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
