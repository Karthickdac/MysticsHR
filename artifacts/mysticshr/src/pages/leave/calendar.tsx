import { useState } from "react";
import { useGetLeaveCalendar, useListBlackoutDates, useCreateBlackoutDate, useDeleteBlackoutDate, getListBlackoutDatesQueryKey, getGetLeaveCalendarQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Plus, Trash2, Ban } from "lucide-react";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-200 text-yellow-800",
  "HOD Approved": "bg-blue-200 text-blue-800",
  Approved: "bg-green-200 text-green-800",
  Rejected: "bg-red-200 text-red-700",
  Cancelled: "bg-gray-200 text-gray-500",
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function LeaveCalendarPage() {
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = hrmsRole ?? "employee";
  const isHr = ["super_admin", "hr_manager", "hr_executive"].includes(role);
  const qc = useQueryClient();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [showBlackout, setShowBlackout] = useState(false);
  const [blackoutForm, setBlackoutForm] = useState({ name: "", fromDate: "", toDate: "", reason: "" });

  const month = monthKey(currentDate);
  const { data: entries } = useGetLeaveCalendar({ month });
  const { data: blackouts } = useListBlackoutDates({});
  const createBlackout = useCreateBlackoutDate();
  const deleteBlackout = useDeleteBlackoutDate();

  const year = currentDate.getFullYear();
  const monthIdx = currentDate.getMonth();
  const numDays = daysInMonth(year, monthIdx);
  const firstDay = firstDayOfMonth(year, monthIdx);

  // Build day → entries map
  const dayMap = new Map<string, typeof entries>();
  for (const e of entries ?? []) {
    const from = new Date(e.fromDate);
    const to = new Date(e.toDate);
    const cur = new Date(from);
    while (cur <= to) {
      if (cur.getFullYear() === year && cur.getMonth() === monthIdx) {
        const key = String(cur.getDate());
        if (!dayMap.has(key)) dayMap.set(key, []);
        dayMap.get(key)!.push(e);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Blackouts for this month
  const monthBlackouts = (blackouts ?? []).filter(bo => {
    const from = new Date(bo.fromDate as string);
    const to = new Date(bo.toDate as string);
    const mStart = new Date(year, monthIdx, 1);
    const mEnd = new Date(year, monthIdx + 1, 0);
    return from <= mEnd && to >= mStart;
  });

  function goMonth(delta: number) {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  async function handleCreateBlackout() {
    if (!blackoutForm.name || !blackoutForm.fromDate || !blackoutForm.toDate) return;
    try {
      await createBlackout.mutateAsync({ data: { name: blackoutForm.name, fromDate: blackoutForm.fromDate, toDate: blackoutForm.toDate, reason: blackoutForm.reason || undefined } });
      qc.invalidateQueries({ queryKey: getListBlackoutDatesQueryKey({}) });
      setShowBlackout(false);
      setBlackoutForm({ name: "", fromDate: "", toDate: "", reason: "" });
    } catch { alert("Failed to create blackout period"); }
  }

  async function handleDeleteBlackout(id: number) {
    if (!confirm("Remove this blackout period?")) return;
    await deleteBlackout.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListBlackoutDatesQueryKey({}) });
  }

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">Team leave overview</p>
        </div>
        {isHr && (
          <Button size="sm" variant="outline" onClick={() => setShowBlackout(true)}>
            <Ban className="w-4 h-4 mr-1" />Add Blackout Period
          </Button>
        )}
      </div>

      {/* Calendar */}
      <Card className="border shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={() => goMonth(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <h2 className="font-semibold text-gray-700">{monthName}</h2>
            <Button variant="ghost" size="sm" onClick={() => goMonth(1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: numDays }, (_, i) => i + 1).map(day => {
              const dayEntries = dayMap.get(String(day)) ?? [];
              const isToday = new Date().getDate() === day && new Date().getMonth() === monthIdx && new Date().getFullYear() === year;
              const isBlackout = monthBlackouts.some(bo => {
                const from = new Date(bo.fromDate as string).getDate();
                const to = new Date(bo.toDate as string).getDate();
                return day >= from && day <= to;
              });
              return (
                <div key={day} className={`min-h-[72px] rounded p-1 border ${isToday ? "border-blue-400 bg-blue-50" : "border-gray-100"} ${isBlackout ? "bg-red-50" : ""}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? "text-blue-600" : "text-gray-600"}`}>{day}</div>
                  <div className="space-y-0.5">
                    {dayEntries.slice(0, 3).map((e, idx) => (
                      <div key={idx} className={`text-[10px] rounded px-1 truncate ${STATUS_COLORS[e.status] ?? "bg-gray-100"}`}>
                        {e.employeeName?.split(" ")[0]}
                      </div>
                    ))}
                    {dayEntries.length > 3 && (
                      <div className="text-[10px] text-gray-400">+{dayEntries.length - 3} more</div>
                    )}
                    {isBlackout && (
                      <div className="text-[10px] text-red-500 font-medium">Blackout</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STATUS_COLORS).map(([status, cls]) => (
          <div key={status} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded ${cls}`} />
            <span className="text-xs text-gray-500">{status}</span>
          </div>
        ))}
      </div>

      {/* Blackout dates list */}
      {isHr && (blackouts ?? []).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Blackout Periods</h2>
          <div className="space-y-2">
            {(blackouts ?? []).map((bo) => (
              <div key={bo.id} className="flex items-center justify-between bg-red-50 border border-red-100 rounded p-3">
                <div>
                  <div className="font-medium text-sm text-red-700">{bo.name}</div>
                  <div className="text-xs text-red-500">
                    {new Date(bo.fromDate as string).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    {" — "}
                    {new Date(bo.toDate as string).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    {bo.reason && ` • ${bo.reason}`}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDeleteBlackout(bo.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entries for this month */}
      {(entries ?? []).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Leaves in {monthName}</h2>
          <div className="space-y-2">
            {(entries ?? []).map((e) => (
              <div key={e.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <div className="font-medium text-sm">{e.employeeName}</div>
                  <div className="text-xs text-gray-500">
                    {e.leaveTypeCode} • {new Date(e.fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – {new Date(e.toDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ({e.totalDays}d)
                    {e.departmentName && ` • ${e.departmentName}`}
                  </div>
                </div>
                <Badge className={STATUS_COLORS[e.status] ?? ""}>{e.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blackout date creation dialog */}
      <Dialog open={showBlackout} onOpenChange={setShowBlackout}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Blackout Period</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={blackoutForm.name} onChange={e => setBlackoutForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Year End Freeze" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From Date *</Label>
                <Input type="date" value={blackoutForm.fromDate} onChange={e => setBlackoutForm(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div>
                <Label>To Date *</Label>
                <Input type="date" value={blackoutForm.toDate} onChange={e => setBlackoutForm(f => ({ ...f, toDate: e.target.value }))} min={blackoutForm.fromDate} />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={blackoutForm.reason} onChange={e => setBlackoutForm(f => ({ ...f, reason: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlackout(false)}>Cancel</Button>
            <Button onClick={handleCreateBlackout} disabled={!blackoutForm.name || !blackoutForm.fromDate || !blackoutForm.toDate || createBlackout.isPending}>
              {createBlackout.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
