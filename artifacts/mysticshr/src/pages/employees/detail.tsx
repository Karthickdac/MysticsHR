import { useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import {
  useGetEmployee,
  useGetEmployeesIdProfile,
  usePutEmployeesIdProfile,
  useUpdateEmployee,
  useUpdateMyTimezone,
  getGetEmployeeQueryKey,
  useGetEmployeesIdEducation,
  usePostEmployeesIdEducation,
  usePatchEmployeeEducationId,
  useDeleteEmployeeEducationId,
  useGetEmployeesIdWorkExperience,
  usePostEmployeesIdWorkExperience,
  usePatchEmployeeWorkExperienceId,
  useDeleteEmployeeWorkExperienceId,
  useGetEmployeesIdEmpDocuments,
  usePostEmployeesIdEmpDocuments,
  usePatchEmpDocumentsId,
  useDeleteEmpDocumentsId,
  useGetEmployeesIdHistory,
  useGetEmployeesIdOnboardingChecklist,
  usePostEmployeesIdOnboardingChecklist,
  getGetEmployeesIdProfileQueryKey,
  getGetEmployeesIdEducationQueryKey,
  getGetEmployeesIdWorkExperienceQueryKey,
  getGetEmployeesIdEmpDocumentsQueryKey,
  getGetEmployeesIdHistoryQueryKey,
  getGetEmployeesIdOnboardingChecklistQueryKey,
} from "@workspace/api-client-react";
import type {
  EmployeeEducation,
  EmployeeWorkExperience,
  EmployeeDocument,
  OnboardingTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Plus, Pencil, Trash2,
  GraduationCap, Briefcase, FileText, History, ClipboardList, Download,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";
import { listTimezones } from "@/lib/timezones";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function TimezoneCombo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const zones = listTimezones();
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? zones.filter((z) => z.toLowerCase().includes(query.toLowerCase())).slice(0, 200)
    : zones.slice(0, 200);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
      <SelectContent>
        <div className="p-1 sticky top-0 bg-popover z-10">
          <Input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-8"
          />
        </div>
        {filtered.map((z) => (
          <SelectItem key={z} value={z}>{z}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
import PerformanceHistoryView from "@/components/PerformanceHistoryView";

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-800",
  "Pre-Joining": "bg-blue-100 text-blue-800",
  "Notice Period": "bg-yellow-100 text-yellow-800",
  "On Leave of Absence": "bg-purple-100 text-purple-800",
  "Suspended": "bg-red-100 text-red-800",
  "Separated": "bg-gray-100 text-gray-600",
};

const TASK_CATEGORY_COLORS: Record<string, string> = {
  HR: "bg-blue-100 text-blue-700",
  IT: "bg-purple-100 text-purple-700",
  Department: "bg-amber-100 text-amber-700",
  Employee: "bg-green-100 text-green-700",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-3 border-b border-border last:border-0">
      <dt className="text-sm font-medium text-muted-foreground w-44 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-foreground mt-1 sm:mt-0">{value ?? <span className="text-muted-foreground italic">—</span>}</dd>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {action}
    </div>
  );
}

function EducationSection({ employeeId, canEdit }: { employeeId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: records = [] } = useGetEmployeesIdEducation(employeeId);
  const create = usePostEmployeesIdEducation({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdEducationQueryKey(employeeId) }) } });
  const patch = usePatchEmployeeEducationId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdEducationQueryKey(employeeId) }) } });
  const del = useDeleteEmployeeEducationId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdEducationQueryKey(employeeId) }) } });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeEducation | null>(null);
  const [degree, setDegree] = useState("");
  const [institution, setInstitution] = useState("");
  const [field, setField] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [grade, setGrade] = useState("");

  function openCreate() { setEditing(null); setDegree(""); setInstitution(""); setField(""); setStartYear(""); setEndYear(""); setGrade(""); setOpen(true); }
  function openEdit(r: EmployeeEducation) { setEditing(r); setDegree(r.degree); setInstitution(r.institution); setField(r.fieldOfStudy ?? ""); setStartYear(String(r.startYear ?? "")); setEndYear(String(r.endYear ?? "")); setGrade(r.grade ?? ""); setOpen(true); }
  function save() {
    const payload = { degree, institution, fieldOfStudy: field || null, startYear: startYear ? parseInt(startYear, 10) : null, endYear: endYear ? parseInt(endYear, 10) : null, grade: grade || null };
    if (editing) patch.mutate({ id: editing.id, data: payload }, { onSuccess: () => setOpen(false) });
    else create.mutate({ id: employeeId, data: payload }, { onSuccess: () => setOpen(false) });
  }

  return (
    <div>
      <SectionHeader title="Education" action={canEdit && <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>} />
      {records.length === 0 && <p className="text-sm text-muted-foreground italic">No education records.</p>}
      <div className="space-y-3">
        {records.map((r) => (
          <div key={r.id} className="flex items-start justify-between p-3 rounded-lg border border-border">
            <div>
              <p className="font-medium text-sm">{r.degree}{r.fieldOfStudy ? ` in ${r.fieldOfStudy}` : ""}</p>
              <p className="text-sm text-muted-foreground">{r.institution}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.startYear ?? "?"} — {r.endYear ?? "Present"}{r.grade ? ` · ${r.grade}` : ""}</p>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ id: r.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Education" : "Add Education"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Degree *</Label><Input value={degree} onChange={(e) => setDegree(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Field of Study</Label><Input value={field} onChange={(e) => setField(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Institution *</Label><Input value={institution} onChange={(e) => setInstitution(e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Start Year</Label><Input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>End Year</Label><Input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Grade / %</Label><Input value={grade} onChange={(e) => setGrade(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!degree || !institution || create.isPending || patch.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkExpSection({ employeeId, canEdit }: { employeeId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: records = [] } = useGetEmployeesIdWorkExperience(employeeId);
  const create = usePostEmployeesIdWorkExperience({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdWorkExperienceQueryKey(employeeId) }) } });
  const patch = usePatchEmployeeWorkExperienceId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdWorkExperienceQueryKey(employeeId) }) } });
  const del = useDeleteEmployeeWorkExperienceId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdWorkExperienceQueryKey(employeeId) }) } });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeWorkExperience | null>(null);
  const [company, setCompany] = useState("");
  const [designation, setDesignation] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [ctcDrawn, setCtcDrawn] = useState("");

  function openCreate() { setEditing(null); setCompany(""); setDesignation(""); setLocation(""); setStartDate(""); setEndDate(""); setDescription(""); setCtcDrawn(""); setOpen(true); }
  function openEdit(r: EmployeeWorkExperience) { setEditing(r); setCompany(r.company); setDesignation(r.designation); setLocation(r.location ?? ""); setStartDate(r.startDate ?? ""); setEndDate(r.endDate ?? ""); setDescription(r.description ?? ""); setCtcDrawn(r.ctcDrawn ?? ""); setOpen(true); }
  function save() {
    const payload = { company, designation, location: location || null, startDate: startDate || null, endDate: endDate || null, description: description || null, ctcDrawn: ctcDrawn || null };
    if (editing) patch.mutate({ id: editing.id, data: payload }, { onSuccess: () => setOpen(false) });
    else create.mutate({ id: employeeId, data: payload }, { onSuccess: () => setOpen(false) });
  }

  return (
    <div>
      <SectionHeader title="Work Experience" action={canEdit && <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>} />
      {records.length === 0 && <p className="text-sm text-muted-foreground italic">No work experience records.</p>}
      <div className="space-y-3">
        {records.map((r) => (
          <div key={r.id} className="flex items-start justify-between p-3 rounded-lg border border-border">
            <div>
              <p className="font-medium text-sm">{r.designation}</p>
              <p className="text-sm text-muted-foreground">{r.company}{r.location ? ` · ${r.location}` : ""}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.startDate ?? "?"} — {r.endDate ?? "Present"}{r.ctcDrawn ? ` · ₹${r.ctcDrawn}` : ""}</p>
              {r.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ id: r.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Work Experience" : "Add Work Experience"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Company *</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Designation *</Label><Input value={designation} onChange={(e) => setDesignation(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>CTC Drawn</Label><Input value={ctcDrawn} onChange={(e) => setCtcDrawn(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!company || !designation || create.isPending || patch.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentsSection({ employeeId, canEdit }: { employeeId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: docs = [] } = useGetEmployeesIdEmpDocuments(employeeId);
  const create = usePostEmployeesIdEmpDocuments({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdEmpDocumentsQueryKey(employeeId) }) } });
  const del = useDeleteEmpDocumentsId({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdEmpDocumentsQueryKey(employeeId) }) } });

  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState("");
  const [docName, setDocName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [alertDays, setAlertDays] = useState("30");
  const [notes, setNotes] = useState("");

  function save() {
    create.mutate({
      id: employeeId,
      data: { documentType: docType, documentName: docName, fileUrl: fileUrl || null, issueDate: issueDate || null, expiryDate: expiryDate || null, alertDays: parseInt(alertDays, 10) || 30, notes: notes || null },
    }, { onSuccess: () => { setOpen(false); setDocType(""); setDocName(""); setFileUrl(""); setIssueDate(""); setExpiryDate(""); setNotes(""); } });
  }

  return (
    <div>
      <SectionHeader title="Document Repository" action={canEdit && <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Upload</Button>} />
      {docs.length === 0 && <p className="text-sm text-muted-foreground italic">No documents uploaded.</p>}
      <div className="space-y-2">
        {(docs as EmployeeDocument[]).map((d) => (
          <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">{d.documentName}</p>
                <p className="text-xs text-muted-foreground">{d.documentType}{d.expiryDate ? ` · Expires ${d.expiryDate}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{d.status}</Badge>
              {d.fileUrl && (
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="w-3.5 h-3.5" /></Button>
                </a>
              )}
              {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ id: d.id })}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </div>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Document Type *</Label><Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. PAN Card" /></div>
              <div className="space-y-1.5"><Label>Document Name *</Label><Input value={docName} onChange={(e) => setDocName(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>File URL</Label><Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Issue Date</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Expiry Date</Label><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Alert Days Before Expiry</Label><Input type="number" value={alertDays} onChange={(e) => setAlertDays(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!docType || !docName || create.isPending}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistorySection({ employeeId }: { employeeId: number }) {
  const { data: history = [] } = useGetEmployeesIdHistory(employeeId);
  return (
    <div>
      <SectionHeader title="Change History" />
      {history.length === 0 && <p className="text-sm text-muted-foreground italic">No history records.</p>}
      <div className="space-y-2">
        {history.map((h) => (
          <div key={h.id} className="p-3 rounded-lg border border-border text-sm">
            <div className="flex justify-between">
              <span className="font-medium">{h.module} · {h.fieldName}</span>
              <span className="text-xs text-muted-foreground">{format(new Date(h.changedAt), "dd MMM yyyy HH:mm")}</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              <span className="line-through mr-2">{h.oldValue ?? "—"}</span>
              <span className="text-foreground">→ {h.newValue ?? "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingTab({ employeeId, canEdit }: { employeeId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: detail, error } = useGetEmployeesIdOnboardingChecklist(employeeId);
  const create = usePostEmployeesIdOnboardingChecklist({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeesIdOnboardingChecklistQueryKey(employeeId) }) }
  });

  const [joiningDate, setJoiningDate] = useState("");

  if (error && (error as { response?: { status?: number } }).response?.status === 404) {
    return (
      <div>
        <SectionHeader title="Onboarding Checklist" />
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm mb-4">No onboarding checklist created yet.</p>
          {canEdit && (
            <div className="flex flex-col items-center gap-3 max-w-xs mx-auto">
              <Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} placeholder="Joining Date" />
              <Button onClick={() => create.mutate({ id: employeeId, data: { joiningDate: joiningDate || undefined } })} disabled={create.isPending}>
                Create Checklist with Default Tasks
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!detail) return <div className="flex justify-center py-10"><div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" /></div>;

  const { checklist, tasks } = detail;
  const categories = ["HR", "IT", "Department", "Employee"] as const;

  const canDownloadIdCard = checklist.completionPercentage === 100;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Onboarding Checklist</h3>
        {canDownloadIdCard && (
          <a href={`/api/employees/${employeeId}/id-card`} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="gap-2"><Download className="w-3.5 h-3.5" />Download ID Card</Button>
          </a>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">{checklist.completionPercentage}%</span>
        </div>
        <Progress value={checklist.completionPercentage} className="h-2" />
        <div className="flex gap-2">
          <Badge variant={checklist.status === "Completed" ? "default" : "secondary"}>{checklist.status}</Badge>
          {checklist.joiningDate && <span className="text-xs text-muted-foreground mt-0.5">Joining: {checklist.joiningDate}</span>}
        </div>
      </div>
      {categories.map((cat) => {
        const catTasks = (tasks as OnboardingTask[]).filter((t) => t.category === cat);
        if (catTasks.length === 0) return null;
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TASK_CATEGORY_COLORS[cat]}`}>{cat}</span>
            </div>
            <div className="space-y-1.5">
              {catTasks.map((t) => (
                <div key={t.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${t.completedAt ? "border-green-200 bg-green-50" : "border-border"}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${t.completedAt ? "border-green-500 bg-green-500" : "border-muted-foreground"}`} />
                  <span className={`text-sm flex-1 ${t.completedAt ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
                  {t.completedAt && <span className="text-xs text-muted-foreground">{format(new Date(t.completedAt), "dd MMM")}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <Link href={`/onboarding/${checklist.id}`}>
        <Button variant="outline" size="sm" className="w-full">Manage Tasks →</Button>
      </Link>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const { role, hrmsUser } = useCurrentHrmsUser();
  const canEdit = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);
  const isSelf = hrmsUser?.employeeId === parseInt(id, 10);
  const canEditOwnTimezone = isSelf;
  const canViewPerformanceHistory = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]);
  const empId = parseInt(id, 10);

  const validTabs = [
    "personal", "statutory", "address", "employment", "education",
    "workexp", "documents", "history", "onboarding",
    ...(canViewPerformanceHistory ? ["performance"] : []),
  ];
  const tabFromUrl = new URLSearchParams(search).get("tab");
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "personal";
  const { data: emp, isLoading, error } = useGetEmployee(empId);
  const { data: profile } = useGetEmployeesIdProfile(empId);
  const upsertProfile = usePutEmployeesIdProfile();
  const updateEmp = useUpdateEmployee();
  const updateMyTz = useUpdateMyTimezone();
  const qc = useQueryClient();

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<Record<string, string>>({});

  function openProfileEdit() {
    setProfileForm({
      nationalId: profile?.nationalId ?? "",
      pan: profile?.pan ?? "",
      aadhaar: profile?.aadhaar ?? "",
      pfNumber: profile?.pfNumber ?? "",
      esiNumber: profile?.esiNumber ?? "",
      uan: profile?.uan ?? "",
      maritalStatus: profile?.maritalStatus ?? "",
      bloodGroup: profile?.bloodGroup ?? "",
      nationality: profile?.nationality ?? "",
      permanentAddress: profile?.permanentAddress ?? "",
      currentAddress: profile?.currentAddress ?? "",
      linkedinUrl: profile?.linkedinUrl ?? "",
      emergencyContactName: profile?.emergencyContactName ?? "",
      emergencyContactPhone: profile?.emergencyContactPhone ?? "",
      emergencyContactRelation: profile?.emergencyContactRelation ?? "",
      bankAccountName: profile?.bankAccountName ?? "",
      bankAccountNumber: profile?.bankAccountNumber ?? "",
      ifscCode: profile?.ifscCode ?? "",
      bankName: profile?.bankName ?? "",
      bankBranch: profile?.bankBranch ?? "",
      probationEndDate: profile?.probationEndDate ?? "",
      confirmationDate: profile?.confirmationDate ?? "",
      noticePeriodDays: String(profile?.noticePeriodDays ?? ""),
      workLocation: profile?.workLocation ?? "",
      timezone: emp?.timezone ?? "Asia/Kolkata",
    });
    setEditingProfile(true);
  }

  async function saveProfile() {
    const data: Record<string, string | number | null> = {};
    const tz = profileForm.timezone;
    for (const [k, v] of Object.entries(profileForm)) {
      if (k === "timezone") continue; // lives on employees, not employee_profiles
      if (k === "noticePeriodDays") data[k] = v ? parseInt(v, 10) : null;
      else data[k] = v || null;
    }
    try {
      await upsertProfile.mutateAsync({ id: empId, data });
      if (tz && tz !== emp?.timezone) {
        await updateEmp.mutateAsync({ id: empId, data: { timezone: tz } });
      }
      setEditingProfile(false);
      qc.invalidateQueries({ queryKey: getGetEmployeesIdProfileQueryKey(empId) });
      qc.invalidateQueries({ queryKey: getGetEmployeeQueryKey(empId) });
    } catch (e) {
      console.error("Save profile failed", e);
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (error || !emp) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Employee not found.</p>
        <Link href="/employees"><Button variant="outline" className="mt-4">Back to Employees</Button></Link>
      </div>
    );
  }

  const pf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setProfileForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/employees">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Employees
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <Avatar className="w-20 h-20 flex-shrink-0">
              <AvatarImage src={emp.avatarUrl ?? undefined} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {emp.firstName[0]}{emp.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">{emp.firstName} {emp.lastName}</h1>
              <p className="text-muted-foreground">{emp.designationTitle ?? "—"} · {emp.departmentName ?? "—"}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-sm font-mono text-muted-foreground border border-border rounded px-2 py-0.5">{emp.employeeId}</span>
                <Badge className={STATUS_COLORS[emp.status] ?? ""}>{emp.status}</Badge>
                <Badge variant="outline">{emp.employmentType}</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
            {emp.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{emp.email}</span>}
            {emp.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{emp.phone}</span>}
            {emp.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{emp.location}</span>}
            {emp.dateOfJoining && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Joined {format(new Date(emp.dateOfJoining), "dd MMM yyyy")}</span>}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={initialTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="statutory">Statutory & Bank</TabsTrigger>
          <TabsTrigger value="address">Address & Emergency</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="education"><GraduationCap className="w-3.5 h-3.5 mr-1" />Education</TabsTrigger>
          <TabsTrigger value="workexp"><Briefcase className="w-3.5 h-3.5 mr-1" />Work History</TabsTrigger>
          <TabsTrigger value="documents"><FileText className="w-3.5 h-3.5 mr-1" />Documents</TabsTrigger>
          <TabsTrigger value="history"><History className="w-3.5 h-3.5 mr-1" />History</TabsTrigger>
          <TabsTrigger value="onboarding"><ClipboardList className="w-3.5 h-3.5 mr-1" />Onboarding</TabsTrigger>
          {canViewPerformanceHistory && (
            <TabsTrigger value="performance"><TrendingUp className="w-3.5 h-3.5 mr-1" />Performance History</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="personal">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Personal Information</CardTitle>
              {canEdit && <Button size="sm" variant="outline" onClick={openProfileEdit}>Edit</Button>}
            </CardHeader>
            <CardContent>
              <dl>
                <InfoRow label="First Name" value={emp.firstName} />
                <InfoRow label="Last Name" value={emp.lastName} />
                <InfoRow label="Email" value={emp.email} />
                <InfoRow label="Phone" value={emp.phone} />
                <InfoRow label="Date of Birth" value={emp.dateOfBirth ? format(new Date(emp.dateOfBirth), "dd MMM yyyy") : null} />
                <InfoRow label="Gender" value={emp.gender} />
                <InfoRow label="Marital Status" value={profile?.maritalStatus} />
                <InfoRow label="Blood Group" value={profile?.bloodGroup} />
                <InfoRow label="Nationality" value={profile?.nationality} />
                <InfoRow label="LinkedIn" value={profile?.linkedinUrl} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statutory">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Statutory & Bank Details</CardTitle>
              {canEdit && <Button size="sm" variant="outline" onClick={openProfileEdit}>Edit</Button>}
            </CardHeader>
            <CardContent>
              <dl>
                <InfoRow label="PAN" value={profile?.pan} />
                <InfoRow label="Aadhaar" value={profile?.aadhaar} />
                <InfoRow label="National ID" value={profile?.nationalId} />
                <InfoRow label="PF Number" value={profile?.pfNumber} />
                <InfoRow label="ESI Number" value={profile?.esiNumber} />
                <InfoRow label="UAN" value={profile?.uan} />
                <InfoRow label="Bank Account Name" value={profile?.bankAccountName} />
                <InfoRow label="Account Number" value={profile?.bankAccountNumber} />
                <InfoRow label="IFSC Code" value={profile?.ifscCode} />
                <InfoRow label="Bank Name" value={profile?.bankName} />
                <InfoRow label="Bank Branch" value={profile?.bankBranch} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="address">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Address & Emergency Contact</CardTitle>
              {canEdit && <Button size="sm" variant="outline" onClick={openProfileEdit}>Edit</Button>}
            </CardHeader>
            <CardContent>
              <dl>
                <InfoRow label="Current Address" value={profile?.currentAddress} />
                <InfoRow label="Permanent Address" value={profile?.permanentAddress} />
                <InfoRow label="Emergency Contact" value={profile?.emergencyContactName} />
                <InfoRow label="Emergency Phone" value={profile?.emergencyContactPhone} />
                <InfoRow label="Relation" value={profile?.emergencyContactRelation} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employment Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <InfoRow label="Employee ID" value={emp.employeeId} />
                <InfoRow label="Department" value={emp.departmentName} />
                <InfoRow label="Designation" value={emp.designationTitle} />
                <InfoRow label="Employment Type" value={emp.employmentType} />
                <InfoRow label="Status" value={emp.status} />
                <InfoRow label="Date of Joining" value={emp.dateOfJoining ? format(new Date(emp.dateOfJoining), "dd MMM yyyy") : null} />
                <InfoRow label="CTC" value={emp.ctc ? `₹ ${Number(emp.ctc).toLocaleString("en-IN")}` : null} />
                <InfoRow label="Work Location" value={profile?.workLocation} />
                <InfoRow label="Probation End Date" value={profile?.probationEndDate} />
                <InfoRow label="Confirmation Date" value={profile?.confirmationDate} />
                <InfoRow label="Notice Period" value={profile?.noticePeriodDays ? `${profile.noticePeriodDays} days` : null} />
                <InfoRow
                  label="Timezone"
                  value={
                    canEditOwnTimezone && !canEdit ? (
                      <div className="flex items-center gap-2 max-w-xs">
                        <TimezoneCombo
                          value={emp.timezone ?? "Asia/Kolkata"}
                          onChange={(v) => {
                            updateMyTz.mutate(
                              { data: { timezone: v } },
                              {
                                onSuccess: () => qc.invalidateQueries({ queryKey: getGetEmployeeQueryKey(empId) }),
                              },
                            );
                          }}
                        />
                      </div>
                    ) : (
                      emp.timezone
                    )
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="education">
          <Card>
            <CardContent className="p-6">
              <EducationSection employeeId={empId} canEdit={canEdit} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workexp">
          <Card>
            <CardContent className="p-6">
              <WorkExpSection employeeId={empId} canEdit={canEdit} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="p-6">
              <DocumentsSection employeeId={empId} canEdit={canEdit} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-6">
              <HistorySection employeeId={empId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="onboarding">
          <Card>
            <CardContent className="p-6">
              <OnboardingTab employeeId={empId} canEdit={canEdit} />
            </CardContent>
          </Card>
        </TabsContent>

        {canViewPerformanceHistory && (
          <TabsContent value="performance">
            <PerformanceHistoryView employeeId={empId} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={editingProfile} onOpenChange={setEditingProfile}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Profile Details</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Personal</p>
              <div className="grid grid-cols-2 gap-3">
                {[["Marital Status", "maritalStatus"], ["Blood Group", "bloodGroup"], ["Nationality", "nationality"], ["LinkedIn URL", "linkedinUrl"], ["National ID", "nationalId"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Input value={profileForm[key] ?? ""} onChange={pf(key)} /></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Address</p>
              <div className="grid grid-cols-1 gap-3">
                {[["Current Address", "currentAddress"], ["Permanent Address", "permanentAddress"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Textarea value={profileForm[key] ?? ""} onChange={pf(key)} rows={2} /></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Emergency Contact</p>
              <div className="grid grid-cols-3 gap-3">
                {[["Name", "emergencyContactName"], ["Phone", "emergencyContactPhone"], ["Relation", "emergencyContactRelation"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Input value={profileForm[key] ?? ""} onChange={pf(key)} /></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Statutory</p>
              <div className="grid grid-cols-3 gap-3">
                {[["PAN", "pan"], ["Aadhaar", "aadhaar"], ["PF Number", "pfNumber"], ["ESI Number", "esiNumber"], ["UAN", "uan"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Input value={profileForm[key] ?? ""} onChange={pf(key)} /></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Bank Details</p>
              <div className="grid grid-cols-2 gap-3">
                {[["Account Name", "bankAccountName"], ["Account Number", "bankAccountNumber"], ["IFSC Code", "ifscCode"], ["Bank Name", "bankName"], ["Branch", "bankBranch"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Input value={profileForm[key] ?? ""} onChange={pf(key)} /></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Employment Details</p>
              <div className="grid grid-cols-2 gap-3">
                {[["Work Location", "workLocation"], ["Notice Period (days)", "noticePeriodDays"], ["Probation End Date", "probationEndDate"], ["Confirmation Date", "confirmationDate"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5"><Label>{label}</Label><Input value={profileForm[key] ?? ""} onChange={pf(key)} type={key.includes("Date") ? "date" : key.includes("days") ? "number" : "text"} /></div>
                ))}
                <div className="space-y-1.5 col-span-2">
                  <Label>Timezone</Label>
                  <TimezoneCombo
                    value={profileForm.timezone ?? "Asia/Kolkata"}
                    onChange={(v) => setProfileForm((prev) => ({ ...prev, timezone: v }))}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfile(false)}>Cancel</Button>
            <Button onClick={saveProfile} disabled={upsertProfile.isPending}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
