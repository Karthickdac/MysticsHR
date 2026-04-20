import { useParams } from "wouter";
import { useGetPayrollRun, useGetPayrollRunRecords } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, Download } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Computed: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Locked: "bg-purple-100 text-purple-700",
  Pending: "bg-gray-100 text-gray-700",
  Paid: "bg-green-100 text-green-700",
};

function exportCSV(records: any[], period: string) {
  const headers = ["Employee","Code","Working Days","Present Days","LOP Days","Gross Earnings","PF Emp","TDS","Prof Tax","Loan","Total Deductions","Net Pay","Status"];
  const rows = records.map(r => [
    r.employeeName ?? "", r.employeeCode ?? "",
    r.workingDays, r.presentDays, r.lopDays,
    r.grossEarnings, r.pfEmployee, r.tds, r.professionalTax, r.loanDeduction,
    r.totalDeductions, r.netPay, r.status,
  ]);
  const csv = [headers, ...rows].map(row => row.map(c => `"${c ?? ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `payroll-${period}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);

  const { data: run, isLoading: runLoading } = useGetPayrollRun(runId);
  const { data: records, isLoading: recordsLoading } = useGetPayrollRunRecords(runId);

  if (runLoading) return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
  if (!run) return <div className="p-6 text-center text-muted-foreground">Payroll run not found.</div>;

  const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
  const monthName = `${MONTHS[run.periodMonth - 1]} ${run.periodYear}`;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/payroll">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Payroll Run — {monthName}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={`text-xs ${STATUS_COLORS[run.status]}`}>{run.status}</Badge>
            {run.initiatorName && <span className="text-xs text-muted-foreground">Initiated by {run.initiatorName}</span>}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Employees</p>
            <p className="text-3xl font-bold">{run.totalEmployees}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Total Gross</p>
            <p className="text-2xl font-bold">{fmt(run.totalGross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Total Deductions</p>
            <p className="text-2xl font-bold text-red-600">{fmt(run.totalDeductions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Net Pay</p>
            <p className="text-2xl font-bold text-green-700">{fmt(run.totalNet)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Records Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Employee Records</CardTitle>
            {records?.length ? (
              <Button size="sm" variant="outline" onClick={() => exportCSV(records, period)}>
                <Download className="w-3 h-3 mr-1" />Export CSV
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading records...</div>
          ) : !records?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No records yet. Run computation to generate records.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Employee</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Days</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">LOP</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Basic</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">HRA</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Gross</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">PF</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">TDS</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">PT</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Deductions</th>
                    <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Net Pay</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Regime</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{r.employeeName ?? `#${r.employeeId}`}</p>
                        {r.employeeCode && <p className="text-xs text-muted-foreground">{r.employeeCode}</p>}
                      </td>
                      <td className="py-2 pr-2 text-right">{r.presentDays}/{r.workingDays}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{r.lopDays}</td>
                      <td className="py-2 pr-2 text-right">{fmt(r.basic)}</td>
                      <td className="py-2 pr-2 text-right">{fmt(r.hra)}</td>
                      <td className="py-2 pr-2 text-right font-medium">{fmt(r.grossEarnings)}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{fmt(r.pfEmployee)}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{fmt(r.tds)}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{fmt(r.professionalTax)}</td>
                      <td className="py-2 pr-2 text-right text-red-600 font-medium">{fmt(r.totalDeductions)}</td>
                      <td className="py-2 pr-2 text-right font-semibold text-green-700">{fmt(r.netPay)}</td>
                      <td className="py-2 pr-2 text-center">
                        <Badge className={`text-xs ${r.taxRegime === "New" ? "bg-emerald-100 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>
                          {r.taxRegime ?? "New"}
                        </Badge>
                      </td>
                      <td className="py-2 text-center">
                        <Badge className={`text-xs ${STATUS_COLORS[r.status ?? "Pending"]}`}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="py-2 pr-3 font-semibold" colSpan={5}>Totals</td>
                    <td className="py-2 pr-2 text-right font-semibold">{fmt(run.totalGross)}</td>
                    <td colSpan={3}></td>
                    <td className="py-2 pr-2 text-right font-semibold text-red-600">{fmt(run.totalDeductions)}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-green-700">{fmt(run.totalNet)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
