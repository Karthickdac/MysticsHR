import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract a user-facing error message from an unknown catch value.
 * Handles axios-style errors that carry response.data.error.
 */
export function extractError(err: unknown, fallback: string): string {
  if (
    err != null &&
    typeof err === "object" &&
    "response" in err &&
    err.response != null &&
    typeof err.response === "object" &&
    "data" in err.response &&
    err.response.data != null &&
    typeof err.response.data === "object" &&
    "error" in err.response.data &&
    typeof (err.response.data as Record<string, unknown>).error === "string"
  ) {
    return (err.response.data as Record<string, string>).error;
  }
  return fallback;
}
