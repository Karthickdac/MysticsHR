export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

let cached: string[] | null = null;

export function listTimezones(): string[] {
  if (cached) return cached;
  const supported =
    (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
  cached = supported ? supported("timeZone") : FALLBACK_TIMEZONES;
  return cached;
}
