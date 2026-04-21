import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetExitRequest,
  useUpdateExitRequest,
  useUpdateClearanceTask,
  useGetFnfComputation,
  useComputeFnf,
  useApproveFnf,
  useGetExitInterview,
  useSubmitExitInterview,
  useListIssuedDocuments,
  getListExitRequestsQueryKey,
  type UpdateExitRequestBody,
  type UpdateClearanceTaskBody,
  type SubmitExitInterviewBody,
  type ComputeFnfBody,
  type ApproveFnfBody,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, User, Calendar, ClipboardList, DollarSign,
  MessageSquare, CheckCircle2, Clock, XCircle, Building2, AlertTriangle,
  FileText, Download,
} from "lucide-react";

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;

const STATUS_FLOW = [
  "Submitted", "HR Reviewing", "Notice Period", "Clearance Pending", "FnF Pending", "FnF Approved", "Separated",
];

const TASK_STATUS_COLORS: Record<string, string> = {
  Pending: "bg-gray-100 text-gray-700",
  Completed: "bg-green-100 text-green-700",
  Waived: "bg-blue-100 text-blue-700",
};

const STATUS_COLORS: Record<string, string> = {
  Submitted: "bg-blue-100 text-blue-800",
  "HR Reviewing": "bg-purple-100 text-purple-800",
  "Notice Period": "bg-yellow-100 text-yellow-800",
  "Clearance Pending": "bg-orange-100 text-orange-800",
  "FnF Pending": "bg-amber-100 text-amber-800",
  "FnF Approved": "bg-teal-100 text-teal-800",
  Separated: "bg-gray-100 text-gray-600",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-gray-100 text-gray-500",
};

export default function ExitDetailPage() {
  const [, params] = useRoute("/exit/:id");
  const id = Number(params?.id);
  const { hrmsUser } = useCurrentHrmsUser();
  const isHr = hrmsUser?.role != null && (HR_ROLES as readonly string[]).includes(hrmsUser.role);
  const qc = useQueryClient();

  const { data: exitReq, isLoading } = useGetExitRequest(id);
  const { data: fnf } = useGetFnfComputation(id);
  const { data: interview } = useGetExitInterview(id);
  // Only fetch issued documents once we know the employee, to avoid an unfiltered fetch
  // (HR users would otherwise briefly see all employees' docs before the exit request loads).
  const { data: exitDocs = [] } = useListIssuedDocuments(
    { employeeId: exitReq?.employeeId ?? 0 },
    { query: { enabled: !!exitReq?.employeeId, queryKey: ["exit-issued-docs", exitReq?.employeeId] } },
  );

  function downloadDoc(docId: number) {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    window.open(`${base}/api/documents/issued/${docId}/download`, "_blank", "noopener,noreferrer");
  }

  const updateExit = useUpdateExitRequest();
  const updateTask = useUpdateClearanceTask();
  const computeFnf = useComputeFnf();
  const approveFnf = useApproveFnf();
  const submitInterview = useSubmitExitInterview();

  const [fnfModal, setFnfModal] = useState(false);
  const [interviewModal, setInterviewModal] = useState(false);
  const [interviewResponses, setInterviewResponses] = useState<Record<number, string>>({});

  const [fnfForm, setFnfForm] = useState({
    pendingSalary: 0, leaveEncashment: 0, gratuity: 0,
    bonusProration: 0, noticePeriodLop: 0, otherDeductions: 0, remarks: "",
  });

  function handleStatusChange(newStatus: string) {
    updateExit.mutate(
      { id, data: { status: newStatus } as UpdateExitRequestBody },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListExitRequestsQueryKey() }) },
    );
  }

  function handleClearanceTask(taskId: number, newStatus: "Pending" | "Completed" | "Waived") {
    updateTask.mutate({ taskId, data: { status: newStatus } as UpdateClearanceTaskBody });
  }

  function handleComputeFnf(e: React.FormEvent) {
    e.preventDefault();
    computeFnf.mutate({ id, data: fnfForm as ComputeFnfBody }, { onSuccess: () => setFnfModal(false) });
  }

  function handleApproveFnf() {
    // approverRole is derived server-side from the user's session role — body only carries optional remarks
    approveFnf.mutate({ id, data: {} as ApproveFnfBody });
  }

  function handleSubmitInterview(e: React.FormEvent) {
    e.preventDefault();
    const responses = Object.entries(interviewResponses).map(([qId, answer]) => ({ questionId: Number(qId), answer }));
    submitInterview.mutate(
      { id, data: { responses } as SubmitExitInterviewBody },
      { onSuccess: () => setInterviewModal(false) },
    );
  }

  if (isLoading) return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (!exitReq) return <div className="p-8 text-center text-gray-500">Exit request not found.</div>;

  const clearanceTasks = exitReq.clearanceTasks ?? [];
  const totalTasks = clearanceTasks.length;
  const completedTasks = clearanceTasks.filter((t) => t.status === "Completed" || t.status === "Waived").length;
  const clearanceProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Back */}
      <div>
        <Link href="/exit">
          <Button variant="ghost" size="sm" className="text-gray-600">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Exit Requests
          </Button>
        </Link>
      </div>

      {/* Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-red-700" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">
                    {exitReq.employeeName ?? `Employee #${exitReq.employeeId}`}
                  </h1>
                  <div className="text-sm text-gray-500 flex gap-2">
                    {exitReq.departmentName && <span>{exitReq.departmentName}</span>}
                    {exitReq.employeeCode && <span>· {exitReq.employeeCode}</span>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[exitReq.status] ?? "bg-gray-100"}`}>
                {exitReq.status}
              </span>
              {isHr && (
                <Select value={exitReq.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Change status" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Submitted", "HR Reviewing", "Notice Period", "Clearance Pending", "FnF Pending", "Separated", "Rejected"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t">
            <div>
              <div className="text-xs text-gray-500">Exit Type</div>
              <div className="font-medium">{exitReq.exitType}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Requested LWD</div>
              <div className="font-medium">{exitReq.requestedLwd ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Actual LWD</div>
              <div className="font-medium">{exitReq.actualLwd ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Notice Period</div>
              <div className="font-medium">{exitReq.noticePeriodDays ? `${exitReq.noticePeriodDays} days` : "—"}</div>
            </div>
          </div>

          {exitReq.reason && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-gray-500 mb-1">Reason</div>
              <p className="text-sm text-gray-700">{exitReq.reason}</p>
            </div>
          )}
          {exitReq.hrRemarks && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">HR Remarks</div>
              <p className="text-sm text-gray-700">{exitReq.hrRemarks}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clearance Tasks */}
      {(exitReq.status === "Clearance Pending" || exitReq.status === "FnF Pending" || clearanceTasks.length > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-orange-600" />
                Clearance Checklist
              </CardTitle>
              <div className="text-sm text-gray-500">{completedTasks}/{totalTasks} completed</div>
            </div>
            {totalTasks > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${clearanceProgress}%` }} />
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {clearanceTasks.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Clearance tasks will appear here once the exit is approved.</div>
            ) : (
              <div className="divide-y">
                {clearanceTasks.map((task) => (
                  <div key={task.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        task.department === "IT" ? "bg-blue-100 text-blue-700" :
                        task.department === "Finance" ? "bg-green-100 text-green-700" :
                        task.department === "HR" ? "bg-purple-100 text-purple-700" :
                        "bg-orange-100 text-orange-700"
                      }`}>
                        {task.department[0]}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{task.taskName}</div>
                        <div className="text-xs text-gray-500">{task.department}{task.description ? ` · ${task.description}` : ""}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${TASK_STATUS_COLORS[task.status]}`}>{task.status}</span>
                      {isHr && task.status === "Pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-200"
                            onClick={() => handleClearanceTask(task.id, "Completed")}>Done</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-700"
                            onClick={() => handleClearanceTask(task.id, "Waived")}>Waive</Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* FnF Section */}
      {(isHr && (exitReq.status === "FnF Pending" || exitReq.status === "FnF Approved")) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Full & Final Settlement
              </CardTitle>
              {isHr && (
                <Button size="sm" variant="outline" onClick={() => {
                  if (fnf) {
                    setFnfForm({
                      pendingSalary: Number(fnf.pendingSalary),
                      leaveEncashment: Number(fnf.leaveEncashment),
                      gratuity: Number(fnf.gratuity),
                      bonusProration: Number(fnf.bonusProration),
                      noticePeriodLop: Number(fnf.noticePeriodLop),
                      otherDeductions: Number(fnf.otherDeductions),
                      remarks: fnf.remarks ?? "",
                    });
                  }
                  setFnfModal(true);
                }}>
                  {fnf ? "Edit FnF" : "Compute FnF"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!fnf ? (
              <div className="text-center py-6 text-gray-400">
                <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">FnF computation not yet done.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    { label: "Pending Salary", value: fnf.pendingSalary, color: "text-green-700" },
                    { label: "Leave Encashment", value: fnf.leaveEncashment, color: "text-green-700" },
                    { label: "Gratuity", value: fnf.gratuity, color: "text-green-700" },
                    { label: "Bonus Proration", value: fnf.bonusProration, color: "text-green-700" },
                    { label: "Notice Period LOP", value: fnf.noticePeriodLop, color: "text-red-700" },
                    { label: "Other Deductions", value: fnf.otherDeductions, color: "text-red-700" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500">{label}</div>
                      <div className={`text-lg font-bold ${color}`}>₹{Number(value ?? 0).toLocaleString("en-IN")}</div>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-700">Net Payable</div>
                  <div className="text-xl font-bold text-green-700">₹{Number(fnf.totalPayable ?? 0).toLocaleString("en-IN")}</div>
                </div>

                {/* Approvals */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className={`rounded-lg p-3 border ${fnf.hrApprovedAt ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                    <div className="text-xs font-medium text-gray-600">HR Approval</div>
                    {fnf.hrApprovedAt ? (
                      <div className="flex items-center gap-1 mt-1 text-green-700 text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        Approved
                      </div>
                    ) : isHr && (hrmsUser?.role === "hr_manager" || hrmsUser?.role === "super_admin") ? (
                      <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => handleApproveFnf()}>
                        Approve (HR)
                      </Button>
                    ) : (
                      <div className="text-xs text-gray-400 mt-1">Pending HR Manager</div>
                    )}
                  </div>
                  <div className={`rounded-lg p-3 border ${fnf.financeApprovedAt ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                    <div className="text-xs font-medium text-gray-600">Finance Approval</div>
                    {fnf.financeApprovedAt ? (
                      <div className="flex items-center gap-1 mt-1 text-green-700 text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        Approved
                      </div>
                    ) : hrmsUser?.role === "payroll_admin" || hrmsUser?.role === "super_admin" ? (
                      <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => handleApproveFnf()}>
                        Approve (Finance)
                      </Button>
                    ) : (
                      <div className="text-xs text-gray-400 mt-1">Pending Finance</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Issued Documents — relieving letter, experience certificate, and any other HR-issued docs */}
      {(exitDocs.length > 0 || exitReq.status === "FnF Approved" || exitReq.status === "Separated") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Issued Documents
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Relieving letter and experience certificate are auto-issued on FnF approval. HR may also issue additional documents (offer letter, salary certificate, etc.) for this employee.
            </p>
          </CardHeader>
          <CardContent>
            {exitDocs.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Documents will be issued automatically once Full &amp; Final settlement is fully approved.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {exitDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between border rounded-lg p-3 hover:bg-gray-50"
                    data-testid={`row-exit-doc-${doc.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 rounded-lg">
                        <FileText className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">{doc.documentType}</div>
                        <div className="text-xs text-gray-500">
                          {doc.filename ?? "—"}
                          {doc.generatedAt ? ` · Issued ${new Date(doc.generatedAt).toLocaleDateString("en-IN")}` : ""}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => downloadDoc(doc.id)}
                      data-testid={`button-download-doc-${doc.id}`}>
                      <Download className="w-3 h-3 mr-1" />
                      PDF
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Exit Interview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-600" />
              Exit Interview
            </CardTitle>
            {!interview?.submittedAt && (
              <Button size="sm" variant="outline" onClick={() => setInterviewModal(true)}>
                {interview ? "Complete Interview" : "Start Interview"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {interview?.submittedAt ? (
            <div>
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium mb-3">
                <CheckCircle2 className="w-4 h-4" />
                Submitted on {new Date(interview.submittedAt).toLocaleDateString("en-IN")}
              </div>
              {isHr && Array.isArray(interview.responses) && interview.responses.length > 0 && (
                <div className="space-y-3">
                  {(interview.questions ?? []).map((q) => {
                    const resp = (interview.responses ?? []).find((r) => r.questionId === q.id);
                    return resp ? (
                      <div key={q.id} className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs font-medium text-gray-600 mb-1">{q.question}</div>
                        <div className="text-sm text-gray-800">{resp.answer}</div>
                      </div>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-gray-400">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Exit interview not yet submitted.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* FnF Compute Modal */}
      <Dialog open={fnfModal} onOpenChange={setFnfModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compute Full & Final Settlement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleComputeFnf} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: "pendingSalary", label: "Pending Salary (₹)", positive: true },
                  { key: "leaveEncashment", label: "Leave Encashment (₹)", positive: true },
                  { key: "gratuity", label: "Gratuity (₹)", positive: true },
                  { key: "bonusProration", label: "Bonus Proration (₹)", positive: true },
                  { key: "noticePeriodLop", label: "Notice Period LOP (₹)", positive: false },
                  { key: "otherDeductions", label: "Other Deductions (₹)", positive: false },
                ] as Array<{ key: keyof typeof fnfForm; label: string; positive: boolean }>
              ).map(({ key, label }) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={fnfForm[key]}
                    onChange={(e) => setFnfForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <div className="bg-green-50 rounded-lg p-3 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Net Payable</span>
              <span className="text-xl font-bold text-green-700">
                ₹{Math.max(0, fnfForm.pendingSalary + fnfForm.leaveEncashment + fnfForm.gratuity + fnfForm.bonusProration - fnfForm.noticePeriodLop - fnfForm.otherDeductions).toLocaleString("en-IN")}
              </span>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={fnfForm.remarks} onChange={(e) => setFnfForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFnfModal(false)}>Cancel</Button>
              <Button type="submit" disabled={computeFnf.isPending}>
                {computeFnf.isPending ? "Saving..." : "Save FnF"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Exit Interview Modal */}
      <Dialog open={interviewModal} onOpenChange={setInterviewModal}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exit Interview</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitInterview} className="space-y-4">
            {interview && Array.isArray(interview.questions) && (interview.questions ?? []).map((q) => (
              <div key={q.id}>
                <Label className="text-sm">{q.question}</Label>
                <Textarea
                  value={interviewResponses[q.id] ?? ""}
                  onChange={(e) => setInterviewResponses((r) => ({ ...r, [q.id]: e.target.value }))}
                  rows={2}
                  placeholder="Your response..."
                />
              </div>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInterviewModal(false)}>Cancel</Button>
              <Button type="submit" disabled={submitInterview.isPending}>
                {submitInterview.isPending ? "Submitting..." : "Submit Interview"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
