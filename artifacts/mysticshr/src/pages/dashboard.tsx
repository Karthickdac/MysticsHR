import { 
  useGetDashboardKpis, 
  useGetDashboardRecentActivity, 
  useGetDashboardHeadcountByDepartment,
  useGetDashboardEmployeeStatusBreakdown 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend 
} from "recharts";
import { Users, UserCheck, TrendingDown, Calendar, BriefcaseBusiness, Clock, UserX, Activity, type LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { ClockInWidget } from "@/components/attendance/ClockInWidget";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

const STATUS_COLORS: Record<string, string> = {
  "Active": "hsl(145 58% 36%)",
  "Pre-Joining": "hsl(217 91% 60%)",
  "Notice Period": "hsl(38 92% 50%)",
  "On Leave of Absence": "hsl(262 80% 50%)",
  "Suspended": "hsl(0 72% 51%)",
  "Separated": "hsl(0 0% 60%)",
};

function KPICard({ title, value, icon: Icon, sub, loading }: { title: string; value: string; icon: LucideIcon; sub?: string; loading?: boolean }) {
  return (
    <Card className="border-border hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Icon className="w-5 h-5" />
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="text-3xl font-bold text-foreground">{value}</p>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: kpis, isLoading: kpisLoading } = useGetDashboardKpis();
  const { data: activityRaw } = useGetDashboardRecentActivity({ limit: 8 });
  const activity = Array.isArray(activityRaw) ? activityRaw : [];
  const { data: headcountRaw } = useGetDashboardHeadcountByDepartment();
  const headcount = Array.isArray(headcountRaw) ? headcountRaw : [];
  const { data: statusBreakdownRaw } = useGetDashboardEmployeeStatusBreakdown();
  const statusBreakdown = Array.isArray(statusBreakdownRaw) ? statusBreakdownRaw : [];
  const { hrmsUser } = useCurrentHrmsUser();
  const showClockWidget = !!hrmsUser?.employeeId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Live HR operations overview</p>
      </div>

      {showClockWidget && (
        <div className="grid md:grid-cols-2 gap-4">
          <ClockInWidget />
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Headcount" value={kpisLoading ? "—" : String(kpis?.totalHeadcount ?? 0)} icon={Users} loading={kpisLoading} sub="All employees" />
        <KPICard title="Active Employees" value={kpisLoading ? "—" : String(kpis?.activeEmployees ?? 0)} icon={UserCheck} loading={kpisLoading} sub="Currently active" />
        <KPICard title="New Joiners" value={kpisLoading ? "—" : String(kpis?.newJoinersThisMonth ?? 0)} icon={Calendar} loading={kpisLoading} sub="This month" />
        <KPICard title="On Leave Today" value={kpisLoading ? "—" : String(kpis?.onLeaveToday ?? 0)} icon={Clock} loading={kpisLoading} sub="Currently on leave" />
        <KPICard title="Attrition Rate" value={kpisLoading ? "—" : `${kpis?.attritionRate ?? 0}%`} icon={TrendingDown} loading={kpisLoading} sub="Separated / Total" />
        <KPICard title="Attendance Rate" value={kpisLoading ? "—" : `${kpis?.attendanceRateToday ?? 0}%`} icon={Activity} loading={kpisLoading} sub="Active / Total" />
        <KPICard title="Open Positions" value={kpisLoading ? "—" : String(kpis?.openPositions ?? 0)} icon={BriefcaseBusiness} loading={kpisLoading} sub="Unfilled vacancies" />
        <KPICard title="Pending Approvals" value={kpisLoading ? "—" : String(kpis?.pendingApprovals ?? 0)} icon={UserX} loading={kpisLoading} sub="Awaiting action" />
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {!headcount?.length ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={headcount} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="departmentName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 13
                    }} 
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Headcount" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Employee Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {!statusBreakdown?.length ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="count"
                    nameKey="status"
                    paddingAngle={3}
                  >
                    {statusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "hsl(var(--muted-foreground))"} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 13
                    }} 
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!activity?.length ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No recent activity</p>
          ) : (
            <div className="divide-y divide-border">
              {activity.map((item) => (
                <div key={item.id} className="py-3 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.actorName} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full flex-shrink-0 font-mono">{item.module}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
