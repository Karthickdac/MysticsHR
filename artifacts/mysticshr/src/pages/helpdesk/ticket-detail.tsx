import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetHelpdeskTicket,
  useUpdateHelpdeskTicket,
  useAddTicketComment,
  useDeleteTicketAttachment,
  getGetHelpdeskTicketQueryKey,
  getListHelpdeskTicketsQueryKey,
  type UpdateHelpdeskTicketBody,
} from "@workspace/api-client-react";
import { AttachmentUploader, AttachmentList, type UploadedAttachment } from "@/components/AttachmentUploader";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ArrowLeft, Clock, MessageSquare, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const STATUSES = ["Open", "In Progress", "Pending Employee Response", "Resolved", "Closed"] as const;

type Priority = (typeof PRIORITIES)[number];
type Status = (typeof STATUSES)[number];

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

function formatDt(dt: string) {
  return new Date(dt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);
  const qc = useQueryClient();
  const { role, hrmsUser } = useCurrentHrmsUser();

  const isManager = ["super_admin", "hr_manager", "hr_executive", "hod"].includes(role ?? "");

  const { data: ticket, isLoading } = useGetHelpdeskTicket(ticketId);
  const updateTicket = useUpdateHelpdeskTicket();
  const addComment = useAddTicketComment();
  const deleteAttachment = useDeleteTicketAttachment();

  const [editStatus, setEditStatus] = useState<Status | "">("");
  const [editPriority, setEditPriority] = useState<Priority | "">("");
  const [comment, setComment] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [commentAttachments, setCommentAttachments] = useState<UploadedAttachment[]>([]);

  function invalidateTicket() {
    qc.invalidateQueries({ queryKey: getGetHelpdeskTicketQueryKey(ticketId) });
  }

  function handleDeleteAttachment(attachmentId: number) {
    deleteAttachment.mutate({ id: ticketId, attachmentId }, { onSuccess: invalidateTicket });
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading ticket...</div>;
  if (!ticket) return <div className="p-6 text-muted-foreground">Ticket not found.</div>;

  function handleUpdate() {
    if (!editStatus && !editPriority) return;
    const body: UpdateHelpdeskTicketBody = {};
    if (editStatus) body.status = editStatus;
    if (editPriority) body.priority = editPriority;
    updateTicket.mutate({ id: ticketId, data: body }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListHelpdeskTicketsQueryKey() });
        setEditStatus("");
        setEditPriority("");
      },
    });
  }

  function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    addComment.mutate({ id: ticketId, data: { message: comment, isInternal, attachments: commentAttachments } }, {
      onSuccess: () => {
        invalidateTicket();
        setComment("");
        setIsInternal(false);
        setCommentAttachments([]);
      },
    });
  }

  const slaHours = ticket.slaDeadline
    ? Math.round((new Date(ticket.slaDeadline).getTime() - Date.now()) / (1000 * 60 * 60) * 10) / 10
    : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/helpdesk">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Ticket #{ticket.id}</h1>
      </div>

      {/* Ticket header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{ticket.subject}</CardTitle>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge className={STATUS_COLORS[ticket.status] ?? ""}>{ticket.status}</Badge>
                <Badge className={PRIORITY_COLORS[ticket.priority] ?? ""}>{ticket.priority}</Badge>
                <Badge variant="outline">{ticket.category}</Badge>
                {ticket.slaBreached && (
                  <Badge className="bg-red-100 text-red-800">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    SLA Breached
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
          {ticket.attachments && ticket.attachments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-700 mb-1.5">Attachments</p>
              <AttachmentList
                attachments={ticket.attachments}
                onDelete={handleDeleteAttachment}
                currentUserId={hrmsUser?.id ?? null}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Raised by: </span>
              <span className="font-medium">{ticket.raisedByName ?? "Unknown"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Assigned to: </span>
              <span className="font-medium">{ticket.assignedToName ?? "Unassigned"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Created: </span>
              <span>{formatDt(ticket.createdAt)}</span>
            </div>
            {ticket.slaDeadline && (
              <div>
                <span className="text-muted-foreground">SLA Deadline: </span>
                <span className={ticket.slaBreached ? "text-red-600 font-medium" : ""}>
                  {formatDt(ticket.slaDeadline)}
                  {!ticket.slaBreached && slaHours !== null && (
                    <span className="text-muted-foreground ml-1">
                      ({slaHours > 0 ? `${slaHours}h remaining` : "overdue"})
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Manager update controls */}
          {isManager && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">Update Ticket</p>
              <div className="grid grid-cols-2 gap-3">
                <Select value={editStatus} onValueChange={(v: Status) => setEditStatus(v)}>
                  <SelectTrigger><SelectValue placeholder="Change status..." /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={editPriority} onValueChange={(v: Priority) => setEditPriority(v)}>
                  <SelectTrigger><SelectValue placeholder="Change priority..." /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={handleUpdate} disabled={updateTicket.isPending || (!editStatus && !editPriority)}>
                {updateTicket.isPending ? "Saving..." : "Update"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Comments ({ticket.comments?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ticket.comments?.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No comments yet. Be the first to add one.</p>
          )}
          {ticket.comments?.map(c => (
            <div key={c.id} className={`p-3 rounded-md border text-sm ${c.isInternal ? "border-amber-200 bg-amber-50" : "border-border bg-muted/30"}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.authorName ?? "Unknown"}</span>
                  {c.isInternal && (
                    <Badge className="text-xs bg-amber-100 text-amber-800">
                      <Lock className="w-3 h-3 mr-1" />
                      Internal
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatDt(c.createdAt)}</span>
              </div>
              <p className="text-muted-foreground whitespace-pre-wrap">{c.message}</p>
              {c.attachments && c.attachments.length > 0 && (
                <div className="mt-2">
                  <AttachmentList
                    attachments={c.attachments}
                    onDelete={handleDeleteAttachment}
                    currentUserId={hrmsUser?.id ?? null}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Add comment form */}
          <form onSubmit={handleComment} className="space-y-3 pt-2 border-t">
            <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Add a comment..." required />
            <AttachmentUploader
              value={commentAttachments}
              onChange={setCommentAttachments}
              disabled={addComment.isPending}
              label="Attach files to this comment"
            />
            {isManager && (
              <div className="flex items-center gap-2">
                <Switch id="internal" checked={isInternal} onCheckedChange={setIsInternal} />
                <Label htmlFor="internal" className="text-sm">Internal note (only visible to HR/HOD)</Label>
              </div>
            )}
            <Button type="submit" size="sm" disabled={addComment.isPending || !comment.trim()}>
              {addComment.isPending ? "Adding..." : "Add Comment"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
