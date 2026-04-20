import { Link, useParams } from "wouter";
import { useGetEmployee } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Briefcase, Building2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-800",
  "Pre-Joining": "bg-blue-100 text-blue-800",
  "Notice Period": "bg-yellow-100 text-yellow-800",
  "On Leave of Absence": "bg-purple-100 text-purple-800",
  "Suspended": "bg-red-100 text-red-800",
  "Separated": "bg-gray-100 text-gray-600",
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-3 border-b border-border last:border-0">
      <dt className="text-sm font-medium text-muted-foreground w-40 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-foreground mt-1 sm:mt-0">{value ?? <span className="text-muted-foreground italic">—</span>}</dd>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: emp, isLoading, error } = useGetEmployee(parseInt(id, 10));

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/employees">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Employees
          </Button>
        </Link>
      </div>

      {/* Profile Header */}
      <Card className="border-border">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <Avatar className="w-20 h-20 flex-shrink-0">
              <AvatarImage src={emp.avatarUrl ?? undefined} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {emp.firstName[0]}{emp.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground">{emp.firstName} {emp.lastName}</h1>
              <p className="text-muted-foreground">{emp.designationTitle ?? "—"} · {emp.departmentName ?? "—"}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-sm font-mono text-muted-foreground border border-border rounded px-2 py-0.5">{emp.employeeId}</span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[emp.status] ?? "bg-muted text-foreground"}`}>
                  {emp.status}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                  {emp.employmentType}
                </span>
              </div>
            </div>
            <Link href={`/employees/${id}/edit`}>
              <Button variant="outline" size="sm">Edit Profile</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Quick Contact */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {emp.email && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{emp.email}</span>
          </div>
        )}
        {emp.phone && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="w-4 h-4 flex-shrink-0" />
            <span>{emp.phone}</span>
          </div>
        )}
        {emp.location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 flex-shrink-0" />
            <span>{emp.location}</span>
          </div>
        )}
        {emp.dateOfJoining && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4 flex-shrink-0" />
            <span>Joined {format(new Date(emp.dateOfJoining), "dd MMM yyyy")}</span>
          </div>
        )}
      </div>

      {/* Tabbed Details */}
      <Tabs defaultValue="personal">
        <TabsList>
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
        </TabsList>
        <TabsContent value="personal">
          <Card className="border-border">
            <CardContent className="p-6">
              <dl>
                <InfoRow label="First Name" value={emp.firstName} />
                <InfoRow label="Last Name" value={emp.lastName} />
                <InfoRow label="Email" value={emp.email} />
                <InfoRow label="Phone" value={emp.phone} />
                <InfoRow label="Date of Birth" value={emp.dateOfBirth ? format(new Date(emp.dateOfBirth), "dd MMM yyyy") : null} />
                <InfoRow label="Gender" value={emp.gender} />
                <InfoRow label="Location" value={emp.location} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="employment">
          <Card className="border-border">
            <CardContent className="p-6">
              <dl>
                <InfoRow label="Employee ID" value={emp.employeeId} />
                <InfoRow label="Department" value={emp.departmentName} />
                <InfoRow label="Designation" value={emp.designationTitle} />
                <InfoRow label="Employment Type" value={emp.employmentType} />
                <InfoRow label="Status" value={emp.status} />
                <InfoRow label="Date of Joining" value={emp.dateOfJoining ? format(new Date(emp.dateOfJoining), "dd MMM yyyy") : null} />
                <InfoRow label="CTC" value={emp.ctc ? `₹ ${Number(emp.ctc).toLocaleString("en-IN")}` : null} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
