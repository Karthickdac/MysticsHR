/**
 * Self-tests for the shared notification test harness. These pin down the
 * mock surface contract the notification suites depend on so a future
 * refactor of the harness itself can't silently regress:
 *
 *  - select / insert / update / delete capture
 *  - update return precedence (queueUpdateReturn > defaultUpdateReturn)
 *  - reset between tests
 *  - transaction reuses the same surface
 */
import { describe, it, expect } from "vitest";
import {
  createDbMockState, buildDbMockModule, queueSelect, queueUpdateReturn,
  resetDbMockState,
} from "./notification-test-harness";

const fakeTable = Symbol("fake_table") as unknown as object;

describe("notification-test-harness — db mock", () => {
  it("captures inserts, updates, and deletes against the right tables", async () => {
    const state = createDbMockState();
    const { db } = buildDbMockModule(state);

    await db.insert(fakeTable).values({ name: "Alice" });
    await db.update(fakeTable).set({ name: "Bob" }).where({});
    await db.delete(fakeTable).where({});

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].table).toBe(fakeTable);
    expect(state.inserted[0].rows[0].name).toBe("Alice");

    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].table).toBe(fakeTable);
    expect((state.updated[0].values as { name: string }).name).toBe("Bob");

    // Delete capture is the focus here — must record both the call and the table.
    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0].table).toBe(fakeTable);
  });

  it("serves queued select rows FIFO per table", async () => {
    const state = createDbMockState();
    const { db } = buildDbMockModule(state);

    queueSelect(state, fakeTable, [{ id: 1 }]);
    queueSelect(state, fakeTable, [{ id: 2 }]);

    const a = await db.select().from(fakeTable);
    const b = await db.select().from(fakeTable);
    const c = await db.select().from(fakeTable); // queue exhausted → empty

    expect(a).toEqual([{ id: 1 }]);
    expect(b).toEqual([{ id: 2 }]);
    expect(c).toEqual([]);
  });

  it("queueUpdateReturn takes precedence over defaultUpdateReturn", async () => {
    const state = createDbMockState({
      defaultUpdateReturn: () => [{ id: 99, fallback: true }],
    });
    const { db } = buildDbMockModule(state);

    // First call — explicit queued return
    queueUpdateReturn(state, fakeTable, [{ id: 7, queued: true }]);
    const first = await db.update(fakeTable).set({ x: 1 }).where({}).returning();
    expect(first).toEqual([{ id: 7, queued: true }]);

    // Second call — queue empty, falls back to defaultUpdateReturn
    const second = await db.update(fakeTable).set({ x: 2 }).where({}).returning();
    expect(second).toEqual([{ id: 99, fallback: true }]);
  });

  it("resetDbMockState clears insert/update/delete capture and queues", async () => {
    const state = createDbMockState();
    const { db } = buildDbMockModule(state);

    queueSelect(state, fakeTable, [{ id: 1 }]);
    queueUpdateReturn(state, fakeTable, [{ id: 2 }]);
    await db.insert(fakeTable).values({ a: 1 });
    await db.update(fakeTable).set({ a: 2 }).where({});
    await db.delete(fakeTable).where({});

    resetDbMockState(state);

    expect(state.inserted).toEqual([]);
    expect(state.updated).toEqual([]);
    expect(state.deleted).toEqual([]);
    expect(state.selectQueues.size).toBe(0);
    expect(state.updateReturnQueues.size).toBe(0);
    // Empty queue post-reset
    expect(await db.select().from(fakeTable)).toEqual([]);
  });

  it("transaction reuses the outer surface so capture lists merge", async () => {
    const state = createDbMockState();
    const { db } = buildDbMockModule(state);

    await db.transaction(async (tx) => {
      await tx.insert(fakeTable).values({ inside: true });
      await tx.delete(fakeTable).where({});
    });

    expect(state.inserted).toHaveLength(1);
    expect((state.inserted[0].rows[0] as { inside: boolean }).inside).toBe(true);
    expect(state.deleted).toHaveLength(1);
  });
});
