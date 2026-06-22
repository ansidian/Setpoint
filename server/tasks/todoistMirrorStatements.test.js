import { describe, it, expect } from "vitest";
import {
  normalizeId,
  fullSyncTombstoneStatements,
  completedOccurrenceReconcileStatement,
  itemStatement,
  projectStatement,
  labelStatement,
  stateSuccessStatement,
} from "./todoistMirrorStatements.js";

describe("normalizeId", () => {
  it("maps null/undefined to null and coerces everything else to a string", () => {
    expect(normalizeId(null)).toBeNull();
    expect(normalizeId(undefined)).toBeNull();
    expect(normalizeId(42)).toBe("42");
    expect(normalizeId("abc")).toBe("abc");
  });
});

describe("itemStatement", () => {
  it("derives due_date from the due datetime, booleans as ints, and a deleted_at only when deleted", () => {
    const active = itemStatement("u1", {
      id: 7,
      project_id: 3,
      content: "Task",
      checked: false,
      is_deleted: false,
      due: { date: "2026-05-05T09:30:00", timezone: "America/Los_Angeles", is_recurring: true },
      priority: 4,
      labels: ["school"],
    }, "2026-05-04T15:00:00.000Z");

    // normalizeId coerces numeric ids; dueDate splits the datetime; boolInt maps booleans.
    expect(active.args).toEqual([
      "u1", "7", "3", null, null, "Task", "",
      0, 0,
      "2026-05-05", "2026-05-05T09:30:00", "America/Los_Angeles", 1,
      4, JSON.stringify(["school"]), expect.any(String),
      "2026-05-04T15:00:00.000Z", null, "2026-05-04T15:00:00.000Z",
    ]);
    expect(active.sql).toContain("INSERT INTO ea_todoist_items");
    expect(active.sql).toContain("ON CONFLICT(user_id, item_id) DO UPDATE SET");

    const deleted = itemStatement("u1", { id: "x", is_deleted: true }, "2026-05-04T15:00:00.000Z");
    // deletedAt returns the timestamp only when is_deleted is truthy (arg index 17).
    expect(deleted.args[8]).toBe(1);
    expect(deleted.args[17]).toBe("2026-05-04T15:00:00.000Z");
  });
});

describe("completedOccurrenceReconcileStatement", () => {
  it("targets the user's non-recurring active occurrences and passes user_id twice", () => {
    const stmt = completedOccurrenceReconcileStatement("u1");
    expect(stmt.args).toEqual(["u1", "u1"]);
    expect(stmt.sql).toContain("DELETE FROM ea_completed_tasks");
    expect(stmt.sql).toContain("due_is_recurring = 0");
  });
});

describe("fullSyncTombstoneStatements", () => {
  it("returns one tombstone UPDATE per mirror table", () => {
    const stmts = fullSyncTombstoneStatements("u1", "2026-05-04T15:00:00.000Z");
    expect(stmts).toHaveLength(3);
    expect(stmts.map((s) => s.args)).toEqual([
      ["2026-05-04T15:00:00.000Z", "2026-05-04T15:00:00.000Z", "u1"],
      ["2026-05-04T15:00:00.000Z", "2026-05-04T15:00:00.000Z", "u1"],
      ["2026-05-04T15:00:00.000Z", "2026-05-04T15:00:00.000Z", "u1"],
    ]);
  });
});

describe("stateSuccessStatement (P3-66)", () => {
  it("records full vs incremental timestamps and guards a newer pending request via a CASE comparison", () => {
    const full = stateSuccessStatement("u1", { sync_token: "tok" }, "T1", true, "T0");
    // last_full_sync_at = timestamp, last_incremental_sync_at = null for a full sync.
    expect(full.args).toEqual(["u1", "tok", "T1", "T1", "T1", null, "T1", "T0", "T0"]);
    // The P3-66 guard compares the stored sync_requested_at against the sync start.
    expect(full.sql).toContain("ea_todoist_sync_state.sync_requested_at <= ?");

    const incremental = stateSuccessStatement("u1", { sync_token: "tok" }, "T1", false, "T0");
    expect(incremental.args[4]).toBeNull(); // last_full_sync_at
    expect(incremental.args[5]).toBe("T1"); // last_incremental_sync_at
  });
});

describe("projectStatement / labelStatement", () => {
  it("coerce ids, default name/color, and map is_deleted to an int", () => {
    expect(projectStatement("u1", { id: 5, name: "School", is_inbox_project: true }, "T").args.slice(0, 6))
      .toEqual(["u1", "5", "School", null, 1, 0]);
    expect(labelStatement("u1", { id: 9, is_deleted: true }, "T").args.slice(0, 5))
      .toEqual(["u1", "9", "", null, 1]);
  });
});
