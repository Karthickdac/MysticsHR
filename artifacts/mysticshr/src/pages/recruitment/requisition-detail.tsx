import { useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetRequisition,
  useListCandidates,
  useCreateCandidate,
  getListCandidatesQueryKey,
  getGetRequisitionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus } from "lucide-react";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";

const REQ_STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  "Pending Approval": "bg-yellow-100 text-yellow-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  "On Hold": "bg-orange-100 text-orange-800",
  Closed: "bg-blue-100 text-blue-800",
};

function AddCandidateDialog({ requisitionId }: { requisitionId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [currentDesignation, setCurrentDesignation] = useState("");
  const [totalExperience, setTotalExperience] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [source, setSource] = useState("Other");
  const [resumeUrl, setResumeUrl] = useState("");

  const create = useCreateCandidate({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetRequisitionQueryKey(requisitionId) });
        setOpen(false);
        setFirstName(""); setLastName(""); setEmail(""); setPhone("");
        setCurrentCompany(""); setCurrentDesignation(""); setTotalExperience("");
        setExpectedCtc(""); setResumeUrl("");
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />Add Candidate</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>First Name *</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Last Name *</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                  <SelectItem value="Naukri">Naukri</SelectItem>
                  <SelectItem value="Indeed">Indeed</SelectItem>
                  <SelectItem value="Referral">Referral</SelectItem>
                  <SelectItem value="Walk-In">Walk-In</SelectItem>
                  <SelectItem value="Campus">Campus</SelectItem>
                  <SelectItem value="Agency">Agency</SelectItem>
                  <SelectItem value="Company Website">Company Website</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Current Company</Label><Input value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Current Designation</Label><Input value={currentDesignation} onChange={(e) => setCurrentDesignation(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Total Experience (years)</Label><Input type="number" min={0} value={totalExperience} onChange={(e) => setTotalExperience(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Expected CTC</Label><Input value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Resume URL</Label><Input value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} placeholder="https://..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!firstName || !lastName || !email || create.isPending}
            onClick={() =>
              create.mutate({
                data: {
                  requisitionId,
                  firstName, lastName, email,
                  phone: phone || null,
                  currentCompany: currentCompany || null,
                  currentDesignation: currentDesignation || null,
                  totalExperience: totalExperience ? parseInt(totalExperience, 10) : null,
                  expectedCtc: expectedCtc || null,
                  source,
                  resumeUrl: resumeUrl || null,
                },
              })
            }
          >
            {create.isPending ? "Adding..." : "Add Candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RequisitionDetailPage() {
  const [, params] = useRoute<{ id: string }>("/recruitment/requisitions/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const { data: req, isLoading } = useGetRequisition(id);
  const { data: candidates } = useListCandidates({ requisitionId: id });
  const { role } = useCurrentHrmsUser();
  const canAdd = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  if (!req) return <div className="text-center py-12 text-muted-foreground">Requisition not found</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/recruitment" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Recruitment
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle>{req.title}</CardTitle>
                <Badge variant="outline" className="font-mono text-xs">{req.requisitionCode}</Badge>
                <Badge className={REQ_STATUS_COLORS[req.status] ?? ""}>{req.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{req.departmentName ?? "—"} • {req.location ?? "Remote"}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground text-xs">Positions</div><div className="font-medium">{req.numberOfPositions}</div></div>
          <div><div className="text-muted-foreground text-xs">Employment Type</div><div className="font-medium">{req.employmentType}</div></div>
          <div><div className="text-muted-foreground text-xs">Experience</div><div className="font-medium">{req.experienceMin ?? 0}–{req.experienceMax ?? "—"} yrs</div></div>
          <div><div className="text-muted-foreground text-xs">Budget</div><div className="font-medium">{req.budgetMin || "—"} – {req.budgetMax || "—"}</div></div>
          {req.jobDescription && <div className="col-span-full"><div className="text-muted-foreground text-xs mb-1">Job Description</div><div className="whitespace-pre-wrap text-sm">{req.jobDescription}</div></div>}
          {req.requiredSkills && <div className="col-span-full"><div className="text-muted-foreground text-xs mb-1">Required Skills</div><div className="text-sm">{req.requiredSkills}</div></div>}
          {req.approvalNotes && <div className="col-span-full"><div className="text-muted-foreground text-xs mb-1">Approval Notes</div><div className="text-sm">{req.approvalNotes}</div></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Candidates ({candidates?.length ?? 0})</CardTitle>
          {canAdd && <AddCandidateDialog requisitionId={id} />}
        </CardHeader>
        <CardContent>
          {!candidates?.length ? (
            <div className="text-center text-muted-foreground py-8">No candidates yet</div>
          ) : (
            <div className="space-y-2">
              {candidates.map((c) => (
                <Link key={c.id} href={`/recruitment/candidates/${c.id}`}>
                  <div className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 cursor-pointer">
                    <div>
                      <div className="font-medium">{c.firstName} {c.lastName}</div>
                      <div className="text-xs text-muted-foreground">{c.email} • {c.currentDesignation ?? "—"}</div>
                    </div>
                    <Badge variant="outline">{c.stage}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
