import { useState } from "react";
import { useGetAttendanceSummary } from "@workspace/api-client-react";
import type { GetAttendanceSummaryQueryResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

type SummaryRow = GetAttendanceSummaryQueryResult[number];

interface SummaryTotals {
  totalPresent: number;
  totalAbsent: number;
  totalHalfDay: number;
  totalOnLeave: number;
  totalWeekOff: number;
  totalHoliday: number;
  totalOvertimeMinutes: number;
  totalMinutesWorked: number;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function fmtMins(mins: number): string {
  if (!mins) return "0";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function AttendanceSummaryPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const { data: summaries = [], isLoading } = useGetAttendanceSummary({ month: monthStr });

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); }
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); }
  }

  function exportCSV() {
    const headers = ["Employee", "Code", "Present", "Absent", "Half-Day", "On Leave", "Week Off", "Holiday", "Overtime", "Total Worked"];
    const rows = summaries.map((s: SummaryRow) => [
      s.employeeName, s.employeeCode, s.totalPresent, s.totalAbsent, s.totalHalfDay,
      s.totalOnLeave, s.totalWeekOff, s.totalHoliday, fmtMins(s.totalOvertimeMinutes), fmtMins(s.totalMinutesWorked)
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-summary-${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = summaries.reduce((acc: SummaryTotals, s: SummaryRow) => ({
    totalPresent: acc.totalPresent + s.totalPresent,
    totalAbsent: acc.totalAbsent + s.totalAbsent,
    totalHalfDay: acc.totalHalfDay + s.totalHalfDay,
    totalOnLeave: acc.totalOnLeave + s.totalOnLeave,
    totalWeekOff: acc.totalWeekOff + s.totalWeekOff,
    totalHoliday: acc.totalHoliday + s.totalHoliday,
    totalOvertimeMinutes: acc.totalOvertimeMinutes + s.totalOvertimeMinutes,
    totalMinutesWorked: acc.totalMinutesWorked + s.totalMinutesWorked,
  }), { totalPresent: 0, totalAbsent: 0, totalHalfDay: 0, totalOnLeave: 0, totalWeekOff: 0, totalHoliday: 0, totalOvertimeMinutes: 0, totalMinutesWorked: 0 });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Monthly Attendance Summary</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="font-medium w-44 text-center">{monthLabel(year, month)}</span>
            <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          {summaries.length > 0 && (
            <Button variant="outline" onClick={exportCSV}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
          )}
        </div>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : summaries.length === 0 ? (
        <p className="text-muted-foreground">No attendance data for this month.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-center text-green-700">Present</th>
                    <th className="px-4 py-2 text-center text-red-700">Absent</th>
                    <th className="px-4 py-2 text-center text-yellow-700">Half-Day</th>
                    <th className="px-4 py-2 text-center text-blue-700">On Leave</th>
                    <th className="px-4 py-2 text-center text-gray-500">Week Off</th>
                    <th className="px-4 py-2 text-center text-pink-700">Holiday</th>
                    <th className="px-4 py-2 text-center text-purple-700">OT Hours</th>
                    <th className="px-4 py-2 text-center">Total Worked</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s: SummaryRow) => (
                    <tr key={s.employeeId} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <div className="font-medium">{s.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{s.employeeCode}</div>
                      </td>
                      <td className="px-4 py-2 text-center font-medium text-green-700">{s.totalPresent}</td>
                      <td className="px-4 py-2 text-center font-medium text-red-700">{s.totalAbsent}</td>
                      <td className="px-4 py-2 text-center text-yellow-700">{s.totalHalfDay}</td>
                      <td className="px-4 py-2 text-center text-blue-700">{s.totalOnLeave}</td>
                      <td className="px-4 py-2 text-center text-gray-500">{s.totalWeekOff}</td>
                      <td className="px-4 py-2 text-center text-pink-700">{s.totalHoliday}</td>
                      <td className="px-4 py-2 text-center text-purple-700">{fmtMins(s.totalOvertimeMinutes)}</td>
                      <td className="px-4 py-2 text-center">{fmtMins(s.totalMinutesWorked)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/50 font-medium">
                  <tr className="border-t-2">
                    <td className="px-4 py-2">TOTAL</td>
                    <td className="px-4 py-2 text-center text-green-700">{totals.totalPresent}</td>
                    <td className="px-4 py-2 text-center text-red-700">{totals.totalAbsent}</td>
                    <td className="px-4 py-2 text-center text-yellow-700">{totals.totalHalfDay}</td>
                    <td className="px-4 py-2 text-center text-blue-700">{totals.totalOnLeave}</td>
                    <td className="px-4 py-2 text-center text-gray-500">{totals.totalWeekOff}</td>
                    <td className="px-4 py-2 text-center text-pink-700">{totals.totalHoliday}</td>
                    <td className="px-4 py-2 text-center text-purple-700">{fmtMins(totals.totalOvertimeMinutes)}</td>
                    <td className="px-4 py-2 text-center">{fmtMins(totals.totalMinutesWorked)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
