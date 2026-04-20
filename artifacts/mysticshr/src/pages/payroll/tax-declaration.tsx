import { useState } from "react";
import {
  useListTaxDeclarations, useCreateTaxDeclaration, getListTaxDeclarationsQueryKey,
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
import { Banknote, Plus, CheckCircle2 } from "lucide-react";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const INVESTMENT_FIELDS = [
  { key: "80C", label: "Section 80C (PF, LIC, ELSS, etc.)", max: 150000 },
  { key: "80D", label: "Section 80D (Medical Insurance)", max: 25000 },
  { key: "HRA_EXEMPT", label: "HRA Exemption", max: 999999 },
  { key: "LTA", label: "Leave Travel Allowance (LTA)", max: 999999 },
  { key: "80CCD", label: "Section 80CCD(1B) NPS", max: 50000 },
];

function getCurrentFY() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

export default function TaxDeclarationPage() {
  const { role, hrmsUser } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive", "payroll_admin"].includes(role ?? "");
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Income Tax Regime Declaration</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isEmployee ? "Declare your preferred income tax regime for TDS calculation." : "View and manage employee tax regime declarations."}
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
