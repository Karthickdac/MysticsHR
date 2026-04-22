import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDepartments,
  useListDesignations,
  useListEmployees,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, UserPlus } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const EMPLOYMENT_TYPES = ["Permanent", "Contract", "Probation", "Intern", "Part-Time"] as const;
const STATUSES = ["Pre-Joining", "Active", "On Leave of Absence", "Suspended", "Notice Period", "Separated"] as const;
const GENDERS = ["Male", "Female", "Other"] as const;

interface FormState {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  departmentId: string;
  designationId: string;
  employmentType: typeof EMPLOYMENT_TYPES[number];
  status: typeof STATUSES[number];
  dateOfJoining: string;
  ctc: string;
  managerId: string;
  location: string;
  notes: string;
}

const today = new Date().toISOString().slice(0, 10);

const initialState: FormState = {
  employeeId: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  departmentId: "",
  designationId: "",
  employmentType: "Permanent",
  status: "Pre-Joining",
  dateOfJoining: today,
  ctc: "",
  managerId: "",
  location: "Chennai",
  notes: "",
};

function suggestEmployeeId(): string {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `AMT-${year}-${rand}`;
}

export default function NewEmployeePage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({ ...initialState, employeeId: suggestEmployeeId() });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: deptResp } = useListDepartments();
  const { data: desigResp } = useListDesignations();
  const { data: empResp } = useListEmployees({ limit: 100 });
  const departments = (Array.isArray(deptResp) ? deptResp : (deptResp as any)?.data) ?? [];
  const designations = (Array.isArray(desigResp) ? desigResp : (desigResp as any)?.data) ?? [];
  const employees = (Array.isArray(empResp) ? empResp : (empResp as any)?.data) ?? [];

  const filteredDesignations = form.departmentId
    ? designations.filter((d: any) => String(d.departmentId) === form.departmentId)
    : designations;

  const update = <K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    if (key === "departmentId" && val !== form.departmentId) {
      setForm((prev) => ({ ...prev, designationId: "" }));
    }
  };

  const validate = (): string | null => {
    if (!form.employeeId.trim()) return "Employee ID is required";
    if (!form.firstName.trim()) return "First name is required";
    if (!form.lastName.trim()) return "Last name is required";
    if (!form.email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Email is not valid";
    if (form.ctc && Number.isNaN(Number(form.ctc))) return "CTC must be a valid number";
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setSuccess(null);
    const v = validate();
    if (v) { setError(v); return; }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        employeeId: form.employeeId.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        employmentType: form.employmentType,
        status: form.status,
      };
      if (form.phone) payload.phone = form.phone.trim();
      if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth;
      if (form.gender) payload.gender = form.gender;
      if (form.departmentId) payload.departmentId = Number(form.departmentId);
      if (form.designationId) payload.designationId = Number(form.designationId);
      if (form.dateOfJoining) payload.dateOfJoining = form.dateOfJoining;
      if (form.ctc) payload.ctc = form.ctc;
      if (form.managerId) payload.managerId = Number(form.managerId);
      if (form.location) payload.location = form.location.trim();

      const resp = await fetch(`${BASE_URL}/api/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${resp.status})`);
      }

      const created = await resp.json();
      setSuccess(`Employee ${created.firstName} ${created.lastName} (${created.employeeId}) created successfully.`);
      qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });

      setTimeout(() => navigate(`/employees/${created.id}`), 900);
    } catch (err: any) {
      setError(err?.message || "Failed to create employee");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/employees")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Employees
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-primary" /> New Employee
          </h1>
          <p className="text-sm text-muted-foreground">
            Create an employee record. Required fields are marked with <span className="text-destructive">*</span>.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="border-green-200 bg-green-50 text-green-900">
          <CheckCircle2 className="w-4 h-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Basic personal details</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="employeeId">Employee ID <span className="text-destructive">*</span></Label>
              <Input id="employeeId" value={form.employeeId}
                onChange={(e) => update("employeeId", e.target.value)} placeholder="AMT-2026-001" />
            </div>
            <div>
              <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
              <Input id="email" type="email" value={form.email}
                onChange={(e) => update("email", e.target.value)} placeholder="firstname.lastname@automystics.com" />
            </div>
            <div>
              <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
              <Input id="firstName" value={form.firstName}
                onChange={(e) => update("firstName", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
              <Input id="lastName" value={form.lastName}
                onChange={(e) => update("lastName", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone}
                onChange={(e) => update("phone", e.target.value)} placeholder="+91 98765 43210" />
            </div>
            <div>
              <Label htmlFor="dob">Date of Birth</Label>
              <Input id="dob" type="date" value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)} />
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={form.gender || undefined} onValueChange={(v) => update("gender", v)}>
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="loc">Location</Label>
              <Input id="loc" value={form.location}
                onChange={(e) => update("location", e.target.value)} placeholder="Chennai" />
            </div>
          </CardContent>
        </Card>

        {/* Position */}
        <Card>
          <CardHeader>
            <CardTitle>Position</CardTitle>
            <CardDescription>Department, role, and reporting</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Department</Label>
              <Select value={form.departmentId || undefined} onValueChange={(v) => update("departmentId", v)}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Designation</Label>
              <Select value={form.designationId || undefined} onValueChange={(v) => update("designationId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={form.departmentId ? "Select designation" : "Select department first"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredDesignations.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reporting Manager</Label>
              <Select value={form.managerId || undefined} onValueChange={(v) => update("managerId", v)}>
                <SelectTrigger><SelectValue placeholder="Select manager (optional)" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.firstName} {e.lastName} — {e.employeeId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Employment */}
        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
            <CardDescription>Type, status, joining date, and compensation</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Employment Type <span className="text-destructive">*</span></Label>
              <Select value={form.employmentType} onValueChange={(v) => update("employmentType", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status <span className="text-destructive">*</span></Label>
              <Select value={form.status} onValueChange={(v) => update("status", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="doj">Date of Joining</Label>
              <Input id="doj" type="date" value={form.dateOfJoining}
                onChange={(e) => update("dateOfJoining", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ctc">Annual CTC (₹)</Label>
              <Input id="ctc" type="number" step="0.01" value={form.ctc}
                onChange={(e) => update("ctc", e.target.value)} placeholder="e.g. 1200000" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea id="notes" rows={2} value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Optional context for HR (not visible to employee)" />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2 pb-6">
          <Button type="button" variant="outline" onClick={() => navigate("/employees")} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {submitting ? "Creating..." : "Create Employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}
