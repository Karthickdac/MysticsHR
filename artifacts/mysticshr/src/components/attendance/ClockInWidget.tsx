import { useEffect, useState } from "react";
import {
  useGetMyAttendanceToday,
  useClockInMyAttendance,
  useClockOutMyAttendance,
  getGetMyAttendanceTodayQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, LogIn, LogOut, CheckCircle2 } from "lucide-react";

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtElapsed(fromIso: string, now: number): string {
  const ms = now - new Date(fromIso).getTime();
  if (ms < 0) return "0m";
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtMinutes(mins: number | null | undefined): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ClockInWidget() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useGetMyAttendanceToday();
  const clockIn = useClockInMyAttendance();
  const clockOut = useClockOutMyAttendance();
  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState<string>("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  async function handleClockIn() {
    setActionError("");
    try {
      await clockIn.mutateAsync();
      await qc.invalidateQueries({ queryKey: getGetMyAttendanceTodayQueryKey() });
    } catch (e) {
      const err = e as { message?: string };
      setActionError(err?.message ?? "Failed to clock in");
    }
  }

  async function handleClockOut() {
    setActionError("");
    try {
      await clockOut.mutateAsync();
      await qc.invalidateQueries({ queryKey: getGetMyAttendanceTodayQueryKey() });
    } catch (e) {
      const err = e as { message?: string };
      setActionError(err?.message ?? "Failed to clock out");
    }
  }

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Loading attendance…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) return null;

  const status = data.attendanceStatus;
  const record = data.record;
  const shift = data.shift;
  const signInIso = record?.signInTime ?? null;

  const statusBadge =
    status === "Clocked In" ? (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Clocked In</Badge>
    ) : status === "Clocked Out" ? (
      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Clocked Out</Badge>
    ) : (
      <Badge variant="outline">Not Clocked In</Badge>
    );

  return (
    <Card className="border-border">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Today's Attendance
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(data.attendanceDate).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
            </p>
          </div>
          {statusBadge}
        </div>

        {shift && (
          <div className="mb-4 text-xs text-muted-foreground">
            Shift: <span className="font-medium text-foreground">{shift.name}</span> · {shift.startTime}–{shift.endTime} · expected {fmtMinutes(shift.expectedMinutes)}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4 text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Sign In</p>
            <p className="text-sm font-semibold mt-0.5">{fmtTime(signInIso)}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Sign Out</p>
            <p className="text-sm font-semibold mt-0.5">{fmtTime(record?.signOutTime)}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
              {status === "Clocked In" ? "Elapsed" : "Worked"}
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {status === "Clocked In" && signInIso
                ? fmtElapsed(signInIso, now)
                : fmtMinutes(record?.totalMinutesWorked)}
            </p>
          </div>
        </div>

        {actionError && <p className="text-xs text-red-600 mb-2">{actionError}</p>}

        {status === "Not Clocked In" && (
          <Button className="w-full" onClick={handleClockIn} disabled={clockIn.isPending}>
            <LogIn className="w-4 h-4 mr-2" />
            {clockIn.isPending ? "Clocking in…" : "Clock In"}
          </Button>
        )}
        {status === "Clocked In" && (
          <Button className="w-full" variant="default" onClick={handleClockOut} disabled={clockOut.isPending}>
            <LogOut className="w-4 h-4 mr-2" />
            {clockOut.isPending ? "Clocking out…" : "Clock Out"}
          </Button>
        )}
        {status === "Clocked Out" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            You're done for today.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
