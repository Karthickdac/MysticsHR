import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { apiKeysTable, type ApiKeyScope } from "@workspace/db/schema";
import { logAudit } from "./audit";

const KEY_PREFIX_TAG = "mhr_live";
const PREFIX_LEN = 12;
const SECRET_LEN = 32;

export interface IssuedKey {
  prefix: string;
  secret: string;
  fullKey: string;
  hashedSecret: string;
}

/** Mint a fresh API key. The plaintext secret is only returned here, never stored. */
export function issueApiKey(): IssuedKey {
  const prefix = randomBytes(PREFIX_LEN).toString("base64url").slice(0, PREFIX_LEN);
  const secret = randomBytes(SECRET_LEN).toString("base64url").slice(0, SECRET_LEN);
  const fullKey = `${KEY_PREFIX_TAG}_${prefix}_${secret}`;
  const hashedSecret = sha256(secret);
  return { prefix, secret, fullKey, hashedSecret };
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface ParsedKey {
  prefix: string;
  secret: string;
}

function parseAuthHeader(header: string | undefined): ParsedKey | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  // Expect mhr_live_<prefix>_<secret>
  const parts = token.split("_");
  if (parts.length < 4) return null;
  if (`${parts[0]}_${parts[1]}` !== KEY_PREFIX_TAG) return null;
  const prefix = parts[2];
  const secret = parts.slice(3).join("_");
  if (!prefix || !secret) return null;
  return { prefix, secret };
}

/**
 * Record a failed API-key auth attempt for security monitoring. The token
 * itself is never logged — only the prefix (which is non-secret), the reason,
 * the originating IP, and the request path. Fire-and-forget; never blocks.
 */
function auditFailedAuth(req: Request, prefix: string | null, reason: string) {
  void logAudit({
    action: "API_KEY_AUTH_FAIL",
    module: "ApiV1",
    newValue: `reason=${reason} prefix=${prefix ?? "(none)"} path=${req.method} ${req.path}`,
    ipAddress: req.ip,
  });
}

/** Authenticate an inbound request using its `Authorization: Bearer mhr_live_…` header. */
export async function verifyApiKey(req: Request, res: Response, next: NextFunction) {
  const parsed = parseAuthHeader(req.header("authorization"));
  if (!parsed) {
    auditFailedAuth(req, null, "missing_or_malformed");
    res.status(401).json({ error: "Missing or malformed API key" });
    return;
  }

  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.prefix, parsed.prefix))
    .limit(1);

  if (!row) {
    auditFailedAuth(req, parsed.prefix, "unknown_prefix");
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  if (row.revokedAt) {
    auditFailedAuth(req, parsed.prefix, "revoked");
    res.status(401).json({ error: "API key has been revoked" });
    return;
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    auditFailedAuth(req, parsed.prefix, "expired");
    res.status(401).json({ error: "API key has expired" });
    return;
  }

  const candidateHash = sha256(parsed.secret);
  if (!timingSafeStringEqual(candidateHash, row.hashedSecret)) {
    auditFailedAuth(req, parsed.prefix, "bad_secret");
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Fire-and-forget bump; never block the request on this.
  void db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, row.id))
    .catch(() => {});

  req.apiKey = row;
  next();
}

/** Block the request unless the authenticated key has the requested scope. */
export function requireScope(...scopes: ApiKeyScope[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const granted = req.apiKey?.scopes ?? [];
    const ok = scopes.every((s) => granted.includes(s));
    if (!ok) {
      res.status(403).json({
        error: "Forbidden: API key is missing required scope(s)",
        required: scopes,
        granted,
      });
      return;
    }
    next();
  };
}
