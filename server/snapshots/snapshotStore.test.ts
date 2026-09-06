import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SnapshotRecord, SnapshotWindow } from "../../shared/types/snapshots.ts";
import {
  CARRYOVER_MAX_DEPTH,
  copyCarryoverItems,
  findActiveSnapshot,
  loadAccountFilterOrder,
  loadSnapshotHistoryCounts,
} from "./snapshotStore.ts";
import { createMigratedDb } from "./snapshot-test-fixtures.ts";

const windowFixture = (
  start_at = "2026-05-10T00:00:00.000Z",
  end_at = "2026-05-10T12:00:00.000Z",
): SnapshotWindow => ({
  start_at,
  end_at,
  timezone: "America/Los_Angeles",
});

let db: Client;

beforeEach(async () => {
  db = await createMigratedDb();
});

afterEach(async () => {
  await db.close();
});

async function insertSnapshot({
  userId = "u1",
  window = windowFixture(),
  status = "active",
}: {
  userId?: string;
  window?: SnapshotWindow;
  status?: "active" | "frozen";
} = {}): Promise<SnapshotRecord> {
  const result = await db.execute({
    sql: `INSERT INTO ea_briefing_snapshots
            (user_id, start_at, end_at, timezone, status)
          VALUES (?, ?, ?, ?, ?)
          RETURNING *`,
    args: [userId, window.start_at, window.end_at, window.timezone, status],
  });
  return result.rows[0] as unknown as SnapshotRecord;
}

async function insertSnapshotItem({
  snapshotId,
  index,
  lane = "needs_attention",
  isCarryover = false,
  handled = false,
  carryoverCount = 0,
}: {
  snapshotId: number;
  index: number;
  lane?: string;
  isCarryover?: boolean;
  handled?: boolean;
  carryoverCount?: number;
}): Promise<void> {
  const triage = await db.execute({
    sql: `INSERT INTO ea_email_triage
            (user_id, account_id, email_id, lane, triage_status, provider_state)
          VALUES ('u1', 'gmail-work', ?, ?, 'complete', 'available')
          RETURNING id`,
    args: [`message-${index}`, lane],
  });
  await db.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, is_carryover, carryover_count, handled_at)
          VALUES (?, ?, 'u1', 'gmail-work', ?, ?, ?, ?, ?)`,
    args: [
      snapshotId,
      Number(triage.rows[0]!.id),
      `message-${index}`,
      lane,
      isCarryover ? 1 : 0,
      carryoverCount,
      handled ? "2026-05-10T01:00:00.000Z" : null,
    ],
  });
}

describe("findActiveSnapshot", () => {
  it("returns only the active snapshot for the requested owner and window", async () => {
    const expected = await insertSnapshot();
    await insertSnapshot({ userId: "other-user" });
    await insertSnapshot({
      window: windowFixture("2026-05-09T00:00:00.000Z", "2026-05-09T12:00:00.000Z"),
      status: "frozen",
    });

    const snapshot = await findActiveSnapshot(db, "u1", windowFixture());

    expect(snapshot).toMatchObject({
      id: expected.id,
      user_id: "u1",
      status: "active",
      start_at: windowFixture().start_at,
      end_at: windowFixture().end_at,
    });
  });
});

describe("loadSnapshotHistoryCounts", () => {
  it("returns an empty map for no ids", async () => {
    expect((await loadSnapshotHistoryCounts(db, [])).size).toBe(0);
  });

  it("routes durable handled, carryover, and display-lane rows into snapshot counts", async () => {
    const snapshot = await insertSnapshot();
    for (let index = 1; index <= 3; index += 1) {
      await insertSnapshotItem({ snapshotId: snapshot.id, index });
    }
    for (let index = 4; index <= 5; index += 1) {
      await insertSnapshotItem({ snapshotId: snapshot.id, index, isCarryover: true });
    }
    await insertSnapshotItem({ snapshotId: snapshot.id, index: 6, lane: "fyi", handled: true });

    const counts = await loadSnapshotHistoryCounts(db, [snapshot.id]);

    expect(counts.get(snapshot.id)).toMatchObject({
      needs_attention: 3,
      carryover: 2,
      handled: 1,
      fyi: 0,
    });
  });
});

describe("loadAccountFilterOrder", () => {
  it("builds an ordered map from durable account rows", async () => {
    await db.batch([
      {
        sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, sort_order, created_at)
              VALUES ('a', 'u1', 'gmail', 'a@example.com', 'A', 2, '2026-01-02T00:00:00Z')`,
      },
      {
        sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, sort_order, created_at)
              VALUES ('b', 'u1', 'gmail', 'b@example.com', 'B', 1, '2026-01-01T00:00:00Z')`,
      },
    ]);

    const order = await loadAccountFilterOrder(db, "u1");

    expect([...order.keys()]).toEqual(["b", "a"]);
    expect(order.get("b")).toMatchObject({ index: 0, sort_order: 1 });
    expect(order.get("a")).toMatchObject({ index: 1, sort_order: 2 });
  });

  it("tolerates a genuinely unmigrated database by returning an empty map", async () => {
    const unmigrated = (await import("@libsql/client")).createClient({ url: "file::memory:" });
    try {
      expect((await loadAccountFilterOrder(unmigrated, "u1")).size).toBe(0);
    } finally {
      await unmigrated.close();
    }
  });

  it("rethrows genuine database connection errors", async () => {
    const closed = await createMigratedDb();
    await closed.close();

    await expect(loadAccountFilterOrder(closed, "u1")).rejects.toThrow();
  });
});

describe("copyCarryoverItems", () => {
  it("copies eligible durable rows and increments their bounded carryover depth", async () => {
    const previousWindow = windowFixture(
      "2026-05-09T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
    );
    const currentWindow = windowFixture(
      "2026-05-10T00:00:00.000Z",
      "2026-05-10T12:00:00.000Z",
    );
    const previous = await insertSnapshot({ window: previousWindow, status: "frozen" });
    const current = await insertSnapshot({ window: currentWindow });
    await insertSnapshotItem({
      snapshotId: previous.id,
      index: 1,
      isCarryover: true,
      carryoverCount: CARRYOVER_MAX_DEPTH - 1,
    });

    await copyCarryoverItems(db, "u1", current, currentWindow);

    const copied = await db.execute({
      sql: `SELECT snapshot_id, is_carryover, carryover_count
            FROM ea_briefing_snapshot_items
            WHERE snapshot_id = ?`,
      args: [current.id],
    });
    expect(copied.rows).toEqual([
      expect.objectContaining({
        snapshot_id: current.id,
        is_carryover: 1,
        carryover_count: CARRYOVER_MAX_DEPTH,
      }),
    ]);
  });

  it("does not create rows when there is no previous frozen snapshot", async () => {
    const current = await insertSnapshot();

    await copyCarryoverItems(db, "u1", current, windowFixture());

    const rows = await db.execute({
      sql: "SELECT id FROM ea_briefing_snapshot_items WHERE snapshot_id = ?",
      args: [current.id],
    });
    expect(rows.rows).toEqual([]);
  });
});
