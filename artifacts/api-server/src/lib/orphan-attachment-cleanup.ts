import { inArray, eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  ticketAttachmentsTable,
  helpdeskTicketsTable,
  storageCleanupRunsTable,
  candidatesTable,
  offerLettersTable,
  preOnboardingDocumentsTable,
  employeeDocumentsTable,
  employeesTable,
  leaveApplicationsTable,
} from "@workspace/db/schema";
import { db } from "./db";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

/**
 * Registry of DB tables/columns that may reference an object-storage path
 * produced by the presigned-upload flow (paths shaped like
 * `/objects/uploads/<id>`). The orphan cleanup considers a stored file to
 * be "in use" when ANY of these sources contains a matching path, so all of
 * them must be checked before a file is deleted.
 *
 * To add a new module that stores presigned-upload paths:
 *   1. Add a `text("object_path")` (or similar) column to that module's
 *      schema and persist `objectStorageService.normalizeObjectEntityPath()`
 *      output into it.
 *   2. Append a new entry to this array with a stable `name` for logs.
 * The cleanup will then automatically protect those rows from deletion.
 */
type TrackedSource = {
  /** Stable, log-friendly identifier (e.g. "ticket_attachments"). */
  name: string;
  table: PgTable;
  column: AnyPgColumn;
};

export const TRACKED_OBJECT_PATH_SOURCES: ReadonlyArray<TrackedSource> = [
  // The canonical, fully-adopted source: helpdesk attachments persist the
  // normalized `/objects/uploads/<id>` path returned by the presigned-upload
  // flow.
  {
    name: "ticket_attachments.object_path",
    table: ticketAttachmentsTable,
    column: ticketAttachmentsTable.objectPath,
  },
  // The columns below currently store mostly external URLs or pasted links,
  // but they are reachable from upload-style UIs and could legitimately
  // contain a `/objects/uploads/<id>` value (for example if a future
  // migration switches them over to the presigned-upload flow). Including
  // them now is a cheap safety net: the candidate list is already filtered
  // to `/objects/uploads/<id>`-shaped paths, so an unrelated external URL in
  // these columns can never accidentally match a real candidate, but a
  // genuine object-storage reference will be correctly protected.
  {
    name: "helpdesk_tickets.attachment_url",
    table: helpdeskTicketsTable,
    column: helpdeskTicketsTable.attachmentUrl,
  },
  {
    name: "candidates.resume_url",
    table: candidatesTable,
    column: candidatesTable.resumeUrl,
  },
  {
    name: "offer_letters.letter_url",
    table: offerLettersTable,
    column: offerLettersTable.letterUrl,
  },
  {
    name: "pre_onboarding_documents.file_url",
    table: preOnboardingDocumentsTable,
    column: preOnboardingDocumentsTable.fileUrl,
  },
  {
    name: "employee_documents.file_url",
    table: employeeDocumentsTable,
    column: employeeDocumentsTable.fileUrl,
  },
  {
    name: "employees.avatar_url",
    table: employeesTable,
    column: employeesTable.avatarUrl,
  },
  {
    name: "leave_applications.document_url",
    table: leaveApplicationsTable,
    column: leaveApplicationsTable.documentUrl,
  },
];

export interface OrphanCleanupResult {
  scanned: number;
  candidates: number;
  orphans: number;
  deleted: number;
  errors: number;
  ageDays: number;
  dryRun: boolean;
  runId?: number;
}

interface CleanupOptions {
  ageDays?: number;
  dryRun?: boolean;
  triggeredBy?: string; // 'cron' | 'manual:<userId>'
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
 *   - have no matching row in ANY table listed in
 *     `TRACKED_OBJECT_PATH_SOURCES`.
 *
 * Files newer than the age threshold are skipped to avoid racing with
 * in-flight uploads or attachments that haven't been linked yet.
 */
export async function cleanupOrphanedAttachments(
  opts: CleanupOptions = {},
): Promise<OrphanCleanupResult> {
  const startedAt = new Date();
  const startMs = Date.now();
  const triggeredBy = opts.triggeredBy ?? "cron";
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

  // Best-effort: insert a "started" row so admins can see in-flight runs.
  // If the insert fails (e.g. table missing during migration), we still run.
  let runId: number | undefined;
  try {
    const [row] = await db.insert(storageCleanupRunsTable).values({
      startedAt,
      ageDays: result.ageDays,
      dryRun,
      triggeredBy,
    }).returning({ id: storageCleanupRunsTable.id });
    runId = row?.id;
    result.runId = runId;
  } catch (err) {
    logger.warn({ err }, "[orphan-cleanup] failed to insert run record");
  }

  async function persist(errorMessage?: string) {
    if (!runId) return;
    try {
      await db.update(storageCleanupRunsTable).set({
        finishedAt: new Date(),
        scanned: result.scanned,
        candidates: result.candidates,
        orphans: result.orphans,
        deleted: result.deleted,
        errors: result.errors,
        ageDays: result.ageDays,
        dryRun: result.dryRun,
        durationMs: Date.now() - startMs,
        errorMessage: errorMessage ?? null,
      }).where(eq(storageCleanupRunsTable.id, runId));
    } catch (err) {
      logger.warn({ err, runId }, "[orphan-cleanup] failed to update run record");
    }
  }

  if (!Number.isFinite(ageDays)) {
    logger.error({ rawAge }, "[orphan-cleanup] invalid ATTACHMENT_CLEANUP_AGE_DAYS; skipping run");
    await persist("Invalid ATTACHMENT_CLEANUP_AGE_DAYS configuration");
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
    await persist("PRIVATE_OBJECT_DIR not resolvable");
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
    await persist("Failed to list objects from storage");
    return result;
  }

  result.candidates = candidates.length;
  if (candidates.length === 0) {
    logger.info({ ...result }, "[orphan-cleanup] nothing to clean");
    await persist();
    return result;
  }

  // Build all path variants under which a row may have been persisted.
  // `normalizeObjectEntityPath()` historically can emit either
  // `/objects/uploads/<id>` (canonical) or `/objects//uploads/<id>`
  // (when PRIVATE_OBJECT_DIR has a trailing slash). We must consider a
  // file "known" if EITHER form exists in any tracked table, otherwise
  // we would incorrectly delete a live attachment.
  function pathVariants(canonical: string): string[] {
    const doubled = canonical.replace("/objects/uploads/", "/objects//uploads/");
    return canonical === doubled ? [canonical] : [canonical, doubled];
  }

  // Find which candidate paths have matching DB rows across every tracked
  // source. We query the union of all variants per source, in chunks, and
  // mark the canonical form known when ANY variant is found in ANY source.
  // If any source's lookup fails we abort the whole run instead of
  // proceeding — partial knowledge could lead to false positives where a
  // live file is deleted because a different table that did reference it
  // was unreachable.
  const knownVariants = new Set<string>();
  const allLookupPaths = candidates.flatMap((c) => pathVariants(c.objectPath));
  for (const source of TRACKED_OBJECT_PATH_SOURCES) {
    let sourceMatches = 0;
    for (const group of chunk(allLookupPaths, DB_LOOKUP_CHUNK)) {
      try {
        const rows = await db
          .select({ objectPath: source.column })
          .from(source.table)
          .where(inArray(source.column, group));
        for (const r of rows) {
          const v = r.objectPath as string | null;
          if (v) {
            knownVariants.add(v);
            sourceMatches += 1;
          }
        }
      } catch (err) {
        logger.error(
          { err, source: source.name },
          "[orphan-cleanup] DB lookup failed; aborting to avoid false positives",
        );
        await persist(`DB lookup failed for ${source.name}; aborted to avoid false positives`);
        return result;
      }
    }
    logger.debug(
      { source: source.name, matched: sourceMatches },
      "[orphan-cleanup] tracked source scanned",
    );
  }

  const orphans = candidates.filter(
    (c) => !pathVariants(c.objectPath).some((v) => knownVariants.has(v)),
  );
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
  await persist();
  return result;
}
