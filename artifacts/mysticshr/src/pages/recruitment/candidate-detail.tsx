import { useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetCandidate,
  useListCandidateInterviews,
  useScheduleInterview,
  useUpdateInterview,
  useGetInterviewFeedback,
  useSubmitInterviewFeedback,
  useListOffers,
  useCreateOffer,
  useIssueOffer,
  useAcceptOffer,
  useRejectOffer,
  useMoveCandidateStage,
  getListCandidateInterviewsQueryKey,
  getGetCandidateQueryKey,
  getListOffersQueryKey,
  getGetInterviewFeedbackQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, CheckCircle2, XCircle, Send } from "lucide-react";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";

const STAGE_COLORS: Record<string, string> = {
  Applied: "bg-slate-100 text-slate-700",
  Shortlisted: "bg-blue-100 text-blue-800",
  "Interview Scheduled": "bg-indigo-100 text-indigo-800",
  "Interview Completed": "bg-purple-100 text-purple-800",
  "Offer Issued": "bg-amber-100 text-amber-800",
  "Offer Accepted": "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  "On Hold": "bg-orange-100 text-orange-800",
};

const OFFER_STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Issued: "bg-blue-100 text-blue-800",
  Accepted: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-orange-100 text-orange-800",
  Expired: "bg-yellow-100 text-yellow-800",
};

const STAGES = ["Applied", "Shortlisted", "Interview Scheduled", "Interview Completed", "Offer Issued", "Offer Accepted", "Rejected", "On Hold"];

function ScheduleInterviewDialog({ candidateId }: { candidateId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [roundName, setRoundName] = useState("Technical Round");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("60");
  const [mode, setMode] = useState("Video");
  const [meetingLink, setMeetingLink] = useState("");

  const schedule = useScheduleInterview({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCandidateInterviewsQueryKey(candidateId) });
        qc.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) });
        setOpen(false);
        setRoundName("Technical Round"); setScheduledAt(""); setDuration("60");
        setMode("Video"); setMeetingLink("");
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" />Schedule Round</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule Interview Round</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Round Name *</Label><Input value={roundName} onChange={(e) => setRoundName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Scheduled At *</Label><Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Duration (min)</Label><Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Video">Video</SelectItem>
                  <SelectItem value="In-Person">In-Person</SelectItem>
                  <SelectItem value="Phone">Phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Meeting Link / Location</Label><Input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!roundName || !scheduledAt || schedule.isPending}
            onClick={() =>
              schedule.mutate({
                candidateId,
                data: {
                  roundName,
                  scheduledAt: new Date(scheduledAt).toISOString(),
                  durationMinutes: parseInt(duration, 10),
                  mode,
                  meetingLink: mode === "Video" ? meetingLink || null : null,
                  location: mode === "In-Person" ? meetingLink || null : null,
                },
              })
            }
          >
            {schedule.isPending ? "Scheduling..." : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackDialog({ interviewId, candidateId }: { interviewId: number; candidateId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tech, setTech] = useState("7");
  const [comm, setComm] = useState("7");
  const [problem, setProblem] = useState("7");
  const [culture, setCulture] = useState("7");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [comments, setComments] = useState("");
  const [recommendation, setRecommendation] = useState("Hire");

  const submit = useSubmitInterviewFeedback({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetInterviewFeedbackQueryKey(interviewId) });
        qc.invalidateQueries({ queryKey: getListCandidateInterviewsQueryKey(candidateId) });
        setOpen(false);
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Submit Feedback</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Interview Feedback</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Technical (1-10)</Label><Input type="number" min={1} max={10} value={tech} onChange={(e) => setTech(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Communication (1-10)</Label><Input type="number" min={1} max={10} value={comm} onChange={(e) => setComm(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Problem Solving (1-10)</Label><Input type="number" min={1} max={10} value={problem} onChange={(e) => setProblem(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Culture Fit (1-10)</Label><Input type="number" min={1} max={10} value={culture} onChange={(e) => setCulture(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Strengths</Label><Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} /></div>
          <div className="space-y-1.5"><Label>Areas of Improvement</Label><Textarea value={weaknesses} onChange={(e) => setWeaknesses(e.target.value)} rows={2} /></div>
          <div className="space-y-1.5"><Label>Comments</Label><Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} /></div>
          <div className="space-y-1.5">
            <Label>Recommendation</Label>
            <Select value={recommendation} onValueChange={setRecommendation}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Strong Hire">Strong Hire</SelectItem>
                <SelectItem value="Hire">Hire</SelectItem>
                <SelectItem value="No Hire">No Hire</SelectItem>
                <SelectItem value="Strong No Hire">Strong No Hire</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={submit.isPending}
            onClick={() =>
              submit.mutate({
                id: interviewId,
                data: {
                  technicalScore: parseInt(tech, 10),
                  communicationScore: parseInt(comm, 10),
                  problemSolvingScore: parseInt(problem, 10),
                  cultureFitScore: parseInt(culture, 10),
                  strengths: strengths || null,
                  weaknesses: weaknesses || null,
                  comments: comments || null,
                  recommendation,
                },
              })
            }
          >
            {submit.isPending ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InterviewItem({ interview, candidateId }: { interview: any; candidateId: number }) {
  const qc = useQueryClient();
  const { data: feedback } = useGetInterviewFeedback(interview.id);
  const update = useUpdateInterview({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCandidateInterviewsQueryKey(candidateId) });
        qc.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) });
      },
    },
  });

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">Round {interview.roundNumber}: {interview.roundName}</span>
            <Badge variant="outline">{interview.status}</Badge>
            <Badge variant="secondary">{interview.mode}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {new Date(interview.scheduledAt).toLocaleString()} • {interview.durationMinutes} min
            {interview.interviewerName && ` • Interviewer: ${interview.interviewerName}`}
          </div>
          {(interview.meetingLink || interview.location) && (
            <div className="text-xs text-muted-foreground mt-1">📎 {interview.meetingLink || interview.location}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {interview.status === "Scheduled" && (
            <Button size="sm" variant="outline" onClick={() => update.mutate({ id: interview.id, data: { status: "Completed" } })}>
              Mark Completed
            </Button>
          )}
          <FeedbackDialog interviewId={interview.id} candidateId={candidateId} />
        </div>
      </div>
      {feedback && feedback.length > 0 && (
        <div className="mt-3 pt-3 border-t space-y-2">
          {feedback.map((f) => (
            <div key={f.id} className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{f.interviewerName ?? "Interviewer"}</span>
                <Badge variant="outline">{f.recommendation ?? "—"}</Badge>
                <span className="text-muted-foreground">Overall: {f.overallScore}/10</span>
              </div>
              <div className="text-muted-foreground">
                Tech: {f.technicalScore}/10 • Comm: {f.communicationScore}/10 • Problem: {f.problemSolvingScore}/10 • Culture: {f.cultureFitScore}/10
              </div>
              {f.comments && <div className="text-muted-foreground italic">{f.comments}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateOfferDialog({ candidateId, candidateName }: { candidateId: number; candidateName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [ctc, setCtc] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const create = useCreateOffer({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOffersQueryKey() });
        setOpen(false);
        setJobTitle(""); setCtc(""); setJoiningDate(""); setExpiryDate("");
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" />Create Offer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Offer for {candidateName}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Job Title *</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>CTC (Annual) *</Label><Input value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 1200000" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Joining Date *</Label><Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Expiry Date</Label><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!jobTitle || !ctc || !joiningDate || create.isPending}
            onClick={() =>
              create.mutate({
                candidateId,
                data: { jobTitle, ctc, joiningDate, expiryDate: expiryDate || null },
              })
            }
          >
            {create.isPending ? "Creating..." : "Create Draft Offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CandidateDetailPage() {
  const [, params] = useRoute<{ id: string }>("/recruitment/candidates/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const qc = useQueryClient();
  const { data: c, isLoading } = useGetCandidate(id);
  const { data: interviews } = useListCandidateInterviews(id);
  const { data: offers } = useListOffers({ candidateId: id });
  const { role } = useCurrentHrmsUser();
  const canEdit = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const moveStage = useMoveCandidateStage({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCandidateQueryKey(id) }) },
  });
  const issueOffer = useIssueOffer({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOffersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCandidateQueryKey(id) });
      },
    },
  });
  const acceptOffer = useAcceptOffer({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOffersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCandidateQueryKey(id) });
      },
    },
  });
  const rejectOffer = useRejectOffer({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListOffersQueryKey() }) },
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  if (!c) return <div className="text-center py-12 text-muted-foreground">Candidate not found</div>;

  return (
    <div className="space-y-6">
      <Link href="/recruitment" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to Recruitment
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>{c.firstName} {c.lastName}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {c.email}{c.phone ? ` • ${c.phone}` : ""}
              </p>
              {c.requisitionTitle && (
                <Link href={`/recruitment/requisitions/${c.requisitionId}`} className="text-sm text-primary hover:underline mt-1 inline-block">
                  📋 {c.requisitionTitle}
                </Link>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className={STAGE_COLORS[c.stage] ?? ""}>{c.stage}</Badge>
              {canEdit && (
                <Select
                  value={c.stage}
                  onValueChange={(newStage) => {
                    if (newStage === c.stage) return;
                    const reason = newStage === "Rejected" ? prompt("Rejection reason:") : null;
                    if (newStage === "Rejected" && !reason) return;
                    moveStage.mutate({ id, data: { stage: newStage, rejectionReason: reason ?? null } });
                  }}
                >
                  <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div><div className="text-muted-foreground text-xs">Source</div><div className="font-medium">{c.source}</div></div>
          <div><div className="text-muted-foreground text-xs">Current Company</div><div className="font-medium">{c.currentCompany ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Current Designation</div><div className="font-medium">{c.currentDesignation ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Experience</div><div className="font-medium">{c.totalExperience ?? "—"} yrs</div></div>
          <div><div className="text-muted-foreground text-xs">Current CTC</div><div className="font-medium">{c.currentCtc ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Expected CTC</div><div className="font-medium">{c.expectedCtc ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Notice Period</div><div className="font-medium">{c.noticePeriod ?? "—"}</div></div>
          {c.resumeUrl && <div><div className="text-muted-foreground text-xs">Resume</div><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">View Resume</a></div>}
          {c.rejectionReason && <div className="col-span-full"><div className="text-muted-foreground text-xs">Rejection Reason</div><div className="text-sm text-red-700">{c.rejectionReason}</div></div>}
          {c.notes && <div className="col-span-full"><div className="text-muted-foreground text-xs">Notes</div><div className="text-sm">{c.notes}</div></div>}
        </CardContent>
      </Card>

      <Tabs defaultValue="interviews">
        <TabsList>
          <TabsTrigger value="interviews">Interviews ({interviews?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="offers">Offers ({offers?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="interviews" className="mt-4 space-y-3">
          <div className="flex justify-end">{canEdit && <ScheduleInterviewDialog candidateId={id} />}</div>
          {!interviews?.length ? (
            <div className="text-center text-muted-foreground py-8">No interviews scheduled</div>
          ) : (
            interviews.map((iv) => <InterviewItem key={iv.id} interview={iv} candidateId={id} />)
          )}
        </TabsContent>

        <TabsContent value="offers" className="mt-4 space-y-3">
          <div className="flex justify-end">{canEdit && <CreateOfferDialog candidateId={id} candidateName={`${c.firstName} ${c.lastName}`} />}</div>
          {!offers?.length ? (
            <div className="text-center text-muted-foreground py-8">No offers issued</div>
          ) : (
            offers.map((o) => (
              <Card key={o.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{o.jobTitle}</span>
                        <Badge variant="outline" className="font-mono text-xs">{o.offerCode}</Badge>
                        <Badge className={OFFER_STATUS_COLORS[o.status] ?? ""}>{o.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        CTC: {o.ctc} • Joining: {o.joiningDate}
                        {o.expiryDate && ` • Expires: ${o.expiryDate}`}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        {o.status === "Draft" && (
                          <Button size="sm" onClick={() => issueOffer.mutate({ id: o.id })}>
                            <Send className="w-4 h-4 mr-1" />Issue
                          </Button>
                        )}
                        {o.status === "Issued" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => acceptOffer.mutate({ id: o.id })}>
                              <CheckCircle2 className="w-4 h-4 mr-1" />Mark Accepted
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => {
                              const notes = prompt("Rejection notes (optional):");
                              rejectOffer.mutate({ id: o.id, data: { notes: notes || null } });
                            }}>
                              <XCircle className="w-4 h-4 mr-1" />Mark Rejected
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {o.letterContent && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">View Offer Letter</summary>
                      <pre className="text-xs mt-2 p-3 bg-muted rounded whitespace-pre-wrap font-sans">{o.letterContent}</pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
