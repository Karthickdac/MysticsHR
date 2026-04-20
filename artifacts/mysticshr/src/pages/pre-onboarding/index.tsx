import { useState } from "react";
import { Link } from "wouter";
import { useListPreOnboardingRecords } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
};

export default function PreOnboardingPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const { data, isLoading } = useListPreOnboardingRecords({ status: statusFilter || undefined });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pre-Onboarding</h1>
        <p className="text-muted-foreground mt-1">Review and verify pre-joining documents from accepted candidates</p>
      </div>

      <Select value={statusFilter || "_all"} onValueChange={(v) => setStatusFilter(v === "_all" ? "" : v)}>
        <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All Statuses</SelectItem>
          <SelectItem value="Pending">Pending</SelectItem>
          <SelectItem value="In Progress">In Progress</SelectItem>
          <SelectItem value="Completed">Completed</SelectItem>
          <SelectItem value="Cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : !data?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No pre-onboarding records yet</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {data.map((r) => (
            <Link key={r.id} href={`/pre-onboarding/${r.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.candidateName ?? `Candidate #${r.candidateId}`}</span>
                        <Badge className={STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.candidateEmail ?? ""} • Expected joining: {r.expectedJoiningDate}
                      </div>
                    </div>
                    <div className="w-full sm:w-48 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Document Verification</span>
                        <span className="font-medium">{r.completionPercentage}%</span>
                      </div>
                      <Progress value={r.completionPercentage} className="h-2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
