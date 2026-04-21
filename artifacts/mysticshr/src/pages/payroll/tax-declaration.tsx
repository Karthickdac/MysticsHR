import { useEffect, useMemo, useState } from "react";
import {
  useListTaxDeclarations, useCreateTaxDeclaration, getListTaxDeclarationsQueryKey,
  useCalculateTax, useGetMyActiveSalaryStructure, getGetMyActiveSalaryStructureQueryKey,
  useDispatchForm16ForFy, useDispatchForm16ForEmployee,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { extractError } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Banknote, Plus, CheckCircle2, Calculator, Download, FileText, Send, RefreshCw } from "lucide-react";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtINR(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "₹0";
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const INVESTMENT_FIELDS = [
  { key: "80C", label: "Section 80C (PF, LIC, ELSS, etc.)", max: 150000 },
  { key: "80D", label: "Section 80D (Medical Insurance)", max: 25000 },
  { key: "HRA_EXEMPT", label: "HRA Exemption", max: 999999 },
  { key: "LTA", label: "Leave Travel Allowance (LTA)", max: 999999 },
  { key: "80CCD", label: "Section 80CCD(1B) NPS", max: 50000 },
];

const CALC_FIELDS: Array<{ key: "80C" | "80D" | "80CCD" | "HRA_EXEMPT" | "LTA" | "OTHER"; label: string; hint?: string }> = [
  { key: "80C", label: "Section 80C", hint: "Capped at ₹1.5L (PF, LIC, ELSS, PPF...)" },
  { key: "80D", label: "Section 80D", hint: "Capped at ₹25K (medical insurance)" },
  { key: "80CCD", label: "Section 80CCD(1B)", hint: "Capped at ₹50K (NPS)" },
  { key: "HRA_EXEMPT", label: "HRA Exemption" },
  { key: "LTA", label: "LTA" },
  { key: "OTHER", label: "Other Deductions" },
];

function getCurrentFY() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

function fyStartYear(fy: string): number {
  return Number(fy.split("-")[0]);
}

function buildApiBase() {
  const base = import.meta.env.BASE_URL ?? "/mysticshr/";
  return base.endsWith("/") ? `${base}api` : `${base}/api`;
}

export default function TaxDeclarationPage() {
  const { role, hrmsUser } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"].includes(role ?? "");
  const isPayrollAdmin = ["super_admin", "payroll_admin"].includes(role ?? "");
  const isEmployee = role === "employee";

  const qc = useQueryClient();
  const currentFY = getCurrentFY();
  const [fyFilter, setFyFilter] = useState(currentFY);
  const [showDeclare, setShowDeclare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: declarations, isLoading } = useListTaxDeclarations({ financialYear: fyFilter });
  const createMutation = useCreateTaxDeclaration();

  const [form, setForm] = useState({
    employeeId: "",
    financialYear: currentFY,
    regime: "New" as "Old" | "New",
    declarationDate: new Date().toISOString().split("T")[0],
    investments: {} as Record<string, string>,
  });

  // ─── Tax calculator state ────────────────────────────────────────────
  const calcMutation = useCalculateTax();
  const [calcGross, setCalcGross] = useState("");
  const [calcInv, setCalcInv] = useState<Record<string, string>>({});
  const [grossTouched, setGrossTouched] = useState(false);

  // Pre-fill the calculator with the caller's own annual CTC (annual gross)
  // so employees don't have to look it up by hand. Silent if no active
  // structure exists (server returns 204) or for users without an employee link.
  // Once the employee touches the field, we never overwrite it — they can model
  // "what-if" scenarios freely (including clearing the field).
  const { data: myStructure } = useGetMyActiveSalaryStructure({
    query: {
      queryKey: getGetMyActiveSalaryStructureQueryKey(),
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  });
  useEffect(() => {
    if (grossTouched) return;
    if (calcGross !== "") return;
    const annual = myStructure?.annualCtc;
    if (annual && Number(annual) > 0) {
      setCalcGross(String(Math.round(Number(annual))));
    }
  }, [myStructure, calcGross, grossTouched]);

  function handleCalculate() {
    const annualGross = Number(calcGross);
    if (!Number.isFinite(annualGross) || annualGross <= 0) return;
    const investments: Record<string, number> = {};
    for (const f of CALC_FIELDS) {
      const v = Number(calcInv[f.key]);
      if (Number.isFinite(v) && v > 0) investments[f.key] = v;
    }
    calcMutation.mutate({ data: { annualGross, investments } });
  }

  const calcResult = calcMutation.data;

  // ─── Form 16 download ────────────────────────────────────────────────
  // Available FY years are those with payroll history; we show the years from the declarations filter (employees pick year then download).
  const FORM16_YEARS = useMemo(() => {
    const startNow = fyStartYear(currentFY);
    return [startNow - 2, startNow - 1, startNow].map(y => ({
      year: y,
      label: `${y}-${String(y + 1).slice(2)}`,
    }));
  }, [currentFY]);
  const [form16Year, setForm16Year] = useState<number>(fyStartYear(currentFY) - 1);

  function handleDownloadForm16() {
    // Employees and HODs download their own Form 16; HR/payroll roles can specify any employee.
    const isSelfServeRole = role === "employee" || role === "hod";
    const empId = isSelfServeRole ? hrmsUser?.employeeId : isHr ? Number(form.employeeId || "0") : null;
    if (!empId) {
      setError("Employee ID is required to download Form 16.");
      return;
    }
    const url = `${buildApiBase()}/payroll/reports/form-16/${empId}/${form16Year}/pdf`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `Form16_FY${form16Year}-${String(form16Year + 1).slice(2)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleSubmit() {
    setError(null);
    try {
      const empId = isEmployee ? hrmsUser?.employeeId : Number(form.employeeId);
      if (!empId) { setError("Employee ID required"); return; }

      const investmentDeclarations: Record<string, number> = {};
      for (const f of INVESTMENT_FIELDS) {
        if (form.investments[f.key]) investmentDeclarations[f.key] = Number(form.investments[f.key]);
      }

      await createMutation.mutateAsync({
        data: {
          employeeId: empId,
          financialYear: form.financialYear,
          regime: form.regime,
          declarationDate: form.declarationDate,
          investmentDeclarations: Object.keys(investmentDeclarations).length ? investmentDeclarations : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListTaxDeclarationsQueryKey({}) });
      setShowDeclare(false);
      setForm(f => ({ ...f, investments: {} }));
    } catch (err: unknown) { setError(extractError(err, "Failed to submit")); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Income Tax Regime Declaration</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isEmployee ? "Declare your preferred income tax regime, project your tax under both regimes, and download your Form 16." : "View and manage employee tax regime declarations."}
          </p>
        </div>
        <Button onClick={() => { setShowDeclare(true); setError(null); }}>
          <Plus className="w-4 h-4 mr-1" />
          {isEmployee ? "Declare / Update" : "Add Declaration"}
        </Button>
      </div>

      {/* FY Filter */}
      <div className="flex gap-3 items-center">
        <Label className="text-sm font-medium">Financial Year:</Label>
        <Select value={fyFilter} onValueChange={setFyFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["2022-23","2023-24","2024-25","2025-26"].map(fy => (
              <SelectItem key={fy} value={fy}>{fy}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Regime Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> New Tax Regime (Default)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 text-muted-foreground">
            <p>Standard deduction: ₹75,000</p>
            <p>Rebate u/s 87A: Full rebate upto ₹7L taxable income</p>
            <p className="font-medium text-foreground">Slabs: 0% → 5% → 10% → 15% → 20% → 30%</p>
            <p className="text-xs mt-2">Best for: Employees without large 80C/80D investments</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-purple-700">Old Tax Regime</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 text-muted-foreground">
            <p>Standard deduction: ₹50,000</p>
            <p>Rebate u/s 87A: Full rebate upto ₹5L taxable income</p>
            <p className="font-medium text-foreground">Slabs: 0% → 5% → 20% → 30%</p>
            <p className="text-xs mt-2">Best for: Employees with significant 80C/80D/HRA exemptions</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Interactive Tax Calculator ─────────────────────── */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-600" /> Tax Calculator — Old vs New Regime
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Enter your hypothetical annual gross salary and proposed investments to see projected income tax under both regimes.
            Investment caps (80C ₹1.5L, 80D ₹25K, 80CCD ₹50K) are applied automatically.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs">Annual Gross Salary <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                placeholder="e.g. 1200000"
                value={calcGross}
                onChange={e => { setCalcGross(e.target.value); setGrossTouched(true); }}
              />
            </div>
            {CALC_FIELDS.map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type="number"
                  placeholder="₹0"
                  value={calcInv[f.key] ?? ""}
                  onChange={e => setCalcInv(s => ({ ...s, [f.key]: e.target.value }))}
                />
                {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={handleCalculate} disabled={!calcGross || calcMutation.isPending}>
              {calcMutation.isPending ? "Calculating..." : "Calculate Tax"}
            </Button>
            {calcMutation.isError && (
              <span className="text-sm text-red-600">{extractError(calcMutation.error, "Calculation failed")}</span>
            )}
          </div>

          {calcResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Old regime */}
              <Card className={`border-2 ${calcResult.recommended === "Old" ? "border-emerald-400 bg-emerald-50/50" : "border-purple-200"}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between text-purple-800">
                    Old Regime
                    {calcResult.recommended === "Old" && <Badge className="bg-emerald-600 text-white">Recommended</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1.5">
                  <Row label="Gross Income" value={fmtINR(calcResult.oldRegime.grossIncome)} />
                  <Row label="Standard Deduction" value={`− ${fmtINR(calcResult.oldRegime.standardDeduction)}`} />
                  <Row label="Investment Deductions" value={`− ${fmtINR(calcResult.oldRegime.totalDeductions - calcResult.oldRegime.standardDeduction)}`} />
                  <Row label="Taxable Income" value={fmtINR(calcResult.oldRegime.taxableIncome)} bold />
                  <Row label="Tax Before Rebate" value={fmtINR(calcResult.oldRegime.taxBeforeRebate)} />
                  <Row label="Rebate u/s 87A" value={`− ${fmtINR(calcResult.oldRegime.rebate)}`} />
                  <Row label="Health & Edu Cess (4%)" value={`+ ${fmtINR(calcResult.oldRegime.cess)}`} />
                  <div className="h-px bg-purple-200 my-2" />
                  <Row label="Total Tax (Annual)" value={fmtINR(calcResult.oldRegime.totalTaxAnnual)} bold className="text-purple-800" />
                  <Row label="Approx Monthly TDS" value={fmtINR(calcResult.oldRegime.monthlyTds)} />
                </CardContent>
              </Card>
              {/* New regime */}
              <Card className={`border-2 ${calcResult.recommended === "New" ? "border-emerald-400 bg-emerald-50/50" : "border-blue-200"}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between text-blue-800">
                    New Regime
                    {calcResult.recommended === "New" && <Badge className="bg-emerald-600 text-white">Recommended</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1.5">
                  <Row label="Gross Income" value={fmtINR(calcResult.newRegime.grossIncome)} />
                  <Row label="Standard Deduction" value={`− ${fmtINR(calcResult.newRegime.standardDeduction)}`} />
                  <Row label="Investment Deductions" value="− ₹0 (not allowed)" />
                  <Row label="Taxable Income" value={fmtINR(calcResult.newRegime.taxableIncome)} bold />
                  <Row label="Tax Before Rebate" value={fmtINR(calcResult.newRegime.taxBeforeRebate)} />
                  <Row label="Rebate u/s 87A" value={`− ${fmtINR(calcResult.newRegime.rebate)}`} />
                  <Row label="Health & Edu Cess (4%)" value={`+ ${fmtINR(calcResult.newRegime.cess)}`} />
                  <div className="h-px bg-blue-200 my-2" />
                  <Row label="Total Tax (Annual)" value={fmtINR(calcResult.newRegime.totalTaxAnnual)} bold className="text-blue-800" />
                  <Row label="Approx Monthly TDS" value={fmtINR(calcResult.newRegime.monthlyTds)} />
                </CardContent>
              </Card>
              <div className="md:col-span-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
                <span className="font-semibold text-emerald-900">{calcResult.recommended} Regime</span>
                {calcResult.savings > 0 ? (
                  <span className="text-emerald-800"> saves you approximately <span className="font-bold">{fmtINR(calcResult.savings)}</span> per year vs the {calcResult.recommended === "Old" ? "New" : "Old"} regime.</span>
                ) : (
                  <span className="text-emerald-800"> &mdash; both regimes produce the same tax.</span>
                )}
                <p className="text-xs text-muted-foreground mt-1">Estimates are projections based on FY 2024-25 slab rates and include 4% health &amp; education cess.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Manual Form 16 Dispatch (HR / Payroll Admin only) ─────── */}
      {isPayrollAdmin && (
        <ManualForm16Dispatch defaultYear={fyStartYear(currentFY) - 1} />
      )}

      {/* ─── Form 16 Download ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-red-600" /> Download Form 16
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Annual TDS certificate compiled from your monthly payroll records for the selected financial year.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          {role !== "employee" && role !== "hod" && (
            <div className="space-y-1">
              <Label className="text-xs">Employee ID</Label>
              <Input
                type="number"
                placeholder="Employee DB ID"
                className="w-40"
                value={form.employeeId}
                onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Financial Year</Label>
            <Select value={String(form16Year)} onValueChange={v => setForm16Year(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORM16_YEARS.map(y => (
                  <SelectItem key={y.year} value={String(y.year)}>FY {y.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleDownloadForm16} variant="outline">
            <Download className="w-4 h-4 mr-1" />Download Form 16 PDF
          </Button>
        </CardContent>
      </Card>

      {/* Declarations List */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : !declarations?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No declarations for {fyFilter}</p>
          <p className="text-sm">Submit your tax regime declaration to ensure correct TDS calculation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {declarations.map(d => (
            <Card key={d.id} className={`border-2 ${d.isCurrent ? "border-blue-200" : "border-transparent"}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  {isHr && <p className="font-semibold">{d.employeeName ?? `Employee #${d.employeeId}`}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className={`text-xs ${d.regime === "New" ? "bg-emerald-100 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>
                      {d.regime} Regime
                    </Badge>
                    {d.isCurrent && <Badge className="text-xs bg-blue-100 text-blue-700">Current</Badge>}
                    <span className="text-xs text-muted-foreground">FY {d.financialYear}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Declared on {fmtDate(d.declarationDate)}</p>
                  {d.investmentDeclarations != null && Object.keys(d.investmentDeclarations as Record<string, number>).length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {Object.entries(d.investmentDeclarations as Record<string, number>).map(([k, v]) => (
                        <span key={k} className="mr-3">{k}: ₹{Number(v).toLocaleString("en-IN")}</span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Declaration Dialog */}
      <Dialog open={showDeclare} onOpenChange={v => !v && setShowDeclare(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Submit Tax Regime Declaration</DialogTitle></DialogHeader>
          <div className="space-y-5">
            {!isEmployee && (
              <div className="space-y-1">
                <Label>Employee ID <span className="text-red-500">*</span></Label>
                <Input type="number" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="Employee DB ID" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Financial Year</Label>
                <Select value={form.financialYear} onValueChange={v => setForm(f => ({ ...f, financialYear: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["2022-23","2023-24","2024-25","2025-26"].map(fy => (
                      <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Declaration Date</Label>
                <Input type="date" value={form.declarationDate} onChange={e => setForm(f => ({ ...f, declarationDate: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Select Tax Regime</Label>
              <RadioGroup value={form.regime} onValueChange={v => setForm(f => ({ ...f, regime: v as "Old" | "New" }))}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="New" id="regime-new" />
                  <Label htmlFor="regime-new" className="cursor-pointer">
                    <span className="font-medium">New Regime</span>
                    <span className="text-xs text-muted-foreground ml-2">Simpler slabs, fewer exemptions, ₹75K std deduction</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="Old" id="regime-old" />
                  <Label htmlFor="regime-old" className="cursor-pointer">
                    <span className="font-medium">Old Regime</span>
                    <span className="text-xs text-muted-foreground ml-2">Multiple exemptions, ₹50K std deduction, 80C/80D apply</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {form.regime === "Old" && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Investment Declarations (for Old Regime)</Label>
                {INVESTMENT_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <Label className="text-xs text-muted-foreground flex-1">{field.label}</Label>
                    <Input
                      type="number"
                      className="w-28 text-right text-sm"
                      placeholder="₹0"
                      value={form.investments[field.key] ?? ""}
                      onChange={e => setForm(f => ({ ...f, investments: { ...f.investments, [field.key]: e.target.value } }))}
                      max={field.max}
                    />
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclare(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Submitting..." : "Submit Declaration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManualForm16Dispatch({ defaultYear }: { defaultYear: number }) {
  const [yearInput, setYearInput] = useState<string>(String(defaultYear));
  const [employeeId, setEmployeeId] = useState("");
  const [force, setForce] = useState(false);
  const [forceSingle, setForceSingle] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const year = Number(yearInput);
  const yearValid = Number.isInteger(year) && year >= 2000 && year <= 2100;
  const fyLabel = yearValid ? `${year}-${String(year + 1).slice(2)}` : "—";

  const fyMutation = useDispatchForm16ForFy();
  const empMutation = useDispatchForm16ForEmployee();

  async function runFyDispatch() {
    setError(null); setResult(null);
    if (!yearValid) { setError("Enter a valid FY start year (e.g. 2024 for FY 2024-25)."); return; }
    try {
      const r = await fyMutation.mutateAsync({ data: { year, force } });
      setResult(`FY ${r.financialYear ?? fyLabel}: ${r.sent} email(s) sent, ${r.skipped} skipped (eligible: ${r.eligible}).`);
    } catch (err: unknown) { setError(extractError(err, "FY dispatch failed")); }
  }

  async function runEmployeeDispatch() {
    setError(null); setResult(null);
    if (!yearValid) { setError("Enter a valid FY start year (e.g. 2024 for FY 2024-25)."); return; }
    const empId = Number(employeeId);
    if (!Number.isInteger(empId) || empId <= 0) {
      setError("Enter a valid employee ID.");
      return;
    }
    try {
      const r = await empMutation.mutateAsync({ employeeId: empId, data: { year, force: forceSingle } });
      setResult(`Employee #${empId} (FY ${r.financialYear ?? fyLabel}): ${r.sent} email(s) sent, ${r.skipped} skipped.`);
    } catch (err: unknown) { setError(extractError(err, "Employee dispatch failed")); }
  }

  const busy = fyMutation.isPending || empMutation.isPending;

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="w-4 h-4 text-amber-700" /> Manual Form 16 Dispatch
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Re-send Form 16 emails outside the annual April cron — useful after fixing a bounced address,
          a payroll correction, or for an employee who missed the original notification. Each manual
          dispatch is recorded in the audit log.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">FY Start Year</Label>
            <Input
              type="number"
              min={2000}
              max={2100}
              step={1}
              className="w-32"
              value={yearInput}
              onChange={e => setYearInput(e.target.value)}
              placeholder="2024"
            />
            <p className="text-[10px] text-muted-foreground">
              {yearValid ? `FY ${fyLabel} (Apr ${year} → Mar ${year + 1})` : "Enter a 4-digit year (e.g. 2024 for FY 2024-25)"}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer pb-6">
            <input
              type="checkbox"
              checked={force}
              onChange={e => setForce(e.target.checked)}
              className="h-4 w-4"
            />
            Force re-send (bypass already-sent dedup)
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Button
            variant="outline"
            onClick={runFyDispatch}
            disabled={busy || !yearValid}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${fyMutation.isPending ? "animate-spin" : ""}`} />
            {fyMutation.isPending ? "Dispatching…" : `Dispatch to all eligible employees`}
          </Button>
        </div>

        <div className="border-t border-amber-200 pt-4 space-y-2">
          <p className="text-xs font-medium">Or re-send to a single employee:</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Employee DB ID</Label>
              <Input
                type="number"
                placeholder="e.g. 42"
                className="w-40"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={forceSingle}
                onChange={e => setForceSingle(e.target.checked)}
                className="h-4 w-4"
              />
              Force re-send (bypass dedup)
            </label>
            <Button
              variant="outline"
              onClick={runEmployeeDispatch}
              disabled={busy || !employeeId || !yearValid}
            >
              <Send className={`w-4 h-4 mr-1 ${empMutation.isPending ? "animate-pulse" : ""}`} />
              {empMutation.isPending ? "Sending…" : "Re-send to this employee"}
            </Button>
          </div>
        </div>

        {result && (
          <div className="text-sm rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            {result}
          </div>
        )}
        {error && (
          <div className="text-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
