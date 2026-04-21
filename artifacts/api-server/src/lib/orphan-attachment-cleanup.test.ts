import { describe, it, expect, beforeEach, vi } from "vitest";

// `./db` throws at import time when DATABASE_URL is missing, and any real
// query would try to talk to Postgres. Replace it with a programmable stub
// before the cleanup module is loaded.
type SelectRow = { objectPath: string };
const dbState: {
  selectRows: SelectRow[];
  selectShouldThrow: boolean;
  inserted: unknown[];
  updated: unknown[];
} = {
  selectRows: [],
  selectShouldThrow: false,
  inserted: [],
  updated: [],
};

vi.mock("./db", () => {
  const select = () => ({
    from: () => ({
      where: async () => {
        if (dbState.selectShouldThrow) throw new Error("simulated DB failure");
        return dbState.selectRows;
      },
    }),
  });
  const insert = () => ({
    values: (v: unknown) => ({
      returning: async () => {
        dbState.inserted.push(v);
        return [{ id: 42 }];
      },
    }),
  });
  const update = () => ({
    set: (v: unknown) => ({
      where: async () => {
        dbState.updated.push(v);
        return undefined;
      },
    }),
  });
  return { db: { select, insert, update } };
});

// Programmable in-memory bucket. The cleanup uses
// `objectStorageClient.bucket(name).getFiles({ prefix })` to enumerate
// objects, and `bucket.file(name).delete({ ignoreNotFound })` to remove
// them. We track what was deleted so tests can assert behaviour.
type FakeFile = { name: string; metadata: { timeCreated: string } };
const bucketState: {
  files: FakeFile[];
  deleted: string[];
  deleteShouldThrowFor: Set<string>;
} = { files: [], deleted: [], deleteShouldThrowFor: new Set() };

vi.mock("./objectStorage", () => {
  const bucket = (_name: string) => ({
    getFiles: async (_opts: { prefix: string }) => [bucketState.files] as const,
    file: (objectName: string) => ({
      delete: async (_opts: { ignoreNotFound?: boolean }) => {
        if (bucketState.deleteShouldThrowFor.has(objectName)) {
          throw new Error("simulated delete failure");
        }
        bucketState.deleted.push(objectName);
      },
    }),
  });
  return { objectStorageClient: { bucket } };
});

// Quiet logger so test output stays focused on assertions.
vi.mock("./logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Set env vars BEFORE importing the cleanup module so its parsePrivateDir
// helper sees them.
process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";
process.env.DATABASE_URL = "postgres://test/test";

const { cleanupOrphanedAttachments } = await import("./orphan-attachment-cleanup");

function makeFile(id: string, ageDays: number): FakeFile {
  const ms = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  return {
    name: `private/uploads/${id}`,
    metadata: { timeCreated: new Date(ms).toISOString() },
  };
}

beforeEach(() => {
  dbState.selectRows = [];
  dbState.selectShouldThrow = false;
  dbState.inserted = [];
  dbState.updated = [];
  bucketState.files = [];
  bucketState.deleted = [];
  bucketState.deleteShouldThrowFor = new Set();
});

describe("cleanupOrphanedAttachments", () => {
  it("does not delete files newer than the age threshold", async () => {
    // Recent file (1 day old) with no DB row — would be deleted if the age
    // guard is broken.
    bucketState.files = [makeFile("recent-1", 1)];
    dbState.selectRows = [];

    const result = await cleanupOrphanedAttachments({ ageDays: 7 });

    expect(result.scanned).toBe(1);
    expect(result.candidates).toBe(0);
    expect(result.orphans).toBe(0);
    expect(result.deleted).toBe(0);
    expect(bucketState.deleted).toEqual([]);
  });

  it("does not delete old files that are still referenced by a tracked source", async () => {
    bucketState.files = [makeFile("old-but-live", 30)];
    // Cleanup queries every tracked source with the candidate's path; any
    // single match anywhere protects the file from deletion.
    dbState.selectRows = [{ objectPath: "/objects/uploads/old-but-live" }];

    const result = await cleanupOrphanedAttachments({ ageDays: 7 });

    expect(result.candidates).toBe(1);
    expect(result.orphans).toBe(0);
    expect(result.deleted).toBe(0);
    expect(bucketState.deleted).toEqual([]);
  });

  it("deletes old files with no matching DB row in any tracked source", async () => {
    bucketState.files = [
      makeFile("orphan-a", 30),
      makeFile("orphan-b", 30),
    ];
    dbState.selectRows = []; // no tracked source claims either file

    const result = await cleanupOrphanedAttachments({ ageDays: 7 });

    expect(result.candidates).toBe(2);
    expect(result.orphans).toBe(2);
    expect(result.deleted).toBe(2);
    expect(bucketState.deleted.sort()).toEqual([
      "private/uploads/orphan-a",
      "private/uploads/orphan-b",
    ]);
  });

  it("dry-run does not actually delete", async () => {
    bucketState.files = [makeFile("orphan-dry", 30)];
    dbState.selectRows = [];

    const result = await cleanupOrphanedAttachments({ ageDays: 7, dryRun: true });

    expect(result.orphans).toBe(1);
    expect(result.deleted).toBe(0);
    expect(bucketState.deleted).toEqual([]);
  });

  it("aborts safely when a DB lookup fails (no deletions)", async () => {
    bucketState.files = [makeFile("orphan-c", 30)];
    dbState.selectShouldThrow = true; // any tracked-source lookup will throw

    const result = await cleanupOrphanedAttachments({ ageDays: 7 });

    // The candidate was identified, but because we couldn't confirm whether
    // any DB source references it, deletion must be skipped entirely to
    // avoid wiping a live file.
    expect(result.candidates).toBe(1);
    expect(result.orphans).toBe(0);
    expect(result.deleted).toBe(0);
    expect(bucketState.deleted).toEqual([]);
  });

  it("delete failures are counted as errors but don't crash the run", async () => {
    bucketState.files = [
      makeFile("orphan-ok", 30),
      makeFile("orphan-bad", 30),
    ];
    bucketState.deleteShouldThrowFor = new Set(["private/uploads/orphan-bad"]);

    const result = await cleanupOrphanedAttachments({ ageDays: 7 });

    expect(result.orphans).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
    expect(bucketState.deleted).toEqual(["private/uploads/orphan-ok"]);
  });

  it("rejects a non-numeric ATTACHMENT_CLEANUP_AGE_DAYS instead of deleting recent files", async () => {
    bucketState.files = [makeFile("super-recent", 0)];

    const result = await cleanupOrphanedAttachments({ ageDays: NaN });

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(bucketState.deleted).toEqual([]);
  });
});
