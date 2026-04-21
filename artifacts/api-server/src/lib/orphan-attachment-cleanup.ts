import { inArray } from "drizzle-orm";
import { ticketAttachmentsTable } from "@workspace/db/schema";
import { db } from "./db";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

export interface OrphanCleanupResult {
  scanned: number;
  candidates: number;
  orphans: number;
  deleted: number;
  errors: number;
  ageDays: number;
  dryRun: boolean;
}

interface CleanupOptions {
  ageDays?: number;
  dryRun?: boolean;
}

const DB_LOOKUP_CHUNK = 500;

function parsePrivateDir(): { bucketName: string; listPrefix: string; prefixCandidates: string[] } {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR not set");
  }
  const normalized = dir.startsWith("/") ? dir.slice(1) : dir;
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length < 1) {
    throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${dir}`);
  }
  const bucketName = parts[0];
  const prefixDir = parts.slice(1).join("/");
  // Listing prefix used to enumerate objects from GCS.
  const listPrefix = prefixDir ? `${prefixDir}/` : "";
  // Accept both the canonical `<prefixDir>/uploads/` form and the
  // double-slash form `<prefixDir>//uploads/` that getObjectEntityUploadURL
  // can emit when PRIVATE_OBJECT_DIR has a trailing slash. Both must be
  // stripped to recover the entity id.
  const prefixCandidates = prefixDir
    ? [`${prefixDir}/uploads/`, `${prefixDir}//uploads/`]
    : ["uploads/", "/uploads/"];
  return { bucketName, listPrefix, prefixCandidates };
}

function objectNameToEntityPath(objectName: string, prefixCandidates: string[]): string | null {
  for (const prefix of prefixCandidates) {
    if (!objectName.startsWith(prefix)) continue;
    const tail = objectName.slice(prefix.length);
    if (!tail || tail.endsWith("/")) return null;
    return `/objects/uploads/${tail}`;
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Find and delete object-storage files under PRIVATE_OBJECT_DIR/uploads/ that:
 *   - are older than `ageDays` (default 7), AND
 *   - have no matching `ticket_attachments.object_path` row.
 *
 * Files newer than the age threshold are skipped to avoid racing with
 * in-flight uploads or attachments that haven't been linked yet.
 */
export async function cleanupOrphanedAttachments(
  opts: CleanupOptions = {},
): Promise<OrphanCleanupResult> {
  // Strict validation: a misconfigured ATTACHMENT_CLEANUP_AGE_DAYS must
  // never silently disable the age guard and let recent uploads be deleted.
  const rawAge = opts.ageDays ?? process.env.ATTACHMENT_CLEANUP_AGE_DAYS ?? 7;
  const parsedAge = typeof rawAge === "number" ? rawAge : Number(rawAge);
  const ageDays = Number.isFinite(parsedAge) && parsedAge >= 1 ? Math.floor(parsedAge) : NaN;
  const dryRun = opts.dryRun ?? false;

  const result: OrphanCleanupResult = {
    scanned: 0,
    candidates: 0,
    orphans: 0,
    deleted: 0,
    errors: 0,
    ageDays: Number.isFinite(ageDays) ? ageDays : 0,
    dryRun,
  };

  if (!Number.isFinite(ageDays)) {
    logger.error({ rawAge }, "[orphan-cleanup] invalid ATTACHMENT_CLEANUP_AGE_DAYS; skipping run");
    return result;
  }
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;

  let bucketName: string;
  let listPrefix: string;
  let prefixCandidates: string[];
  try {
    ({ bucketName, listPrefix, prefixCandidates } = parsePrivateDir());
  } catch (err) {
    logger.error({ err }, "[orphan-cleanup] could not resolve PRIVATE_OBJECT_DIR; skipping");
    return result;
  }

  const bucket = objectStorageClient.bucket(bucketName);

  type Candidate = { objectName: string; objectPath: string };
  const candidates: Candidate[] = [];

  try {
    const [files] = await bucket.getFiles({ prefix: listPrefix });
    for (const file of files) {
      result.scanned += 1;
      const created = file.metadata?.timeCreated
        ? Date.parse(String(file.metadata.timeCreated))
        : NaN;
      if (!Number.isFinite(created) || created > cutoff) continue;
      const entityPath = objectNameToEntityPath(file.name, prefixCandidates);
      if (!entityPath) continue;
      candidates.push({ objectName: file.name, objectPath: entityPath });
    }
  } catch (err) {
    logger.error({ err, bucketName, listPrefix }, "[orphan-cleanup] failed to list objects");
    return result;
  }

  result.candidates = candidates.length;
  if (candidates.length === 0) {
    logger.info({ ...result }, "[orphan-cleanup] nothing to clean");
    return result;
  }

  // Find which candidate paths have matching DB rows (in chunks for safety).
  const knownPaths = new Set<string>();
  for (const group of chunk(candidates, DB_LOOKUP_CHUNK)) {
    const paths = group.map((c) => c.objectPath);
    try {
      const rows = await db
        .select({ objectPath: ticketAttachmentsTable.objectPath })
        .from(ticketAttachmentsTable)
        .where(inArray(ticketAttachmentsTable.objectPath, paths));
      for (const r of rows) knownPaths.add(r.objectPath);
    } catch (err) {
      logger.error({ err }, "[orphan-cleanup] DB lookup failed; aborting to avoid false positives");
      return result;
    }
  }

  const orphans = candidates.filter((c) => !knownPaths.has(c.objectPath));
  result.orphans = orphans.length;

  for (const orphan of orphans) {
    if (dryRun) {
      logger.info({ objectName: orphan.objectName }, "[orphan-cleanup] dry-run: would delete");
      continue;
    }
    try {
      await bucket.file(orphan.objectName).delete({ ignoreNotFound: true });
      result.deleted += 1;
    } catch (err) {
      result.errors += 1;
      logger.warn({ err, objectName: orphan.objectName }, "[orphan-cleanup] delete failed");
    }
  }

  logger.info({ ...result }, "[orphan-cleanup] completed");
  return result;
}
