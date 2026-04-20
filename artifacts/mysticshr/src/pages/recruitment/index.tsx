import { useState } from "react";
import { Link } from "wouter";
import {
  useListRequisitions,
  useListCandidates,
  useCreateRequisition,
  useApproveRequisition,
  useRejectRequisition,
  useMoveCandidateStage,
  getListRequisitionsQueryKey,
  getListCandidatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, CheckCircle2, XCircle, Briefcase, Users } from "lucide-react";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";

const REQ_STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  "Pending Approval": "bg-yellow-100 text-yellow-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  "On Hold": "bg-orange-100 text-orange-800",
  Closed: "bg-blue-100 text-blue-800",
};

const STAGES = [
  "Applied",
  "Shortlisted",
  "Interview Scheduled",
  "Interview Completed",
  "Offer Issued",
  "Offer Accepted",
  "Rejected",
  "On Hold",
];

const STAGE_COLORS: Record<string, string> = {
  Applied: "bg-slate-100 text-slate-700 border-slate-200",
  Shortlisted: "bg-blue-100 text-blue-800 border-blue-200",
  "Interview Scheduled": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Interview Completed": "bg-purple-100 text-purple-800 border-purple-200",
  "Offer Issued": "bg-amber-100 text-amber-800 border-amber-200",
  "Offer Accepted": "bg-green-100 text-green-800 border-green-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
  "On Hold": "bg-orange-100 text-orange-800 border-orange-200",
};

function NewRequisitionDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [positions, setPositions] = useState("1");
  const [employmentType, setEmploymentType] = useState("Permanent");
  const [location, setLocation] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [requiredSkills, setRequiredSkills] = useState("");

  const create = useCreateRequisition({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRequisitionsQueryKey() });
        setOpen(false);
        setTitle("");
        setPositions("1");
        setLocation("");
        setJobDescription("");
        setRequiredSkills("");
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New Requisition
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise New Job Requisition</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Job Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior React Developer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Number of Positions *</Label>
              <Input type="number" min={1} value={positions} onChange={(e) => setPositions(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Employment Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Permanent">Permanent</SelectItem>
                  <SelectItem value="Contract">Contract</SelectItem>
                  <SelectItem value="Probation">Probation</SelectItem>
                  <SelectItem value="Intern">Intern</SelectItem>
                  <SelectItem value="Part-Time">Part-Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bangalore" />
          </div>
          <div className="space-y-2">
            <Label>Job Description</Label>
            <Textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Required Skills</Label>
            <Input value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} placeholder="React, TypeScript, Node.js" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!title || !positions || create.isPending}
            onClick={() =>
              create.mutate({
                data: {
                  title,
                  numberOfPositions: parseInt(positions, 10),
                  employmentType,
                  location: location || null,
                  jobDescription: jobDescription || null,
                  requiredSkills: requiredSkills || null,
                },
              })
            }
          >
            {create.isPending ? "Creating..." : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequisitionsTab() {
  const { role } = useCurrentHrmsUser();
  const canApprove = hasRole(role, ["super_admin", "hr_manager", "hod"]);
  const canCreate = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const qc = useQueryClient();
  const { data: reqs, isLoading } = useListRequisitions({ status: statusFilter || undefined });

  const approve = useApproveRequisition({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListRequisitionsQueryKey() }) },
  });
  const reject = useRejectRequisition({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListRequisitionsQueryKey() }) },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={statusFilter || "_all"} onValueChange={(v) => setStatusFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Statuses</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Pending Approval">Pending Approval</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
            <SelectItem value="On Hold">On Hold</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && <NewRequisitionDialog />}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : !reqs?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No requisitions found</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {reqs.map((r) => (
            <Card key={r.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/recruitment/requisitions/${r.id}`} className="font-semibold text-base hover:text-primary">
                        {r.title}
                      </Link>
                      <Badge variant="outline" className="text-xs font-mono">{r.requisitionCode}</Badge>
                      <Badge className={REQ_STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
                      {r.departmentName && <span>{r.departmentName}</span>}
                      {r.location && <span>📍 {r.location}</span>}
                      <span>{r.numberOfPositions} position{r.numberOfPositions > 1 ? "s" : ""}</span>
                      <span>{r.candidateCount} candidate{r.candidateCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {canApprove && r.status === "Pending Approval" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approve.mutate({ id: r.id, data: {} })}
                        disabled={approve.isPending}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const notes = prompt("Reason for rejection:");
                          if (notes) reject.mutate({ id: r.id, data: { notes } });
                        }}
                        disabled={reject.isPending}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineTab() {
  const qc = useQueryClient();
  const { data: candidates, isLoading } = useListCandidates({});
  const { role } = useCurrentHrmsUser();
  const canMove = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);
  const moveStage = useMoveCandidateStage({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListCandidatesQueryKey() }) },
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  const grouped = STAGES.reduce<Record<string, typeof candidates>>((acc, s) => {
    acc[s] = (candidates ?? []).filter((c) => c.stage === s);
    return acc;
  }, {} as Record<string, typeof candidates>);

  return (
    <div className="overflow-x-auto pb-3">
      <div className="flex gap-3 min-w-max">
        {STAGES.map((stage) => {
          const items = grouped[stage] ?? [];
          return (
            <div key={stage} className="w-72 flex-shrink-0">
              <div className={`px-3 py-2 rounded-t-md border ${STAGE_COLORS[stage]} font-medium text-sm flex items-center justify-between`}>
                <span>{stage}</span>
                <Badge variant="secondary" className="text-xs">{items.length}</Badge>
              </div>
              <div className="bg-muted/30 border border-t-0 rounded-b-md p-2 min-h-[400px] space-y-2">
                {items.map((c) => (
                  <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-3">
                      <Link href={`/recruitment/candidates/${c.id}`} className="block">
                        <div className="font-medium text-sm">{c.firstName} {c.lastName}</div>
                        <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                        {c.requisitionTitle && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">📋 {c.requisitionTitle}</div>
                        )}
                        {c.currentDesignation && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">{c.currentDesignation}</div>
                        )}
                      </Link>
                      {canMove && (
                        <Select
                          value={stage}
                          onValueChange={(newStage) => {
                            if (newStage === stage) return;
                            const reason = newStage === "Rejected" ? prompt("Rejection reason:") : null;
                            if (newStage === "Rejected" && !reason) return;
                            moveStage.mutate({
                              id: c.id,
                              data: { stage: newStage, rejectionReason: reason ?? null },
                            });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs mt-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {!items.length && (
                  <div className="text-center text-xs text-muted-foreground py-8">No candidates</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RecruitmentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recruitment</h1>
        <p className="text-muted-foreground mt-1">Manage job requisitions and the candidate pipeline</p>
      </div>
      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions"><Briefcase className="w-4 h-4 mr-2" />Requisitions</TabsTrigger>
          <TabsTrigger value="pipeline"><Users className="w-4 h-4 mr-2" />Candidate Pipeline</TabsTrigger>
        </TabsList>
        <TabsContent value="requisitions" className="mt-4"><RequisitionsTab /></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineTab /></TabsContent>
      </Tabs>
    </div>
  );
}
