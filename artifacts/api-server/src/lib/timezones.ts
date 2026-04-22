/**
 * IANA timezone helpers shared by the employee + system-config routes.
 */

let cachedZones: string[] | null = null;

/** Returns the canonical IANA zone list (cached). */
export function listIanaTimezones(): string[] {
  if (cachedZones) return cachedZones;
  const supported =
    (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
  cachedZones = supported ? supported("timeZone") : [];
  return cachedZones;
}

/** True if `tz` is a valid IANA identifier accepted by Intl. */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
