import { db } from "./db";
import { systemSettingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Suspicion configuration for clock-in evaluation. Persisted as a single
 * row in `system_settings` (category = "attendance_suspicion", key = "config").
 * HR can tune the thresholds and the list of registered offices through
 * the system-config UI; sensible defaults apply if the row is missing.
 */
export interface AttendanceSuspicionOffice {
  name: string;
  latitude: number;
  longitude: number;
}

export interface AttendanceSuspicionConfig {
  /** GPS accuracy worse than this (in metres) is flagged as low-confidence. */
  maxAccuracyMeters: number;
  /** Distance further than this from every registered office is flagged. */
  maxRadiusMeters: number;
  /** Registered office locations. Empty list disables the radius rule. */
  offices: AttendanceSuspicionOffice[];
}

export const DEFAULT_ATTENDANCE_SUSPICION_CONFIG: AttendanceSuspicionConfig = {
  maxAccuracyMeters: 200,
  maxRadiusMeters: 500,
  offices: [],
};

const CATEGORY = "attendance_suspicion";
const KEY = "config";

function clampNumber(v: unknown, fallback: number, min: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function normalizeOffices(value: unknown): AttendanceSuspicionOffice[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((o): AttendanceSuspicionOffice | null => {
      if (!o || typeof o !== "object") return null;
      const name = String((o as { name?: unknown }).name ?? "").trim();
      const latitude = Number((o as { latitude?: unknown }).latitude);
      const longitude = Number((o as { longitude?: unknown }).longitude);
      if (!name) return null;
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
      return { name, latitude, longitude };
    })
    .filter((o): o is AttendanceSuspicionOffice => o !== null);
}

export async function loadAttendanceSuspicionConfig(): Promise<AttendanceSuspicionConfig> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(and(eq(systemSettingsTable.category, CATEGORY), eq(systemSettingsTable.key, KEY)))
    .limit(1);
  if (!row || !row.value || typeof row.value !== "object") return DEFAULT_ATTENDANCE_SUSPICION_CONFIG;
  const v = row.value as Record<string, unknown>;
  return {
    maxAccuracyMeters: clampNumber(v["maxAccuracyMeters"], DEFAULT_ATTENDANCE_SUSPICION_CONFIG.maxAccuracyMeters, 0),
    maxRadiusMeters: clampNumber(v["maxRadiusMeters"], DEFAULT_ATTENDANCE_SUSPICION_CONFIG.maxRadiusMeters, 0),
    offices: normalizeOffices(v["offices"]),
  };
}

export async function saveAttendanceSuspicionConfig(input: Partial<AttendanceSuspicionConfig>): Promise<AttendanceSuspicionConfig> {
  const current = await loadAttendanceSuspicionConfig();
  const merged: AttendanceSuspicionConfig = {
    maxAccuracyMeters: clampNumber(input.maxAccuracyMeters, current.maxAccuracyMeters, 0),
    maxRadiusMeters: clampNumber(input.maxRadiusMeters, current.maxRadiusMeters, 0),
    offices: input.offices ? normalizeOffices(input.offices) : current.offices,
  };
  const [existing] = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(and(eq(systemSettingsTable.category, CATEGORY), eq(systemSettingsTable.key, KEY)))
    .limit(1);
  if (existing) {
    await db
      .update(systemSettingsTable)
      .set({ value: merged, updatedAt: new Date() })
      .where(eq(systemSettingsTable.id, existing.id));
  } else {
    await db.insert(systemSettingsTable).values({ category: CATEGORY, key: KEY, value: merged });
  }
  return merged;
}

/** Great-circle distance in metres between two WGS-84 points. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type SuspicionFlagCode = "MISSING_GPS" | "LOW_ACCURACY" | "OUT_OF_RADIUS";

export interface SuspicionFlag {
  code: SuspicionFlagCode;
  /** Human-friendly reason shown in the badge tooltip. */
  reason: string;
}

export interface AttendanceLikeRecord {
  signInTime: Date | string | null | undefined;
  signInLatitude: string | number | null | undefined;
  signInLongitude: string | number | null | undefined;
  signInAccuracyMeters: number | null | undefined;
}

/**
 * Evaluate a single attendance row against the suspicion configuration.
 * Returns an empty array when the row is not flagged. Rows without a
 * sign-in time are skipped (no clock-in to evaluate).
 */
export function evaluateSuspicion(record: AttendanceLikeRecord, config: AttendanceSuspicionConfig): SuspicionFlag[] {
  if (!record.signInTime) return [];
  const flags: SuspicionFlag[] = [];

  const lat = record.signInLatitude == null ? null : Number(record.signInLatitude);
  const lng = record.signInLongitude == null ? null : Number(record.signInLongitude);
  const hasGps = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);

  if (!hasGps) {
    flags.push({
      code: "MISSING_GPS",
      reason: "No GPS captured at clock-in (employee may have denied location permission).",
    });
    return flags;
  }

  const accuracy = record.signInAccuracyMeters;
  if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > config.maxAccuracyMeters) {
    flags.push({
      code: "LOW_ACCURACY",
      reason: `GPS accuracy ±${Math.round(accuracy)}m exceeds the ${config.maxAccuracyMeters}m threshold.`,
    });
  }

  if (config.offices.length > 0) {
    let nearest = Infinity;
    let nearestName = "";
    for (const office of config.offices) {
      const d = haversineMeters(lat as number, lng as number, office.latitude, office.longitude);
      if (d < nearest) {
        nearest = d;
        nearestName = office.name;
      }
    }
    if (nearest > config.maxRadiusMeters) {
      flags.push({
        code: "OUT_OF_RADIUS",
        reason: `Clock-in is ${Math.round(nearest)}m from the nearest registered office (${nearestName}); threshold is ${config.maxRadiusMeters}m.`,
      });
    }
  }

  return flags;
}
