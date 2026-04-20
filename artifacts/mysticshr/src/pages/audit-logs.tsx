import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { format } from "date-fns";

const MODULES = ["Employees", "Departments", "Designations", "Users", "Leave", "Payroll"];
const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const [module, setModule] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useListAuditLogs({
    module: module || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">{total} log entries</p>
      </div>

      <div className="flex gap-3">
        <Select value={module} onValueChange={(v) => { setModule(v === "_all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Modules</SelectItem>
            {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Card key={i} className="animate-pulse h-14 border-border" />)}
        </div>
      ) : !logs.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No audit logs found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Module</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Record</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {format(new Date(log.createdAt), "dd MMM yy HH:mm")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      log.action === "CREATE" ? "bg-green-100 text-green-700" :
                      log.action === "DELETE" ? "bg-red-100 text-red-700" :
                      log.action === "UPDATE" ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>{log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{log.module}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{log.recordId ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[140px]">{log.userEmail ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {log.previousValue && log.newValue ? `${log.previousValue} → ${log.newValue}` : log.newValue ?? log.previousValue ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
