import { Link } from "wouter";
import { useGetOnboardingChecklists } from "@workspace/api-client-react";
import type { OnboardingChecklist } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { CheckCircle2, ClipboardList, Clock, AlertCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  "Completed": "bg-green-100 text-green-800",
  "In Progress": "bg-blue-100 text-blue-800",
  "Not Started": "bg-gray-100 text-gray-600",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  "Completed": CheckCircle2,
  "In Progress": Clock,
  "Not Started": AlertCircle,
};

export default function OnboardingPage() {
  const { data: checklists = [], isLoading } = useGetOnboardingChecklists();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const checklistArr = checklists as OnboardingChecklist[];
  const filtered = checklistArr.filter((c) => {
    const matchSearch = !search || (c.employeeName ?? "").toLowerCase().includes(search.toLowerCase()) || (c.employeeCode ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: checklistArr.length,
    completed: checklistArr.filter((c) => c.status === "Completed").length,
    inProgress: checklistArr.filter((c) => c.status === "In Progress").length,
    notStarted: checklistArr.filter((c) => c.status === "Not Started").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Onboarding</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, icon: ClipboardList, color: "text-blue-600" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-green-600" },
          { label: "In Progress", value: stats.inProgress, icon: Clock, color: "text-yellow-600" },
          { label: "Not Started", value: stats.notStarted, icon: AlertCircle, color: "text-gray-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Search employee..." className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2">
          {["all", "Not Started", "In Progress", "Completed"].map((s) => (
            <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"} onClick={() => setFilterStatus(s)}>
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No onboarding checklists found.</p>
          <p className="text-sm mt-1">Create a checklist from the employee profile page.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => {
            const Icon = STATUS_ICONS[c.status] ?? ClipboardList;
            return (
              <Link key={c.id} href={`/onboarding/${c.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <Icon className={`w-8 h-8 flex-shrink-0 ${c.status === "Completed" ? "text-green-500" : c.status === "In Progress" ? "text-blue-500" : "text-gray-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold truncate">{c.employeeName ?? "—"}</span>
                          <span className="text-xs text-muted-foreground font-mono">{c.employeeCode}</span>
                          {c.departmentName && <span className="text-xs text-muted-foreground">· {c.departmentName}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <Progress value={c.completionPercentage} className="h-1.5 flex-1 max-w-[200px]" />
                          <span className="text-xs font-medium">{c.completionPercentage}%</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{c.status}</Badge>
                        {c.joiningDate && <span className="text-xs text-muted-foreground">{c.joiningDate}</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
