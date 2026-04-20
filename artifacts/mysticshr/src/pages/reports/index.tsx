import { useState } from "react";
import {
  useGetEmployeeDirectoryReport,
  useGetAttendanceSummaryReport,
  useGetLeaveUtilizationReport,
  useGetPayrollRegisterReport,
  useGetHeadcountReport,
  useGetAttritionReport,
  useGetPerformanceSummaryReport,
  useGetRecruitmentPipelineReport,
  useListReportSchedules,
  useCreateReportSchedule,
  useDeleteReportSchedule,
  useListSavedReportTemplates,
  useCreateSavedReportTemplate,
  useDeleteSavedReportTemplate,
  useRunCustomReport,
  getListReportSchedulesQueryKey,
  getListSavedReportTemplatesQueryKey,
  getGetEmployeeDirectoryReportQueryKey,
  getGetAttendanceSummaryReportQueryKey,
  getGetLeaveUtilizationReportQueryKey,
  getGetPayrollRegisterReportQueryKey,
  getGetHeadcountReportQueryKey,
  getGetAttritionReportQueryKey,
  getGetPerformanceSummaryReportQueryKey,
  getGetRecruitmentPipelineReportQueryKey,
  type CreateReportScheduleBody,
  type ReportSchedule,
  type SavedReportTemplate,
  type RunCustomReport200DataItem,
  type GetEmployeeDirectoryReportParams,
  type GetAttendanceSummaryReportParams,
  type GetLeaveUtilizationReportParams,
  type GetPayrollRegisterReportParams,
  type GetHeadcountReportParams,
  type GetAttritionReportParams,
  type GetPerformanceSummaryReportParams,
  type GetRecruitmentPipelineReportParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Download, Plus, Trash2, Calendar, Settings, Filter,
  Users, Clock, Umbrella, DollarSign, TrendingDown, Target, UserPlus, BarChart3,
} from "lucide-react";

type Tab = "catalog" | "custom" | "scheduler";

const REPORT_TYPES = [
  { id: "employee-directory", label: "Employee Directory", icon: Users, description: "Full list of active employees with department and role." },
  { id: "attendance-summary", label: "Attendance Summary", icon: Clock, description: "Daily attendance records with sign-in/out times." },
  { id: "leave-utilization", label: "Leave Utilization", icon: Umbrella, description: "Leave applications and utilization by employee/department." },
  { id: "payroll-register", label: "Payroll Register", icon: DollarSign, description: "Monthly payroll register with gross, deductions, and net pay." },
  { id: "headcount", label: "Headcount Report", icon: BarChart3, description: "Headcount by department and employment type." },
  { id: "attrition", label: "Attrition Report", icon: TrendingDown, description: "Employees who have exited with tenure and exit type." },
  { id: "performance-summary", label: "Performance Summary", icon: Target, description: "Appraisal outcomes and scores by cycle and department." },
  { id: "recruitment-pipeline", label: "Recruitment Pipeline", icon: UserPlus, description: "Job requisitions and their current status." },
] as const;

type ReportType = (typeof REPORT_TYPES)[number]["id"];

function exportToCsv(data: object[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((h) => JSON.stringify((row as Record<string, unknown>)[h] ?? "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function exportReport(reportType: string, format: "xlsx" | "pdf", filters: Record<string, string>) {
  const params = new URLSearchParams({ format, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  const url = `/api/reports/${reportType}/export?${params.toString()}`;
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) { alert("Export failed. Please try again."); return; }
  if (format === "pdf") {
    const html = await resp.text();
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 500); }
    return;
  }
  const blob = await resp.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${reportType}-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
}

// Converts filter state (all-string Record) to properly typed report params
function toNum(v: string | undefined): number | undefined { return v ? Number(v) : undefined; }
function dateFilters(f: Record<string, string>, defaults: { fromDate?: string; toDate?: string }) {
  return { fromDate: f.fromDate ?? defaults.fromDate, toDate: f.toDate ?? defaults.toDate };
}

function ReportFilterPanel({
  reportId,
  filters,
  onChange,
}: {
  reportId: ReportType;
  filters: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  const common = (
    <>
      <div>
        <Label className="text-xs">Department ID</Label>
        <Input type="number" placeholder="Any" value={filters.departmentId ?? ""} onChange={(e) => onChange("departmentId", e.target.value)} className="h-8 text-sm" />
      </div>
    </>
  );

  const dateRange = (
    <>
      <div>
        <Label className="text-xs">From Date</Label>
        <Input type="date" value={filters.fromDate ?? monthStart} onChange={(e) => onChange("fromDate", e.target.value)} className="h-8 text-sm" />
      </div>
      <div>
        <Label className="text-xs">To Date</Label>
        <Input type="date" value={filters.toDate ?? today} onChange={(e) => onChange("toDate", e.target.value)} className="h-8 text-sm" />
      </div>
    </>
  );

  if (reportId === "attendance-summary" || reportId === "leave-utilization" || reportId === "headcount" || reportId === "attrition" || reportId === "recruitment-pipeline") {
    return <>{common}{dateRange}</>;
  }
  if (reportId === "payroll-register") {
    return (
      <>
        {common}
        <div>
          <Label className="text-xs">Month (1–12)</Label>
          <Input type="number" min={1} max={12} value={filters.month ?? String(new Date().getMonth() + 1)} onChange={(e) => onChange("month", e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Year</Label>
          <Input type="number" value={filters.year ?? String(new Date().getFullYear())} onChange={(e) => onChange("year", e.target.value)} className="h-8 text-sm" />
        </div>
      </>
    );
  }
  if (reportId === "employee-directory") {
    return (
      <>
        {common}
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filters.status ?? "_all"} onValueChange={(v) => onChange("status", v === "_all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              {["_all", "Active", "Notice Period", "Separated"].map((s) => <SelectItem key={s} value={s}>{s === "_all" ? "All" : s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </>
    );
  }
  return common;
}

function ReportCatalog() {
  const [selected, setSelected] = useState<ReportType | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  // Build properly typed params for each report from the filter state
  const dirParams: GetEmployeeDirectoryReportParams = {
    departmentId: toNum(filters.departmentId), designationId: toNum(filters.designationId),
    employmentType: filters.employmentType, status: filters.status, location: filters.location,
  };
  const attParams: GetAttendanceSummaryReportParams = {
    ...dateFilters(filters, { fromDate: monthStart, toDate: today }),
    departmentId: toNum(filters.departmentId), employeeId: toNum(filters.employeeId),
  };
  const leaveParams: GetLeaveUtilizationReportParams = {
    ...dateFilters(filters, { fromDate: monthStart, toDate: today }),
    departmentId: toNum(filters.departmentId), leaveType: filters.leaveType,
  };
  const payParams: GetPayrollRegisterReportParams = {
    month: filters.month ?? String(new Date().getMonth() + 1),
    year: toNum(filters.year) ?? new Date().getFullYear(),
    departmentId: toNum(filters.departmentId),
  };
  const hcParams: GetHeadcountReportParams = {
    ...dateFilters(filters, {}), departmentId: toNum(filters.departmentId),
  };
  const attrParams: GetAttritionReportParams = {
    ...dateFilters(filters, { fromDate: monthStart, toDate: today }),
    departmentId: toNum(filters.departmentId),
  };
  const perfParams: GetPerformanceSummaryReportParams = {
    cycleId: toNum(filters.cycleId), departmentId: toNum(filters.departmentId),
  };
  const recParams: GetRecruitmentPipelineReportParams = {
    ...dateFilters(filters, {}), departmentId: toNum(filters.departmentId),
  };

  const empDirQuery = useGetEmployeeDirectoryReport(selected === "employee-directory" ? dirParams : undefined, { query: { enabled: selected === "employee-directory", queryKey: getGetEmployeeDirectoryReportQueryKey(dirParams) } });
  const attQuery = useGetAttendanceSummaryReport(selected === "attendance-summary" ? attParams : undefined, { query: { enabled: selected === "attendance-summary", queryKey: getGetAttendanceSummaryReportQueryKey(attParams) } });
  const leaveQuery = useGetLeaveUtilizationReport(selected === "leave-utilization" ? leaveParams : undefined, { query: { enabled: selected === "leave-utilization", queryKey: getGetLeaveUtilizationReportQueryKey(leaveParams) } });
  const payQuery = useGetPayrollRegisterReport(selected === "payroll-register" ? payParams : undefined, { query: { enabled: selected === "payroll-register", queryKey: getGetPayrollRegisterReportQueryKey(payParams) } });
  const hcQuery = useGetHeadcountReport(selected === "headcount" ? hcParams : undefined, { query: { enabled: selected === "headcount", queryKey: getGetHeadcountReportQueryKey(hcParams) } });
  const attrQuery = useGetAttritionReport(selected === "attrition" ? attrParams : undefined, { query: { enabled: selected === "attrition", queryKey: getGetAttritionReportQueryKey(attrParams) } });
  const perfQuery = useGetPerformanceSummaryReport(selected === "performance-summary" ? perfParams : undefined, { query: { enabled: selected === "performance-summary", queryKey: getGetPerformanceSummaryReportQueryKey(perfParams) } });
  const recQuery = useGetRecruitmentPipelineReport(selected === "recruitment-pipeline" ? recParams : undefined, { query: { enabled: selected === "recruitment-pipeline", queryKey: getGetRecruitmentPipelineReportQueryKey(recParams) } });

  const queryMap: Record<ReportType, { data?: { data?: object[]; total?: number }; isLoading?: boolean }> = {
    "employee-directory": empDirQuery,
    "attendance-summary": attQuery,
    "leave-utilization": leaveQuery,
    "payroll-register": payQuery,
    "headcount": hcQuery,
    "attrition": attrQuery,
    "performance-summary": perfQuery,
    "recruitment-pipeline": recQuery,
  };

  const activeQuery = selected ? queryMap[selected] : null;
  const reportData: RunCustomReport200DataItem[] = (activeQuery?.data?.data ?? []) as RunCustomReport200DataItem[];
  const reportTotal: number = activeQuery?.data?.total ?? 0;

  const columns = reportData.length > 0 ? Object.keys(reportData[0]).filter((k) => k !== "id" && k !== "employeeId") : [];

  function handleFilter(key: string, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-4">
      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORT_TYPES.map(({ id, label, icon: Icon, description }) => (
          <button
            key={id}
            onClick={() => { setSelected(id); setFilters({}); }}
            className={`text-left p-4 rounded-lg border-2 transition-all hover:shadow-md ${
              selected === id ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className={`w-8 h-8 rounded-full mb-2 flex items-center justify-center ${selected === id ? "bg-indigo-100" : "bg-gray-100"}`}>
              <Icon className={`w-4 h-4 ${selected === id ? "text-indigo-700" : "text-gray-600"}`} />
            </div>
            <div className={`text-sm font-semibold ${selected === id ? "text-indigo-700" : "text-gray-800"}`}>{label}</div>
            <div className="text-xs text-gray-500 mt-1 line-clamp-2">{description}</div>
          </button>
        ))}
      </div>

      {/* Report Viewer */}
      {selected && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">
                {REPORT_TYPES.find((r) => r.id === selected)?.label}
                {reportTotal > 0 && <span className="text-gray-400 font-normal text-sm ml-2">({reportTotal} rows)</span>}
              </CardTitle>
              <div className="flex gap-2">
                {reportData.length > 0 && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => exportToCsv(reportData, `${selected}-report.csv`)}>
                      <Download className="w-3 h-3 mr-1" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportReport(selected, "xlsx", filters)}>
                      <Download className="w-3 h-3 mr-1" /> Excel
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportReport(selected, "pdf", filters)}>
                      <Download className="w-3 h-3 mr-1" /> PDF
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Filters */}
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
              <ReportFilterPanel reportId={selected} filters={filters} onChange={handleFilter} />
            </div>

            {/* Table */}
            {activeQuery?.isLoading ? (
              <div className="py-8 text-center text-gray-400">Loading report...</div>
            ) : reportData.length === 0 ? (
              <div className="py-8 text-center text-gray-400">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No data found for the selected filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      {columns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap text-xs">
                          {col.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reportData.slice(0, 100).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap text-xs">
                            {String(row[col] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reportData.length > 100 && (
                  <p className="text-xs text-gray-400 text-center py-2">Showing first 100 rows — export CSV for full data</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CustomReportBuilder() {
  const qc = useQueryClient();
  const runCustom = useRunCustomReport();
  const createTemplate = useCreateSavedReportTemplate();
  const deleteTemplate = useDeleteSavedReportTemplate();
  const { data: templates = [] } = useListSavedReportTemplates();

  const [reportType, setReportType] = useState<ReportType>("employee-directory");
  const [selectedFields, setSelectedFields] = useState<string[]>(["employeeName", "department", "designation", "dateOfJoining"]);
  const [results, setResults] = useState<RunCustomReport200DataItem[] | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [saveTemplateModal, setSaveTemplateModal] = useState(false);

  const CUSTOM_REPORT_TYPES = [
    { id: "employee-directory" as const, label: "Employee Directory" },
    { id: "attendance-summary" as const, label: "Attendance Summary" },
    { id: "leave-utilization" as const, label: "Leave Utilization" },
    { id: "headcount" as const, label: "Headcount by Dept/Type" },
    { id: "attrition" as const, label: "Attrition" },
    { id: "performance-summary" as const, label: "Performance Summary" },
    { id: "recruitment-pipeline" as const, label: "Recruitment Pipeline" },
  ] as const;

  const FIELD_OPTIONS: Partial<Record<ReportType, string[]>> & Record<string, string[]> = {
    "employee-directory": ["employeeCode", "employeeName", "email", "phone", "gender", "dateOfBirth", "dateOfJoining", "employmentType", "status", "location", "ctc", "department", "designation"],
    "attendance-summary": ["employeeCode", "employeeName", "department", "attendanceDate", "checkIn", "checkOut", "status", "shiftType", "hoursWorked"],
    "leave-utilization": ["employeeCode", "employeeName", "department", "leaveType", "fromDate", "toDate", "totalDays", "status", "reason"],
    "headcount": ["department", "employmentType", "count"],
    "attrition": ["employeeCode", "employeeName", "department", "exitType", "reason", "requestedLwd", "actualLwd", "separatedAt", "dateOfJoining", "tenureYears"],
    "performance-summary": ["employeeCode", "employeeName", "department", "cycleName", "finalScore", "outcomeLabel", "normalizedScore"],
    "recruitment-pipeline": ["title", "department", "status", "numberOfPositions", "createdAt", "totalCandidates"],
  };

  function toggleField(field: string) {
    setSelectedFields((f) => f.includes(field) ? f.filter((x) => x !== field) : [...f, field]);
  }

  function handleRun() {
    runCustom.mutate(
      { data: { reportType, selectedFields } },
      { onSuccess: (data) => setResults(data?.data ?? []) },
    );
  }

  function handleSaveTemplate() {
    createTemplate.mutate(
      { data: { name: templateName, reportType, selectedFields } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListSavedReportTemplatesQueryKey() });
          setTemplateName("");
          setSaveTemplateModal(false);
        },
      },
    );
  }

  function loadTemplate(tmpl: SavedReportTemplate) {
    setReportType((tmpl.reportType ?? "employee-directory") as ReportType);
    setSelectedFields(tmpl.selectedFields ?? []);
    setResults(null);
  }

  const columns = results && results.length > 0 ? Object.keys(results[0]).filter((k) => k !== "id") : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Builder Panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Build Custom Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={(v) => { setReportType(v as ReportType); setSelectedFields([]); setResults(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUSTOM_REPORT_TYPES.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Select Fields</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {(FIELD_OPTIONS[reportType] ?? []).map((field) => (
                  <label key={field} className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm transition-colors ${
                    selectedFields.includes(field) ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 hover:border-gray-300"
                  }`}>
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(field)}
                      onChange={() => toggleField(field)}
                      className="accent-indigo-600"
                    />
                    {field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleRun} disabled={runCustom.isPending || selectedFields.length === 0} className="flex-1">
                {runCustom.isPending ? "Running..." : "Run Report"}
              </Button>
              <Button variant="outline" onClick={() => setSaveTemplateModal(true)} disabled={selectedFields.length === 0}>
                Save Template
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Saved Templates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-gray-700">Saved Templates</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">No saved templates yet.</div>
            ) : (
              <div className="divide-y">
                {templates.map((tmpl) => (
                  <div key={tmpl.id} className="px-4 py-3 flex items-center justify-between gap-2">
                    <button
                      onClick={() => loadTemplate(tmpl)}
                      className="text-left flex-1"
                    >
                      <div className="text-sm font-medium text-gray-800">{tmpl.name}</div>
                      <div className="text-xs text-gray-500">{REPORT_TYPES.find((r) => r.id === tmpl.reportType)?.label ?? tmpl.reportType}</div>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700 h-7 w-7 p-0"
                      onClick={() => deleteTemplate.mutate({ id: tmpl.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListSavedReportTemplatesQueryKey() }) })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      {results !== null && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Results ({results.length})</CardTitle>
              {results.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => exportToCsv(results, `custom-report-${Date.now()}.csv`)}>
                  <Download className="w-3 h-3 mr-1" /> Export CSV
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {results.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No data returned.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      {columns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 text-xs whitespace-nowrap">
                          {col.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.slice(0, 100).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                            {String(row[col] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.length > 100 && <p className="text-xs text-gray-400 text-center py-2">Showing first 100 rows</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Save Template Modal */}
      <Dialog open={saveTemplateModal} onOpenChange={setSaveTemplateModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Report Template</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Template Name *</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Monthly Employee Export" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTemplateModal(false)}>Cancel</Button>
            <Button disabled={!templateName.trim() || createTemplate.isPending} onClick={handleSaveTemplate}>
              {createTemplate.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchedulerPanel() {
  const qc = useQueryClient();
  const { data: schedules = [] } = useListReportSchedules();
  const createSchedule = useCreateReportSchedule();
  const deleteSchedule = useDeleteReportSchedule();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<CreateReportScheduleBody>({
    reportType: "employee-directory",
    name: "",
    frequency: "Monthly",
    recipients: [],
    isActive: true,
  });
  const [recipientsInput, setRecipientsInput] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const recipients = recipientsInput.split(",").map((r) => r.trim()).filter(Boolean);
    createSchedule.mutate(
      { data: { ...form, recipients } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListReportSchedulesQueryKey() });
          setModal(false);
          setForm({ reportType: "employee-directory", name: "", frequency: "Monthly", recipients: [], isActive: true });
          setRecipientsInput("");
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Configure automatic report delivery to email recipients.</p>
        <Button onClick={() => setModal(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No report schedules configured.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {REPORT_TYPES.find((r) => r.id === s.reportType)?.label ?? s.reportType} · {s.frequency}
                  </div>
                  {s.recipients?.length > 0 && (
                    <div className="text-xs text-gray-400 mt-1">To: {s.recipients.slice(0, 3).join(", ")}{s.recipients.length > 3 ? `+${s.recipients.length - 3} more` : ""}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {s.isActive ? "Active" : "Inactive"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 h-7 w-7 p-0"
                    onClick={() => deleteSchedule.mutate({ id: s.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListReportSchedulesQueryKey() }) })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Report Schedule</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Schedule Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <Label>Report Type *</Label>
              <Select value={form.reportType} onValueChange={(v) => setForm((f) => ({ ...f, reportType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequency *</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Daily", "Weekly", "Monthly", "Quarterly"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recipients (comma-separated emails) *</Label>
              <Input value={recipientsInput} onChange={(e) => setRecipientsInput(e.target.value)} placeholder="hr@company.com, ceo@company.com" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModal(false)}>Cancel</Button>
              <Button type="submit" disabled={createSchedule.isPending}>
                {createSchedule.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("catalog");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-indigo-600" />
          Reports & Analytics
        </h1>
        <p className="text-sm text-gray-500 mt-1">Pre-built reports, custom builder, and automated delivery</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { id: "catalog" as Tab, label: "Report Catalog", icon: FileText },
          { id: "custom" as Tab, label: "Custom Builder", icon: Settings },
          { id: "scheduler" as Tab, label: "Scheduler", icon: Calendar },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-800"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "catalog" && <ReportCatalog />}
      {tab === "custom" && <CustomReportBuilder />}
      {tab === "scheduler" && <SchedulerPanel />}
    </div>
  );
}
