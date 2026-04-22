import { randomBytes } from "node:crypto";
import { db } from "./db";
import { documentDownloadTokensTable } from "@workspace/db/schema";

/**
 * Default validity for emailed direct-download links to relieving documents.
 * Overridable per call; also tunable via the RELIEVING_LINK_VALIDITY_DAYS env
 * var so deployments can tighten/loosen the window without a code change.
 */
export const DEFAULT_DOC_LINK_VALIDITY_DAYS = (() => {
  const raw = process.env.RELIEVING_LINK_VALIDITY_DAYS;
  if (!raw) return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
})();

/**
 * Resolve the public app base URL for emailed links. Production deployments
 * should set APP_URL; in the Replit dev preview we fall back to
 * REPLIT_DEV_DOMAIN. Returns "" if neither is available so callers can decide
 * to skip the email rather than send a broken link.
 */
export function getAppBaseUrl(): string {
  const appUrl = process.env.APP_URL;
  if (appUrl) return appUrl.replace(/\/$/, "");
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`.replace(/\/$/, "");
  return "";
}

/**
 * Issue a single-document download token. The returned URL is meant to be
 * embedded in an email; opening it hits the public download endpoint, which
 * validates expiry, streams the file, and increments the per-link audit
 * counter. Token is 32 random bytes (base64url) — non-guessable.
 */
export async function issueDocumentDownloadToken(opts: {
  issuedDocumentId: number;
  validityDays?: number;
  createdByUserId?: number | null;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const validityDays = opts.validityDays ?? DEFAULT_DOC_LINK_VALIDITY_DAYS;
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");

  await db.insert(documentDownloadTokensTable).values({
    issuedDocumentId: opts.issuedDocumentId,
    token,
    expiresAt,
    createdByUserId: opts.createdByUserId ?? null,
  });

  const base = getAppBaseUrl();
  const url = base
    ? `${base}/api/documents/public/download/${token}`
    : `/api/documents/public/download/${token}`;

  return { token, url, expiresAt };
}
