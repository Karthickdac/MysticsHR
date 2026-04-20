import { useGetDashboardAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, TrendingDown, CalendarCheck, Briefcase,
  AlertCircle, UserMinus, ArrowUpRight, ArrowDownRight,
  BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from "recharts";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

function KpiCard({
  title, value, subtitle, icon: Icon, color, trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  color: string;
  trend?: { value: number; label: string };
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-3 text-sm ${trend.value >= 0 ? "text-green-600" : "text-red-600"}`}>
            {trend.value >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            <span>{Math.abs(trend.value)}%</span>
            <span className="text-gray-500 text-xs">{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsDashboard() {
  const { data, isLoading } = useGetDashboardAnalytics();

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-gray-200 rounded animate-pulse w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const byDept = (data?.byDepartment ?? []).slice(0, 8);
  const trend = data?.headcountTrend ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-indigo-600" />
          Analytics Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">Executive view — real-time HR metrics and workforce insights</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Total Headcount"
          value={(data?.totalHeadcount ?? 0).toLocaleString()}
          icon={Users}
          color="bg-indigo-100 text-indigo-700"
          subtitle="Active employees"
        />
        <KpiCard
          title="New Joiners"
          value={data?.newJoinersThisMonth ?? 0}
          icon={Users}
          color="bg-green-100 text-green-700"
          subtitle="This month"
        />
        <KpiCard
          title="Attrition Rate"
          value={`${data?.attritionRate ?? 0}%`}
          icon={TrendingDown}
          color="bg-red-100 text-red-700"
          subtitle="Month-to-date"
        />
        <KpiCard
          title="Attendance Today"
          value={`${data?.attendanceTodayRate ?? 0}%`}
          icon={CalendarCheck}
          color="bg-blue-100 text-blue-700"
          subtitle="Present / half-day"
        />
        <KpiCard
          title="Open Positions"
          value={data?.openPositions ?? 0}
          icon={Briefcase}
          color="bg-amber-100 text-amber-700"
          subtitle="Active requisitions"
        />
        <KpiCard
          title="Pending Approvals"
          value={data?.pendingApprovals ?? 0}
          icon={AlertCircle}
          color="bg-orange-100 text-orange-700"
          subtitle="Leaves & tickets"
        />
        <KpiCard
          title="Exits This Month"
          value={data?.separatedThisMonth ?? 0}
          icon={UserMinus}
          color="bg-gray-100 text-gray-700"
          subtitle="Separated employees"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Headcount Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount Trend (6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No trend data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend iconSize={10} />
                  <Line type="monotone" dataKey="headcount" stroke="#6366f1" strokeWidth={2} dot={false} name="Headcount" />
                  <Line type="monotone" dataKey="joiners" stroke="#10b981" strokeWidth={2} dot={false} name="Joiners" />
                  <Line type="monotone" dataKey="leavers" stroke="#ef4444" strokeWidth={2} dot={false} name="Leavers" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Headcount by Department — bar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {byDept.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No department data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDept} margin={{ top: 4, right: 10, bottom: 24, left: 0 }}>
                  <XAxis dataKey="departmentName" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="headcount" radius={[4, 4, 0, 0]}>
                    {byDept.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie breakdown */}
        {byDept.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Department Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={byDept}
                    dataKey="headcount"
                    nameKey="departmentName"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {byDept.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${v} employees`]} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
