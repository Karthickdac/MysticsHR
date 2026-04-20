import { useState } from "react";
import { Link } from "wouter";
import {
  useListHelpdeskTickets,
  useCreateHelpdeskTicket,
  useGetHelpdeskSlaReport,
  getListHelpdeskTicketsQueryKey,
  type CreateHelpdeskTicketBody,
  type HelpdeskTicket,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Ticket, AlertTriangle, Clock, CheckCircle2, BarChart3 } from "lucide-react";

const CATEGORIES = ["IT", "HR", "Finance", "Admin", "Other"] as const;
const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const STATUSES = ["Open", "In Progress", "Pending Employee Response", "Resolved", "Closed"] as const;

type Priority = (typeof PRIORITIES)[number];
type Category = (typeof CATEGORIES)[number];

const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-blue-100 text-blue-800",
  Medium: "bg-yellow-100 text-yellow-800",
  High: "bg-orange-100 text-orange-800",
  Urgent: "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-gray-100 text-gray-800",
  "In Progress": "bg-blue-100 text-blue-800",
  "Pending Employee Response": "bg-yellow-100 text-yellow-800",
  Resolved: "bg-green-100 text-green-800",
  Closed: "bg-gray-100 text-gray-500",
};

function CreateTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateHelpdeskTicket();
  const [form, setForm] = useState<CreateHelpdeskTicketBody>({
    subject: "",
    description: "",
    category: "IT",
    priority: "Medium",
    attachmentUrl: null,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({ data: form }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListHelpdeskTicketsQueryKey() });
        setForm({ subject: "", description: "", category: "IT", priority: "Medium", attachmentUrl: null });
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Subject *</Label>
            <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief summary of the issue" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(v: Category) => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority *</Label>
              <Select value={form.priority} onValueChange={(v: Priority) => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description *</Label>
            <Textarea rows={4} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the issue in detail..." required />
          </div>
          <div>
            <Label>Attachment URL (optional)</Label>
            <Input
              value={form.attachmentUrl ?? ""}
              onChange={e => setForm(f => ({ ...f, attachmentUrl: e.target.value || null }))}
              placeholder="https://... (link to screenshot, document, etc.)"
            />
            <p className="text-xs text-muted-foreground mt-1">Provide a URL to any relevant file or screenshot</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.subject || !form.description}>
              {create.isPending ? "Submitting..." : "Submit Ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SlaReport() {
  const { data: report } = useGetHelpdeskSlaReport();
  if (!report) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{report.totalTickets ?? 0}</div>
          <div className="text-sm text-muted-foreground">Total Tickets</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{report.openTickets ?? 0}</div>
          <div className="text-sm text-muted-foreground">Open</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{report.resolvedTickets ?? 0}</div>
          <div className="text-sm text-muted-foreground">Resolved</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{report.slaBreachedCount ?? 0}</div>
          <div className="text-sm text-muted-foreground">SLA Breached</div>
        </CardContent>
      </Card>
    </div>
  );
}

function TicketRow({ ticket }: { ticket: HelpdeskTicket }) {
  const isBreached = ticket.slaBreached;
  return (
    <Link href={`/helpdesk/${ticket.id}`}>
      <div className="flex items-center gap-4 p-3 rounded-md border hover:bg-muted/40 cursor-pointer transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate">{ticket.subject}</span>
            {isBreached && <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-xs ${STATUS_COLORS[ticket.status] ?? ""}`}>{ticket.status}</Badge>
            <Badge className={`text-xs ${PRIORITY_COLORS[ticket.priority] ?? ""}`}>{ticket.priority}</Badge>
            <span className="text-xs text-muted-foreground">{ticket.category}</span>
            {ticket.raisedByName && <span className="text-xs text-muted-foreground">by {ticket.raisedByName}</span>}
          </div>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {new Date(ticket.createdAt).toLocaleDateString("en-IN")}
        </div>
      </div>
    </Link>
  );
}

export default function HelpdeskPage() {
  const { role } = useCurrentHrmsUser();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const isManager = ["super_admin", "hr_manager", "hr_executive", "hod"].includes(role ?? "");

  const { data: tickets = [], isLoading } = useListHelpdeskTickets({
    status: filterStatus !== "all" ? filterStatus : undefined,
    category: filterCategory !== "all" ? filterCategory : undefined,
    priority: filterPriority !== "all" ? filterPriority : undefined,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Helpdesk</h1>
          <p className="text-muted-foreground text-sm">
            {isManager ? "Manage and resolve tickets" : "View and raise support tickets"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <Link href="/helpdesk/sla-report">
              <Button variant="outline" size="sm">
                <BarChart3 className="w-4 h-4 mr-2" />
                SLA Report
              </Button>
            </Link>
          )}
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Raise Ticket
          </Button>
        </div>
      </div>

      {isManager && <SlaReport />}

      {/* Filters (manager only) */}
      {isManager && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue placeholder="All Categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger><SelectValue placeholder="All Priorities" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => { setFilterStatus("all"); setFilterCategory("all"); setFilterPriority("all"); }}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tickets list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Ticket className="w-4 h-4" />
            {isManager ? `All Tickets (${tickets.length})` : `My Tickets (${tickets.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Ticket className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No tickets found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map(t => <TicketRow key={t.id} ticket={t} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTicketModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
