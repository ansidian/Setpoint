import { describe, expect, it } from "vitest";
import {
  PROVIDER_REMOVED_STATES,
  SNAPSHOT_DISPLAY_LANES,
  SNAPSHOT_LANES,
  TRIAGE_LANES,
  getSnapshotReopenLane,
  isPendingSnapshotTriage,
  resurfacedTriageLane,
} from "./snapshot-state-machine.js";

describe("snapshot lane state machine", () => {
  it("declares the 8 inbox lanes", () => {
    expect([...SNAPSHOT_LANES].sort()).toEqual([
      "carryover",
      "catch_up",
      "fyi",
      "handled",
      "needs_attention",
      "noise",
      "queued",
      "untriaged_read",
    ]);
  });

  it("limits triage decisions and user lane moves to the three triage lanes", () => {
    expect([...TRIAGE_LANES].sort()).toEqual(["fyi", "needs_attention", "noise"]);
  });

  it("counts only stored lane values in the history view", () => {
    expect([...SNAPSHOT_DISPLAY_LANES].sort()).toEqual([
      "fyi",
      "handled",
      "needs_attention",
      "noise",
      "queued",
      "untriaged_read",
    ]);
  });

  it("tombstones items archived or trashed at the provider", () => {
    expect([...PROVIDER_REMOVED_STATES].sort()).toEqual(["archived", "trashed"]);
  });

  describe("getSnapshotReopenLane", () => {
    it("restores the pre-handled lane when it is user-assignable", () => {
      expect(getSnapshotReopenLane("needs_attention")).toBe("needs_attention");
      expect(getSnapshotReopenLane("fyi")).toBe("fyi");
      expect(getSnapshotReopenLane("noise")).toBe("noise");
    });

    it("falls back to needs_attention for every other stored lane", () => {
      expect(getSnapshotReopenLane("queued")).toBe("needs_attention");
      expect(getSnapshotReopenLane("untriaged_read")).toBe("needs_attention");
      expect(getSnapshotReopenLane("handled")).toBe("needs_attention");
      expect(getSnapshotReopenLane("carryover")).toBe("needs_attention");
      expect(getSnapshotReopenLane("catch_up")).toBe("needs_attention");
      expect(getSnapshotReopenLane(null)).toBe("needs_attention");
      expect(getSnapshotReopenLane(undefined)).toBe("needs_attention");
    });
  });

  describe("resurfacedTriageLane", () => {
    it("keeps the remembered lane when it is a triage lane", () => {
      expect(resurfacedTriageLane({ lane: "fyi" })).toBe("fyi");
      expect(resurfacedTriageLane({ lane: "noise" })).toBe("noise");
      expect(resurfacedTriageLane({ lane: "needs_attention" })).toBe("needs_attention");
    });

    it("prefers the view-model _lane over the stored lane", () => {
      expect(resurfacedTriageLane({ _lane: "noise", lane: "fyi" })).toBe("noise");
    });

    it("falls back to needs_attention for non-triage or missing lanes", () => {
      expect(resurfacedTriageLane({ lane: "queued" })).toBe("needs_attention");
      expect(resurfacedTriageLane({ _lane: "carryover" })).toBe("needs_attention");
      expect(resurfacedTriageLane({})).toBe("needs_attention");
      expect(resurfacedTriageLane(null)).toBe("needs_attention");
    });
  });

  describe("isPendingSnapshotTriage", () => {
    it("flags rows whose triage has not settled", () => {
      expect(isPendingSnapshotTriage({ triage_status: "pending" })).toBe(true);
      expect(isPendingSnapshotTriage({ triage_source: "weak_security_grace" })).toBe(true);
      expect(isPendingSnapshotTriage({ source: "pending_security_grace" })).toBe(true);
    });

    it("treats settled or missing rows as not pending", () => {
      expect(isPendingSnapshotTriage({ triage_status: "complete" })).toBe(false);
      expect(isPendingSnapshotTriage({ triage_source: "arrival_grace" })).toBe(false);
      expect(isPendingSnapshotTriage({})).toBe(false);
      expect(isPendingSnapshotTriage(null)).toBe(false);
    });
  });
});
