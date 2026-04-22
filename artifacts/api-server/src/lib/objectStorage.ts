import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import * as fs from "fs/promises";
import { createReadStream, type ReadStream } from "fs";
import * as path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// ---------------------------------------------------------------------------
// Local-disk mode
// ---------------------------------------------------------------------------
// When `UPLOAD_DIR` is set (typically on a self-hosted VPS), the entire
// storage subsystem switches to writing files to a local directory instead
// of calling Replit's GCS sidecar. The public surface of this module is
// unchanged, so all callers (routes/storage.ts, orphan-attachment-cleanup,
// etc.) continue to work without modification.
// ---------------------------------------------------------------------------

export function isLocalStorageMode(): boolean {
  return !!process.env.UPLOAD_DIR;
}

function localUploadDir(): string {
  const dir = process.env.UPLOAD_DIR;
  if (!dir) throw new Error("UPLOAD_DIR not set");
  return dir;
}

function localPrivateDir(): string {
  return path.join(localUploadDir(), "uploads");
}

function localPublicDir(): string {
  return path.join(localUploadDir(), "public");
}

function uploadSigningSecret(): string {
  const s =
    process.env.UPLOAD_SIGNING_SECRET ||
    process.env.CLERK_SECRET_KEY ||
    process.env.DATABASE_URL ||
    "mysticshr-local-fallback-secret";
  return s;
}

export function signLocalUploadToken(id: string, expiresAt: number): string {
  const payload = `${id}.${expiresAt}`;
  return createHmac("sha256", uploadSigningSecret()).update(payload).digest("hex");
}

export function verifyLocalUploadToken(
  id: string,
  expiresAt: number,
  token: string,
): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = signLocalUploadToken(id, expiresAt);
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

function safeJoin(base: string, rel: string): string {
  const resolved = path.resolve(base, rel);
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new ObjectNotFoundError();
  }
  return resolved;
}

// Minimal GCS-File-shaped wrapper around a local file. Implements only the
// surface used by this module, objectAcl.ts, and orphan-attachment-cleanup.ts.
class LocalFile {
  readonly name: string; // e.g. "uploads/<uuid>"
  readonly absPath: string;
  readonly metadataPath: string;
  metadata: Record<string, any> = {};

  constructor(name: string, absPath: string) {
    this.name = name;
    this.absPath = absPath;
    this.metadataPath = `${absPath}.meta.json`;
  }

  async exists(): Promise<[boolean]> {
    try {
      await fs.access(this.absPath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[Record<string, any>]> {
    let stat: import("fs").Stats | null = null;
    try {
      stat = await fs.stat(this.absPath);
    } catch {
      return [{ ...this.metadata }];
    }
    let stored: Record<string, any> = {};
    try {
      const raw = await fs.readFile(this.metadataPath, "utf-8");
      stored = JSON.parse(raw);
    } catch {
      // No sidecar metadata yet.
    }
    const merged = {
      ...stored,
      size: stat.size,
      timeCreated: stat.birthtime?.toISOString?.() ?? stat.mtime.toISOString(),
      updated: stat.mtime.toISOString(),
      contentType: stored.contentType ?? "application/octet-stream",
      metadata: stored.metadata ?? {},
    };
    this.metadata = merged;
    return [merged];
  }

  async setMetadata(update: Record<string, any>): Promise<void> {
    let current: Record<string, any> = {};
    try {
      current = JSON.parse(await fs.readFile(this.metadataPath, "utf-8"));
    } catch {
      // ignore
    }
    const next = { ...current };
    if (update.contentType) next.contentType = update.contentType;
    if (update.metadata) {
      next.metadata = { ...(current.metadata ?? {}), ...update.metadata };
    }
    await fs.writeFile(this.metadataPath, JSON.stringify(next), "utf-8");
  }

  createReadStream(): ReadStream {
    return createReadStream(this.absPath);
  }

  async delete(): Promise<void> {
    await fs.unlink(this.absPath).catch(() => {});
    await fs.unlink(this.metadataPath).catch(() => {});
  }
}

class LocalBucket {
  readonly name: string;
  readonly rootDir: string;

  constructor(name: string, rootDir: string) {
    this.name = name;
    this.rootDir = rootDir;
  }

  file(objectName: string): LocalFile {
    const abs = safeJoin(this.rootDir, objectName);
    return new LocalFile(objectName, abs);
  }

  // Mimics gcs Bucket.getFiles({ prefix }) → returns [files[]] tuple.
  async getFiles(opts: { prefix?: string } = {}): Promise<[LocalFile[]]> {
    const prefix = opts.prefix ?? "";
    const out: LocalFile[] = [];
    async function walk(this: LocalBucket, dir: string, rel: string) {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const childAbs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk.call(this, childAbs, childRel);
        } else if (entry.isFile()) {
          if (childRel.endsWith(".meta.json")) continue;
          if (!childRel.startsWith(prefix)) continue;
          const lf = new LocalFile(childRel, childAbs);
          // Eagerly populate `metadata` so callers that read
          // `file.metadata.timeCreated` (e.g. orphan cleanup) work without
          // an extra round-trip.
          await lf.getMetadata();
          out.push(lf);
        }
      }
    }
    await walk.call(this, this.rootDir, "");
    return [out];
  }
}

class LocalStorageClient {
  bucket(name: string): LocalBucket {
    // In local mode there is a single logical bucket. We accept any name and
    // root every bucket at UPLOAD_DIR. orphan-attachment-cleanup parses
    // PRIVATE_OBJECT_DIR's bucket name and passes it here; ignoring the name
    // is safe because everything lives under one local root.
    return new LocalBucket(name, localUploadDir());
  }
}

// Lazily construct the GCS client so installs that never use it (local mode)
// don't fail if the sidecar is unreachable.
let _gcsClient: Storage | null = null;
function gcsClient(): Storage {
  if (_gcsClient) return _gcsClient;
  _gcsClient = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  return _gcsClient;
}

// Public client export. In local mode this is a LocalStorageClient that
// duck-types the small slice of the GCS Storage API actually used.
export const objectStorageClient: any = isLocalStorageMode()
  ? new LocalStorageClient()
  : gcsClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    if (isLocalStorageMode()) {
      // In local mode there is exactly one public root.
      return [localPublicDir()];
    }
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    if (isLocalStorageMode()) {
      // Synthesise a GCS-shaped path so existing parsers in
      // orphan-attachment-cleanup keep working: bucket="local", prefix="".
      return "/local";
    }
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (isLocalStorageMode()) {
      const abs = safeJoin(localPublicDir(), filePath);
      try {
        await fs.access(abs);
        return new LocalFile(filePath, abs) as unknown as File;
      } catch {
        return null;
      }
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = gcsClient().bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream as any) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    if (isLocalStorageMode()) {
      const objectId = randomUUID();
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const token = signLocalUploadToken(objectId, expiresAt);
      const base = (process.env.APP_URL || "").replace(/\/+$/, "");
      // Path-relative URL when APP_URL not set; absolute when configured.
      const prefix = base ? `${base}/api` : "/api";
      return `${prefix}/storage/local-upload/${objectId}?expires=${expiresAt}&token=${token}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error("PRIVATE_OBJECT_DIR not set.");
    }
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");

    if (isLocalStorageMode()) {
      const objectName = entityId.startsWith("uploads/") ? entityId : `uploads/${entityId}`;
      const abs = safeJoin(localUploadDir(), objectName);
      try {
        await fs.access(abs);
      } catch {
        throw new ObjectNotFoundError();
      }
      return new LocalFile(objectName, abs) as unknown as File;
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = gcsClient().bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (isLocalStorageMode()) {
      // Local upload URLs look like:
      //   http(s)://host/api/storage/local-upload/<uuid>?expires=...&token=...
      // or path-relative: /api/storage/local-upload/<uuid>?...
      const match = rawPath.match(/\/api\/storage\/local-upload\/([^/?#]+)/);
      if (match) {
        return `/objects/uploads/${match[1]}`;
      }
      return rawPath;
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) objectEntityDir = `${objectEntityDir}/`;
    if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

// Used by the local-upload PUT route.
export async function writeLocalUpload(
  objectId: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const dir = localPrivateDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  const abs = safeJoin(localUploadDir(), `uploads/${objectId}`);
  await fs.writeFile(abs, body, { mode: 0o640 });
  const meta = {
    contentType,
    metadata: {},
  };
  await fs.writeFile(`${abs}.meta.json`, JSON.stringify(meta), "utf-8");
}

function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  if (!p.startsWith("/")) p = `/${p}`;
  const pathParts = p.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return {
    bucketName: pathParts[1],
    objectName: pathParts.slice(2).join("/"),
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
