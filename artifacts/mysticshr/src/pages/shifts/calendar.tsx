import { useState } from "react";
import { useGetShiftsCalendar, useListEmployees } from "@workspace/api-client-react";
import type { GetShiftsCalendarQueryResult, Employee } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type CalEntry = GetShiftsCalendarQueryResult[number];

const STATUS_COLORS: Record<string, string> = {
  "Present": "bg-green-100 text-green-700",
  "Absent": "bg-red-100 text-red-700",
  "Half-Day": "bg-yellow-100 text-yellow-700",
  "On Leave": "bg-blue-100 text-blue-700",
  "On Permission": "bg-purple-100 text-purple-700",
  "Holiday": "bg-pink-100 text-pink-700",
  "Week Off": "bg-gray-100 text-gray-500",
  "Regularization Pending": "bg-orange-100 text-orange-700",
};

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

/** Get Monday of the week containing `d` */
function getMondayOf(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0=Sun, 1=Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

/** Format a Date as YYYY-MM-DD */
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ShiftCalendarPage() {
  const today = new Date();
  const [view, setView] = useState<"month" | "week">("month");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [weekStart, setWeekStart] = useState<Date>(getMondayOf(today));
  const [selectedEmpId, setSelectedEmpId] = useState<number | undefined>(undefined);

  // Determine the month string to query
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const weekMonthStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}`;
  const queryMonth = view === "month" ? monthStr : weekMonthStr;

  const { data: entries = [], isLoading } = useGetShiftsCalendar({ month: queryMonth, employeeId: selectedEmpId });
  const { data: _empResponse } = useListEmployees({});
  const employees = _empResponse?.data ?? [];

  // Compute display columns
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return toISO(d);
  });
  const displayDates = view === "month" ? monthDays : weekDays;

  // Group by employee
  const byEmployee = new Map<number, { name: string; code: string; days: Map<string, CalEntry> }>();
  for (const e of entries) {
    if (!byEmployee.has(e.employeeId)) {
      byEmployee.set(e.employeeId, { name: e.employeeName, code: e.employeeCode, days: new Map() });
    }
    byEmployee.get(e.employeeId)!.days.set(e.date, e);
  }

  function prevPeriod() {
    if (view === "month") {
      if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); }
    } else {
      setWeekStart(ws => { const d = new Date(ws); d.setDate(d.getDate() - 7); return d; });
    }
  }
  function nextPeriod() {
    if (view === "month") {
      if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); }
    } else {
      setWeekStart(ws => { const d = new Date(ws); d.setDate(d.getDate() + 7); return d; });
    }
  }

  const periodLabel = view === "month"
    ? monthLabel(year, month)
    : `${toISO(weekStart)} – ${toISO(new Date(weekStart.getTime() + 6 * 86400000))}`;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Shift Calendar</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as "month" | "week"); }}>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
          </ToggleGroup>
          <Select value={selectedEmpId?.toString() ?? "all"} onValueChange={v => setSelectedEmpId(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Employees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees.map((e: Employee) => (
                <SelectItem key={e.id} value={e.id.toString()}>{e.firstName} {e.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={prevPeriod}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="font-medium w-52 text-center">{periodLabel}</span>
            <Button variant="ghost" size="icon" onClick={nextPeriod}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : byEmployee.size === 0 ? (
        <p className="text-muted-foreground">No shift assignments found for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="border px-2 py-1 text-left w-36 sticky left-0 bg-muted z-10">Employee</th>
                {displayDates.map(dateStr => {
                  const d = new Date(dateStr);
                  const dow = d.toLocaleDateString("default", { weekday: "short" });
                  const dayNum = d.getDate();
                  return (
                    <th key={dateStr} className={`border px-1 py-1 text-center ${view === "week" ? "min-w-[120px]" : "min-w-[32px]"}`}>
                      <div>{dayNum}</div>
                      <div className="text-muted-foreground">{dow}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from(byEmployee.entries()).map(([empId, empData]) => (
                <tr key={empId} className="hover:bg-muted/30">
                  <td className="border px-2 py-1 sticky left-0 bg-background z-10">
                    <div className="font-medium">{empData.name}</div>
                    <div className="text-muted-foreground">{empData.code}</div>
                  </td>
                  {displayDates.map(dateStr => {
                    const entry = empData.days.get(dateStr);
                    return (
                      <td key={dateStr} className={`border px-1 py-1 text-center align-top ${view === "week" ? "p-2" : ""}`}>
                        {entry ? (
                          <div className="space-y-0.5">
                            {entry.shiftName && (
                              <div className="font-medium text-primary whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]" title={entry.shiftName}>{entry.shiftName.split(" ")[0]}</div>
                            )}
                            {entry.startTime && (
                              <div className="text-muted-foreground whitespace-nowrap"><Clock className="inline w-2 h-2" />{entry.startTime}</div>
                            )}
                            {entry.attendanceStatus && (
                              <span className={`text-xs px-1 rounded ${STATUS_COLORS[entry.attendanceStatus] ?? ""}`}>
                                {view === "week" ? entry.attendanceStatus : entry.attendanceStatus.split(" ")[0]}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Legend</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(STATUS_COLORS).map(([s, cls]) => (
            <span key={s} className={`text-xs px-2 py-0.5 rounded ${cls}`}>{s}</span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
