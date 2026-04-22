import express, { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  isLocalStorageMode,
  verifyLocalUploadToken,
  writeLocalUpload,
} from "../lib/objectStorage";
import { requireHrmsUser } from "../lib/auth";
import { db } from "../lib/db";
import {
  ticketAttachmentsTable,
  helpdeskTicketsTable,
  employeesTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const HR_ROLES = new Set(["super_admin", "hr_manager", "hr_executive"]);

// Server-side MIME allowlist. Blocks HTML/JS/SVG and other active content
// even if the client is malicious. Mirrors the frontend allowlist but is
// authoritative.
const ALLOWED_CONTENT_TYPES = new Set<string>([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Returns true if the requesting user can access the ticket the attachment
// belongs to. Mirrors checkTicketAccess() in helpdesk.ts: HR roles always
// allowed; the assignee always allowed; the raising employee always allowed;
// HODs allowed when the raiser is on their team (manager-of relationship).
async function userCanAccessAttachment(userId: number, role: string, objectPath: string): Promise<boolean> {
  const [attachment] = await db.select({ ticketId: ticketAttachmentsTable.ticketId })
    .from(ticketAttachmentsTable)
    .where(eq(ticketAttachmentsTable.objectPath, objectPath))
    .limit(1);
  if (!attachment) return false;
  if (HR_ROLES.has(role)) return true;

  const [ticket] = await db.select({
    raisedByEmployeeId: helpdeskTicketsTable.raisedByEmployeeId,
    assignedToUserId: helpdeskTicketsTable.assignedToUserId,
  }).from(helpdeskTicketsTable).where(eq(helpdeskTicketsTable.id, attachment.ticketId));
  if (!ticket) return false;
  if (ticket.assignedToUserId === userId) return true;

  // Find the employee record(s) belonging to this user (used for raised-by + HOD checks).
  const empRows = await db.select({ id: employeesTable.id })
    .from(employeesTable).where(eq(employeesTable.userId, userId));
  if (ticket.raisedByEmployeeId && empRows.some(e => e.id === ticket.raisedByEmployeeId)) return true;

  if (role === "hod" && empRows.length > 0 && ticket.raisedByEmployeeId !== null) {
    const hodEmpIds = empRows.map(e => e.id);
    const reports = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(inArray(employeesTable.managerId, hodEmpIds));
    const teamIds = new Set<number>([...hodEmpIds, ...reports.map(r => r.id)]);
    if (teamIds.has(ticket.raisedByEmployeeId)) return true;
  }

  return false;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireHrmsUser, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      res.status(400).json({ error: "Unsupported file type" });
      return;
    }
    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: "File exceeds 10 MB limit" });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", requireHrmsUser, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const u = req.hrmsUser!;
    const allowed = await userCanAccessAttachment(u.id, u.role, objectPath);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => {
      // We override Content-Type/Disposition below to prevent the browser
      // from rendering attacker-supplied HTML/JS/SVG inline. Drop any
      // upstream values for these headers.
      const lower = key.toLowerCase();
      if (lower === "content-type" || lower === "content-disposition") return;
      res.setHeader(key, value);
    });

    // Look up the original filename and stored content-type from the DB so
    // the download has a sensible name and the type matches what was vetted
    // at upload time.
    const [meta] = await db.select({
      fileName: ticketAttachmentsTable.fileName,
      contentType: ticketAttachmentsTable.contentType,
    }).from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.objectPath, objectPath))
      .limit(1);

    const safeContentType = meta && ALLOWED_CONTENT_TYPES.has(meta.contentType)
      ? meta.contentType
      : "application/octet-stream";
    res.setHeader("Content-Type", safeContentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Force download for non-image/PDF; inline-allow images and PDFs which are
    // safe to render. RFC 6266 quoted filename for safety.
    const inlineSafe = safeContentType.startsWith("image/") || safeContentType === "application/pdf";
    const filename = (meta?.fileName ?? "attachment").replace(/[\r\n"]/g, "");
    res.setHeader(
      "Content-Disposition",
      `${inlineSafe ? "inline" : "attachment"}; filename="${filename}"`,
    );

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * PUT /storage/local-upload/:objectId
 *
 * Local-disk replacement for the GCS signed-URL upload flow. Only enabled
 * when UPLOAD_DIR is set. The :objectId and HMAC token were generated by
 * `getObjectEntityUploadURL()` and embedded in the URL returned to the
 * client. We verify the token, enforce size + MIME limits identically to
 * `request-url`, then persist the body to disk.
 */
router.put(
  "/storage/local-upload/:objectId",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    if (!isLocalStorageMode()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { objectId } = req.params;
    const expiresRaw = String(req.query.expires ?? "");
    const token = String(req.query.token ?? "");
    const expiresAt = Number(expiresRaw);

    if (!objectId || !/^[a-zA-Z0-9_-]+$/.test(objectId)) {
      res.status(400).json({ error: "Invalid object id" });
      return;
    }
    if (!verifyLocalUploadToken(objectId, expiresAt, token)) {
      res.status(403).json({ error: "Invalid or expired upload token" });
      return;
    }

    const contentType = String(req.headers["content-type"] ?? "application/octet-stream");
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      res.status(400).json({ error: "Unsupported file type" });
      return;
    }

    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body)) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File exceeds 10 MB limit" });
      return;
    }

    try {
      await writeLocalUpload(objectId, body, contentType);
      res.status(200).json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "local upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

export default router;
