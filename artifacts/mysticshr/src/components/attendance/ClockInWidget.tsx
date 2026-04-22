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

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtElapsed(fromIso: string, now: number): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

function fmtMinutes(mins: number | null | undefined): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ClockInWidget() {
  const qc = useQueryClient();
  // Send the employee's local calendar date so a punch made just after
  // local midnight is credited to the right day even if the server runs
  // in UTC. Recomputed each render so it updates if the user crosses
  // midnight without reloading.
  const localDate = localDateStr(new Date());
  const { data, isLoading, error } = useGetMyAttendanceToday({ date: localDate });
  const clockIn = useClockInMyAttendance();
  const clockOut = useClockOutMyAttendance();
  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState<string>("");

  // Tick every second to drive both the "Elapsed" timer (when clocked in)
  // and the live wall clock displayed next to it. Pauses cleanly when the
  // tab is hidden so we don't waste re-renders for an unseen widget.
  // No network calls — purely client-side.
  const isClockedIn = data?.attendanceStatus === "Clocked In" && !!data?.record?.signInTime;
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (t !== null) return;
      setNow(Date.now());
      t = setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = () => {
      if (t === null) return;
      clearInterval(t);
      t = null;
    };
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (typeof document === "undefined" || document.visibilityState === "visible") start();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, []);

  // Locale-aware HH:MM:SS so 12h vs 24h follows the user's system.
  const wallClock = new Date(now).toLocaleTimeString();

  // Resolve geolocation if the browser supports it and the user grants
  // permission. Always returns a payload — at minimum the userAgent so HR
  // gets device info even if location is denied. We never block the punch
  // on this lookup and cap it at 8s so a stalled GPS doesn't lock the UI.
  async function collectTelemetry(): Promise<{ latitude?: number; longitude?: number; accuracy?: number; userAgent: string; clientDate: string; timezone: string }> {
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const clientDate = localDateStr(new Date());
    // Best-effort capture of the browser's IANA zone so HR can disambiguate
    // the timestamp later in the override dialog (Task #147). Falls back
    // to "UTC" if the runtime can't report one.
    let timezone = "UTC";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      timezone = "UTC";
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return { userAgent, clientDate, timezone };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (extra: Partial<{ latitude: number; longitude: number; accuracy: number }> = {}) => {
        if (settled) return;
        settled = true;
        resolve({ ...extra, userAgent, clientDate, timezone });
      };
      const t = setTimeout(() => finish(), 8000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(t); finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
        () => { clearTimeout(t); finish(); },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 },
      );
    });
  }

  async function handleClockIn() {
    setActionError("");
    try {
      const data = await collectTelemetry();
      await clockIn.mutateAsync({ data });
      await qc.invalidateQueries({ queryKey: getGetMyAttendanceTodayQueryKey() });
    } catch (e) {
      const err = e as { message?: string };
      setActionError(err?.message ?? "Failed to clock in");
    }
  }

  async function handleClockOut() {
    setActionError("");
    try {
      const data = await collectTelemetry();
      await clockOut.mutateAsync({ data });
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
              {isClockedIn ? "Now / Elapsed" : "Now / Worked"}
            </p>
            <p className="text-sm font-semibold mt-0.5 tabular-nums" data-testid="text-attendance-now-elapsed">
              <span data-testid="text-wall-clock">{wallClock}</span>
              <span className="text-muted-foreground"> · </span>
              <span data-testid="text-elapsed-or-worked">
                {isClockedIn && signInIso
                  ? fmtElapsed(signInIso, now)
                  : fmtMinutes(record?.totalMinutesWorked)}
              </span>
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
