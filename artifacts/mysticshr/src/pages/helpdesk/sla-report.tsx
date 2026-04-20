import { useGetHelpdeskSlaReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, BarChart3 } from "lucide-react";

export default function SlaReportPage() {
  const { data: report, isLoading } = useGetHelpdeskSlaReport();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading SLA report…</div>;
  if (!report) return <div className="p-8 text-muted-foreground">No data available.</div>;

  const breachRate = report.totalTickets > 0
    ? Math.round((report.slaBreachedCount / report.totalTickets) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/helpdesk">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">SLA Report</h1>
          <p className="text-sm text-muted-foreground">Helpdesk performance and SLA compliance overview</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Tickets</span>
            </div>
            <div className="text-3xl font-bold">{report.totalTickets}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Open</span>
            </div>
            <div className="text-3xl font-bold text-blue-600">{report.openTickets}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Resolved</span>
            </div>
            <div className="text-3xl font-bold text-green-600">{report.resolvedTickets}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">SLA Breached</span>
            </div>
            <div className="text-3xl font-bold text-red-600">{report.slaBreachedCount}</div>
            <div className="text-xs text-muted-foreground mt-1">{breachRate}% breach rate</div>
          </CardContent>
        </Card>
      </div>

      {report.avgResolutionHours != null && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Average Resolution Time</div>
            <div className="text-2xl font-semibold">
              {report.avgResolutionHours < 24
                ? `${report.avgResolutionHours}h`
                : `${Math.round((report.avgResolutionHours / 24) * 10) / 10} days`}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">By Priority</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report.byPriority.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : report.byPriority.map((row) => (
              <div key={row.priority} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={
                    row.priority === "Urgent" ? "destructive" :
                    row.priority === "High" ? "default" :
                    "secondary"
                  }>{row.priority}</Badge>
                  <span className="text-sm">{row.count} tickets</span>
                </div>
                {row.breached > 0 && (
                  <span className="text-xs text-red-600 font-medium">{row.breached} breached</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : report.byCategory.map((row) => (
              <div key={row.category} className="flex items-center justify-between">
                <Badge variant="outline">{row.category}</Badge>
                <span className="text-sm font-medium">{row.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
