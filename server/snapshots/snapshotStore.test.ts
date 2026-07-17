import { describe, expect, it } from "vitest";
import type { InStatement } from "@libsql/client";
import type { SnapshotRecord, SnapshotWindow } from "../../shared/types/snapshots.ts";
import type { SnapshotReadDb } from "./snapshot-types.ts";
import {
  CARRYOVER_MAX_DEPTH,
  copyCarryoverItems,
  findActiveSnapshot,
  loadAccountFilterOrder,
  loadSnapshotHistoryCounts,
} from "./snapshotStore.ts";

type StatementObject = Exclude<InStatement, string>;

const windowFixture = (start_at = "s", end_at = "e"): SnapshotWindow => ({
  start_at,
  end_at,
  timezone: "America/Los_Angeles",
});

const snapshotFixture = (id: number): SnapshotRecord => ({
  id,
  snapshot_item_id: id,
  ...windowFixture(),
  status: "active",
});

describe("CARRYOVER_MAX_DEPTH", () => {
  it("is the documented depth bound (6)", () => {
    expect(CARRYOVER_MAX_DEPTH).toBe(6);
  });
});

describe("findActiveSnapshot", () => {
  it("queries the active window and returns the normalized row", async () => {
    let captured: StatementObject | undefined;
    const dbClient: SnapshotReadDb = {
      execute: async (query) => {
        captured = query as StatementObject;
        return { rows: [{ id: 7, status: "active", start_at: "s", end_at: "e" }] };
      },
    };
    const snapshot = await findActiveSnapshot(dbClient, "u1", windowFixture());
    expect(snapshot).toMatchObject({ id: 7, status: "active" });
    expect(captured!.sql).toMatch(/status = 'active'/);
    expect(captured!.args).toEqual(["u1", "s", "e"]);
  });
});

describe("loadSnapshotHistoryCounts", () => {
  it("returns an empty map for no ids without querying", async () => {
    const dbClient = { execute: async () => { throw new Error("should not run"); } };
    expect((await loadSnapshotHistoryCounts(dbClient, [])).size).toBe(0);
  });

  it("routes handled, carryover, and display-lane rows into per-snapshot counts", async () => {
    const dbClient = {
      execute: async () => ({
        rows: [
          { snapshot_id: 1, lane_at_snapshot: "needs_attention", is_carryover: 0, is_handled: 0, count: 3 },
          { snapshot_id: 1, lane_at_snapshot: "needs_attention", is_carryover: 1, is_handled: 0, count: 2 },
          { snapshot_id: 1, lane_at_snapshot: "fyi", is_carryover: 0, is_handled: 1, count: 1 },
        ],
      }),
    };
    const counts = await loadSnapshotHistoryCounts(dbClient, [1]);
    expect(counts.get(1)).toMatchObject({ needs_attention: 3, carryover: 2, handled: 1, fyi: 0 });
  });
});

describe("loadAccountFilterOrder", () => {
  it("builds an ordered map keyed by account id with parsed sort/created/index", async () => {
    const dbClient = {
      execute: async () => ({
        rows: [
          { id: "a", sort_order: 2, created_at: "2026-01-02T00:00:00Z" },
          { id: "b", sort_order: 1, created_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    };
    const order = await loadAccountFilterOrder(dbClient, "u1");
    expect(order.get("a")).toMatchObject({ index: 0, sort_order: 2 });
    expect(order.get("b")!.index).toBe(1);
  });

  it("tolerates a missing ea_accounts table by returning an empty map", async () => {
    const dbClient = { execute: async () => { throw new Error("no such table: ea_accounts"); } };
    expect((await loadAccountFilterOrder(dbClient, "u1")).size).toBe(0);
  });

  it("rethrows non-missing-table errors", async () => {
    const dbClient = { execute: async () => { throw new Error("connection reset"); } };
    await expect(loadAccountFilterOrder(dbClient, "u1")).rejects.toThrow("connection reset");
  });
});

describe("copyCarryoverItems", () => {
  it("issues the carryover INSERT bounded by CARRYOVER_MAX_DEPTH when a previous frozen snapshot exists", async () => {
    const calls: StatementObject[] = [];
    const dbClient: SnapshotReadDb = {
      execute: async (query) => {
        const statement = query as StatementObject;
        calls.push(statement);
        if (statement.sql.includes("status = 'frozen'")) return { rows: [{ id: 99, status: "frozen" }] };
        return { rows: [] };
      },
    };
    await copyCarryoverItems(dbClient, "u1", snapshotFixture(5), windowFixture("x"));
    const insert = calls.find((c) => c.sql.includes("INSERT OR IGNORE INTO ea_briefing_snapshot_items"));
    expect(insert).toBeTruthy();
    // snapshot.id, previous.id, userId, depth bound
    expect(insert!.args).toEqual([5, 99, "u1", CARRYOVER_MAX_DEPTH]);
  });

  it("does nothing when there is no previous frozen snapshot", async () => {
    const calls: StatementObject[] = [];
    const dbClient: SnapshotReadDb = {
      execute: async (query) => {
        calls.push(query as StatementObject);
        return { rows: [] };
      },
    };
    await copyCarryoverItems(dbClient, "u1", snapshotFixture(5), windowFixture("x"));
    expect(calls.some((c) => c.sql.includes("INSERT OR IGNORE"))).toBe(false);
  });
});
