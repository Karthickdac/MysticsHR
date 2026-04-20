import { useState } from "react";
import {
  useGetPfEcrReport, useGetEsiReport, useGetPtReport, useGetTdsSummaryReport,
  useGetBankTransferReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Building2, Shield, Banknote, CreditCard } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

type ReportType = "pf-ecr" | "esi" | "pt" | "tds" | "bank-transfer" | "form-16";

type StatutoryRecord = {
  employeeCode: string | null;
  employeeName: string | null;
  basic?: string | null;
  pfEmployee?: string | null;
  pfEmployer?: string | null;
  grossEarnings?: string | null;
  esiEmployee?: string | null;
  esiEmployer?: string | null;
  professionalTax?: string | null;
  tds?: string | null;
  taxRegime?: string | null;
  netPay?: string | null;
  status?: string | null;
};

type StatutoryReportData = {
  period: string;
  records: StatutoryRecord[];
  summary: Record<string, string | number>;
};

const REPORT_META: Record<ReportType, { label: string; icon: React.ElementType; color: string; bg: string; desc: string }> = {
  "pf-ecr": { label: "PF ECR File", icon: Shield, color: "text-blue-600", bg: "bg-blue-50", desc: "Employee Contribution Receipt for PF filing" },
  "esi": { label: "ESI Contribution", icon: Building2, color: "text-green-600", bg: "bg-green-50", desc: "ESI contribution report for employees earning ≤ ₹21,000/mo" },
  "pt": { label: "Professional Tax Register", icon: FileText, color: "text-purple-600", bg: "bg-purple-50", desc: "Professional Tax register for statutory compliance" },
  "tds": { label: "TDS Summary", icon: Banknote, color: "text-orange-600", bg: "bg-orange-50", desc: "Monthly TDS deduction summary by regime" },
  "bank-transfer": { label: "Bank Transfer File", icon: CreditCard, color: "text-teal-600", bg: "bg-teal-50", desc: "Net pay bank transfer instruction file" },
  "form-16": { label: "Form 16", icon: FileText, color: "text-red-600", bg: "bg-red-50", desc: "Annual TDS certificate generation (FY year-end)" },
};

function exportReportCSV(report: StatutoryReportData, type: string) {
  if (!report?.records?.length) return;
  let headers: string[] = [];
  if (type === "pf-ecr") headers = ["Employee Code", "Employee Name", "Basic Pay", "PF Employee", "PF Employer"];
  else if (type === "esi") headers = ["Employee Code", "Employee Name", "Gross Earnings", "ESI Employee", "ESI Employer"];
  else if (type === "pt") headers = ["Employee Code", "Employee Name", "Gross Earnings", "Professional Tax"];
  else if (type === "tds") headers = ["Employee Code", "Employee Name", "Gross Earnings", "TDS", "Tax Regime"];
  else if (type === "bank-transfer") headers = ["Employee Code", "Employee Name", "Net Pay", "Status"];

  const rows = report.records.map((r) => {
    if (type === "pf-ecr") return [r.employeeCode, r.employeeName, r.basic, r.pfEmployee, r.pfEmployer];
    if (type === "esi") return [r.employeeCode, r.employeeName, r.grossEarnings, r.esiEmployee, r.esiEmployer];
    if (type === "pt") return [r.employeeCode, r.employeeName, r.grossEarnings, r.professionalTax];
    if (type === "tds") return [r.employeeCode, r.employeeName, r.grossEarnings, r.tds, r.taxRegime];
    if (type === "bank-transfer") return [r.employeeCode, r.employeeName, r.netPay, r.status];
    return [];
  });

  const csv = [headers, ...rows].map(row => row.map((c) => `"${c ?? ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `${type}-${report.period}.csv`; a.click(); URL.revokeObjectURL(url);
}

function ReportTable({ report, type }: { report: StatutoryReportData; type: ReportType }) {
  if (!report?.records?.length) return <div className="text-center py-8 text-muted-foreground text-sm">No data found for this period.</div>;

  const summary = report.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 p-3 bg-muted/30 rounded-lg text-sm">
        {Object.entries(summary).map(([key, val]) => (
          <div key={key}>
            <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
            <span className="font-semibold">{typeof val === "number" ? (key.toLowerCase().includes("count") ? val : fmt(val)) : String(val)}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left p-2 pl-3 font-medium">Employee</th>
              <th className="text-left p-2 font-medium">Code</th>
              {type === "pf-ecr" && <>
                <th className="text-right p-2 font-medium">Basic Pay</th>
                <th className="text-right p-2 font-medium">PF Employee</th>
                <th className="text-right p-2 pr-3 font-medium">PF Employer</th>
              </>}
              {type === "esi" && <>
                <th className="text-right p-2 font-medium">Gross</th>
                <th className="text-right p-2 font-medium">ESI Employee</th>
                <th className="text-right p-2 pr-3 font-medium">ESI Employer</th>
              </>}
              {type === "pt" && <>
                <th className="text-right p-2 font-medium">Gross</th>
                <th className="text-right p-2 pr-3 font-medium">Prof Tax</th>
              </>}
              {type === "tds" && <>
                <th className="text-right p-2 font-medium">Gross</th>
                <th className="text-right p-2 font-medium">TDS</th>
                <th className="text-center p-2 pr-3 font-medium">Regime</th>
              </>}
              {type === "bank-transfer" && <>
                <th className="text-right p-2 font-medium">Net Pay</th>
                <th className="text-center p-2 pr-3 font-medium">Status</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {report.records.map((r, i) => (
              <tr key={i} className="border-b hover:bg-muted/20">
                <td className="p-2 pl-3">{r.employeeName}</td>
                <td className="p-2 text-muted-foreground">{r.employeeCode ?? "—"}</td>
                {type === "pf-ecr" && <>
                  <td className="p-2 text-right">{fmt(r.basic)}</td>
                  <td className="p-2 text-right">{fmt(r.pfEmployee)}</td>
                  <td className="p-2 pr-3 text-right">{fmt(r.pfEmployer)}</td>
                </>}
                {type === "esi" && <>
                  <td className="p-2 text-right">{fmt(r.grossEarnings)}</td>
                  <td className="p-2 text-right">{fmt(r.esiEmployee)}</td>
                  <td className="p-2 pr-3 text-right">{fmt(r.esiEmployer)}</td>
                </>}
                {type === "pt" && <>
                  <td className="p-2 text-right">{fmt(r.grossEarnings)}</td>
                  <td className="p-2 pr-3 text-right">{fmt(r.professionalTax)}</td>
                </>}
                {type === "tds" && <>
                  <td className="p-2 text-right">{fmt(r.grossEarnings)}</td>
                  <td className="p-2 text-right">{fmt(r.tds)}</td>
                  <td className="p-2 pr-3 text-center">
                    <Badge className={`text-xs ${r.taxRegime === "New" ? "bg-emerald-100 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>{r.taxRegime}</Badge>
                  </td>
                </>}
                {type === "bank-transfer" && <>
                  <td className="p-2 text-right font-semibold text-green-700">{fmt(r.netPay)}</td>
                  <td className="p-2 pr-3 text-center">
                    <Badge className="text-xs bg-blue-100 text-blue-700">{r.status}</Badge>
                  </td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StatutoryReportsPage() {
  const now = new Date();
  const [selectedType, setSelectedType] = useState<ReportType>("pf-ecr");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: pfRaw } = useGetPfEcrReport({ year, month });
  const { data: esiRaw } = useGetEsiReport({ year, month });
  const { data: ptRaw } = useGetPtReport({ year, month });
  const { data: tdsRaw } = useGetTdsSummaryReport({ year, month });
  const { data: bankRaw } = useGetBankTransferReport({ year, month });

  const pfData = pfRaw as StatutoryReportData | undefined;
  const esiData = esiRaw as StatutoryReportData | undefined;
  const ptData = ptRaw as StatutoryReportData | undefined;
  const tdsData = tdsRaw as StatutoryReportData | undefined;
  const bankData = bankRaw as StatutoryReportData | undefined;

  const currentReport = { "pf-ecr": pfData, "esi": esiData, "pt": ptData, "tds": tdsData, "bank-transfer": bankData, "form-16": null }[selectedType];
  const meta = REPORT_META[selectedType];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Statutory Reports</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Generate compliance reports — PF ECR, ESI, PT, TDS, Bank Transfer, and Form 16.</p>
      </div>

      {/* Report Type Selection */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {(Object.keys(REPORT_META) as ReportType[]).map(type => {
          const m = REPORT_META[type];
          return (
            <button key={type} onClick={() => { setSelectedType(type); setFetched(false); }}
              className={`p-3 rounded-xl border-2 text-left transition-all ${selectedType === type ? "border-primary shadow-sm" : "border-transparent hover:border-muted-foreground/20"}`}>
              <div className={`p-2 rounded-lg ${m.bg} inline-block mb-2`}>
                <m.icon className={`w-4 h-4 ${m.color}`} />
              </div>
              <p className="text-xs font-medium leading-tight">{m.label}</p>
            </button>
          );
        })}
      </div>

      {/* Period Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>Year</Label>
              <Input type="number" value={year} onChange={e => { setYear(e.target.value); setFetched(false); }} className="w-24" />
            </div>
            <div className="space-y-1">
              <Label>Month</Label>
              <Select value={month} onValueChange={v => { setMonth(v); setFetched(false); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => { setFetched(true); setError(null); }}>
              <FileText className="w-4 h-4 mr-1" />Generate Report
            </Button>
            {currentReport?.records?.length ? (
              <Button variant="outline" onClick={() => exportReportCSV(currentReport, selectedType)}>
                <Download className="w-4 h-4 mr-1" />Export CSV
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{meta.desc}</p>
        </CardContent>
      </Card>

      {/* Report Content */}
      {selectedType === "form-16" ? (
        <Card>
          <CardContent className="p-6 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Form 16 Generation</p>
            <p className="text-sm text-muted-foreground mt-1">Form 16 is available per-employee via the employee profile page (year-end generation).</p>
          </CardContent>
        </Card>
      ) : fetched ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <meta.icon className={`w-4 h-4 ${meta.color}`} />
              {meta.label} — {MONTHS[Number(month) - 1]} {year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentReport ? (
              <ReportTable report={currentReport} type={selectedType} />
            ) : (
              <div className="text-center py-8 text-muted-foreground">Loading report...</div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
          <meta.icon className={`w-10 h-10 mx-auto mb-3 ${meta.color} opacity-40`} />
          <p className="font-medium">Select period and click Generate Report</p>
          <p className="text-sm">{meta.desc}</p>
        </div>
      )}
    </div>
  );
}
