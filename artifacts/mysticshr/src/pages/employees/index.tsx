import { useState, useRef } from "react";
import { Link } from "wouter";
import {
  useListEmployees,
  useListDepartments,
  useListDistinctEmployeeSkills,
  useListDistinctEmployeeCertifications,
  usePostEmployeesBulkImport,
  type BulkImportResult,
  type PostEmployeesBulkImportBodyRowsItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Search, Plus, ChevronLeft, ChevronRight, Upload, FileDown, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-800 border-green-200",
  "Pre-Joining": "bg-blue-100 text-blue-800 border-blue-200",
  "Notice Period": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "On Leave of Absence": "bg-purple-100 text-purple-800 border-purple-200",
  "Suspended": "bg-red-100 text-red-800 border-red-200",
  "Separated": "bg-gray-100 text-gray-600 border-gray-200",
};

const EMPLOYMENT_TYPE_COLORS: Record<string, string> = {
  "Permanent": "bg-primary/10 text-primary border-primary/20",
  "Contract": "bg-orange-100 text-orange-700 border-orange-200",
  "Probation": "bg-teal-100 text-teal-700 border-teal-200",
  "Intern": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "Part-Time": "bg-pink-100 text-pink-700 border-pink-200",
};

const CSV_TEMPLATE = [
  "firstName,lastName,email,phone,employeeId,departmentId,designationId,dateOfJoining,employmentType,status",
  "Jane,Doe,jane.doe@automystics.com,9876543210,EMP001,1,1,2024-01-15,Permanent,Active",
].join("\n");

const PAGE_SIZE = 12;

export default function EmployeesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [skillFilter, setSkillFilter] = useState<string>("");
  const [certFilter, setCertFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounce(search, 300);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const bulkImport = usePostEmployeesBulkImport();

  const { data: departments } = useListDepartments();
  const { data: skillsList } = useListDistinctEmployeeSkills();
  const { data: certsList } = useListDistinctEmployeeCertifications();
  const { data, isLoading } = useListEmployees({
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    departmentId: deptFilter ? parseInt(deptFilter, 10) : undefined,
    skill: skillFilter || undefined,
    certification: certFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const employees = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenImport() {
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    setImportOpen(true);
  }

  async function handleImport() {
    if (!importFile) return;
    setImportError(null);
    setImportResult(null);

    const text = await importFile.text();
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(h => h.trim());
    const rows: PostEmployeesBulkImportBodyRowsItem[] = lines.slice(1).map((line) => {
      const vals = line.split(",").map(v => v.trim());
      return headers.reduce<PostEmployeesBulkImportBodyRowsItem>((acc, h, i) => {
        acc[h] = vals[i] ?? "";
        return acc;
      }, {});
    });

    try {
      const result = await bulkImport.mutateAsync({ data: { rows } });
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["listEmployees"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      setImportError(msg);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground mt-1">{total} employees total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import CSV
          </Button>
          <Link href="/employees/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Employee
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Statuses</SelectItem>
            {["Active", "Pre-Joining", "Notice Period", "On Leave of Absence", "Suspended", "Separated"].map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={(v) => { setDeptFilter(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Departments</SelectItem>
            {departments?.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={skillFilter || "_all"} onValueChange={(v) => { setSkillFilter(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Skills" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Skills</SelectItem>
            {skillsList?.data?.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={certFilter || "_all"} onValueChange={(v) => { setCertFilter(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Certifications" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Certifications</SelectItem>
            {certsList?.data?.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(skillFilter || certFilter) && (
        <div className="flex flex-wrap gap-2">
          {skillFilter && (
            <Badge variant="secondary" className="gap-1.5 pr-1">
              Skill: {skillFilter}
              <button
                aria-label={`Clear skill filter ${skillFilter}`}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                onClick={() => { setSkillFilter(""); setPage(0); }}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {certFilter && (
            <Badge variant="secondary" className="gap-1.5 pr-1">
              Certification: {certFilter}
              <button
                aria-label={`Clear certification filter ${certFilter}`}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                onClick={() => { setCertFilter(""); setPage(0); }}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Employee Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-border animate-pulse">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <div className="text-4xl mb-4">—</div>
          <p className="font-medium">No employees found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((emp) => (
            <Link key={emp.id} href={`/employees/${emp.id}`}>
              <Card className="border-border hover:shadow-md hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-11 h-11 flex-shrink-0">
                      <AvatarImage src={emp.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                        {emp.firstName[0]}{emp.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{emp.designationTitle ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{emp.departmentName ?? "—"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{emp.employeeId}</span>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[emp.status] ?? "bg-muted text-muted-foreground"}`}>
                        {emp.status}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${EMPLOYMENT_TYPE_COLORS[emp.employmentType] ?? "bg-muted text-muted-foreground"}`}>
                        {emp.employmentType}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Employees from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file to bulk-import employees. Download the template to see the required format.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="w-full">
              <FileDown className="w-4 h-4 mr-2" />
              Download CSV Template
            </Button>

            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f && f.name.endsWith(".csv")) setImportFile(f);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              {importFile ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm font-medium text-foreground">{importFile.name}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setImportFile(null); }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Only .csv files are accepted</p>
                </>
              )}
            </div>

            {importResult && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm font-medium">{importResult.imported} employees imported</span>
                </div>
                {importResult.skipped > 0 && (
                  <p className="text-xs text-muted-foreground">{importResult.skipped} rows skipped (duplicates)</p>
                )}
                {importResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>Row {e.row}: {e.error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {importError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{importError}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={!importFile || bulkImport.isPending}
            >
              {bulkImport.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
