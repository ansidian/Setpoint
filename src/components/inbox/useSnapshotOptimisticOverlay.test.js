import { describe, expect, it } from "vitest";
import {
  applySnapshotOverlays,
  reconcileSnapshotOverlays,
} from "./useSnapshotOptimisticOverlay";

function rowsById(rows) {
  return new Map(rows.map((row) => [String(row.snapshot_item_id), row]));
}

describe("reconcileSnapshotOverlays", () => {
  it("drops overlays whose row left the refreshed snapshot and releases pending", () => {
    const pending = new Set(["1"]);
    const prev = new Map([["1", { hidden: true, pendingAction: "dismiss", pending: false }]]);

    const next = reconcileSnapshotOverlays(prev, rowsById([]), pending);

    expect(next.size).toBe(0);
    expect(pending.has("1")).toBe(false);
  });

  it("keeps overlays while their mutation is still pending", () => {
    const pending = new Set(["1"]);
    const overlay = { laneOverride: "fyi", pending: true };
    const prev = new Map([["1", overlay]]);
    const rows = rowsById([{ snapshot_item_id: 1, _lane: "needs_attention" }]);

    const next = reconcileSnapshotOverlays(prev, rows, pending);

    expect(next.get("1")).toBe(overlay);
    expect(pending.has("1")).toBe(true);
  });

  it("drops failed overlays once the server row is back", () => {
    const pending = new Set(["1"]);
    const prev = new Map([["1", { laneOverride: "fyi", failed: true }]]);
    const rows = rowsById([{ snapshot_item_id: 1, _lane: "needs_attention" }]);

    const next = reconcileSnapshotOverlays(prev, rows, pending);

    expect(next.size).toBe(0);
    expect(pending.has("1")).toBe(false);
  });

  it("settles a lane override when the refreshed row reflects the lane", () => {
    const pending = new Set(["1"]);
    const prev = new Map([["1", { laneOverride: "fyi", pending: false }]]);
    const rows = rowsById([{ snapshot_item_id: 1, _lane: "fyi" }]);

    const next = reconcileSnapshotOverlays(prev, rows, pending);

    expect(next.size).toBe(0);
    expect(pending.has("1")).toBe(false);
  });

  it("keeps hidden and handled overlays until their row disappears", () => {
    const pending = new Set();
    const hidden = { hidden: true, pending: false };
    const handled = { statusOverride: "handled", laneOverride: "handled", pending: false };
    const prev = new Map([["1", hidden], ["2", handled]]);
    const rows = rowsById([
      { snapshot_item_id: 1, _lane: "fyi" },
      { snapshot_item_id: 2, _lane: "needs_attention" },
    ]);

    const next = reconcileSnapshotOverlays(prev, rows, pending);

    expect(next.get("1")).toBe(hidden);
    expect(next.get("2")).toBe(handled);
  });

  it("returns the previous Map untouched when nothing settles", () => {
    const prev = new Map([["1", { hidden: true, pending: false }]]);
    const rows = rowsById([{ snapshot_item_id: 1, _lane: "fyi" }]);

    expect(reconcileSnapshotOverlays(prev, rows, new Set())).toBe(prev);
  });
});

describe("applySnapshotOverlays", () => {
  it("hides rows with a hidden overlay and overrides lane and handled state", () => {
    const rows = [
      { snapshot_item_id: 1, _lane: "needs_attention", lane: "needs_attention", subject: "a" },
      { snapshot_item_id: 2, _lane: "fyi", lane: "fyi", subject: "b", handled_at: null },
      { snapshot_item_id: 3, _lane: "noise", lane: "noise", subject: "c" },
    ];
    const overlays = new Map([
      ["1", { hidden: true, pendingAction: "dismiss", pending: true }],
      ["2", {
        laneOverride: "handled",
        handledAt: "2026-05-03T16:00:00.000Z",
        pendingAction: "handled",
        pending: false,
      }],
    ]);

    const out = applySnapshotOverlays(rows, overlays);

    expect(out.map((row) => row.subject)).toEqual(["b", "c"]);
    expect(out[0]).toMatchObject({
      lane: "handled",
      _lane: "handled",
      handled_at: "2026-05-03T16:00:00.000Z",
      _optimisticSnapshotAction: "handled",
      _optimisticSnapshotPending: false,
    });
    expect(out[1]).toBe(rows[2]);
  });
});
