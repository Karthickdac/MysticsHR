import { useState } from "react";
import { useListPayslips, useGetPayslip } from "@workspace/api-client-react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Download, Eye, Search } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

export default function PayslipsPage() {
  const { role } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"].includes(role ?? "");

  const now = new Date();
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()));
  const [monthFilter, setMonthFilter] = useState("");
  const [empFilter, setEmpFilter] = useState("");
  const [viewId, setViewId] = useState<number | null>(null);

  const { data: payslips, isLoading } = useListPayslips({
    year: yearFilter ? Number(yearFilter) : undefined,
    month: monthFilter ? Number(monthFilter) : undefined,
  });

  const { data: viewPayslip } = useGetPayslip(viewId ?? 0);

  const filtered = payslips?.filter(p =>
    !empFilter || (p.employeeName?.toLowerCase().includes(empFilter.toLowerCase()) || p.employeeCode?.toLowerCase().includes(empFilter.toLowerCase()))
  );

  function downloadPdf(payslipId: number) {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const url = `${base}/api/payroll/payslips/${payslipId}/pdf`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip-${payslipId}.pdf`;
    a.click();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payslips</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {isHr ? "View and download payslips for all employees." : "View and download your monthly payslips."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-2 items-center">
          <Input type="number" value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="w-24" placeholder="Year" />
          <Select value={monthFilter || "_all"} onValueChange={v => setMonthFilter(v === "_all" ? "" : v)}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All months" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All months</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {isHr && (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 w-56" placeholder="Search employee..." value={empFilter} onChange={e => setEmpFilter(e.target.value)} />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : !filtered?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No payslips found</p>
          <p className="text-sm">Payslips are generated when a payroll run is approved.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => (
            <Card key={p.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold">{p.employeeName ?? `Employee #${p.employeeId}`}</p>
                    <p className="text-sm text-muted-foreground">
                      {MONTHS[p.periodMonth - 1]} {p.periodYear}
                      {p.employeeCode && ` · ${p.employeeCode}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {p.netPay && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Net Pay</p>
                      <p className="font-semibold text-green-700">{fmt(p.netPay)}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setViewId(p.id)}>
                      <Eye className="w-3 h-3 mr-1" />View
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadPdf(p.id)}>
                      <Download className="w-3 h-3 mr-1" />PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Payslip View Dialog */}
      <Dialog open={!!viewId} onOpenChange={v => !v && setViewId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>
              Payslip — {viewPayslip ? `${MONTHS[viewPayslip.periodMonth - 1]} ${viewPayslip.periodYear}` : "Loading..."}
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            {viewPayslip?.htmlContent ? (
              <iframe
                srcDoc={viewPayslip.htmlContent}
                className="w-full rounded-lg border"
                style={{ height: "520px" }}
                title="Payslip"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">Loading payslip...</div>
            )}
          </div>
          <DialogFooter className="p-4 pt-0">
            <Button variant="outline" onClick={() => setViewId(null)}>Close</Button>
            {viewPayslip && (
              <Button onClick={() => downloadPdf(viewPayslip.id)}>
                <Download className="w-4 h-4 mr-1" />Download PDF
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
