import { describe, expect, it } from "vitest";
import {
  canDismissSnapshotEmail,
  canHandleSnapshotEmail,
  canMoveSnapshotEmailToLane,
  getSnapshotReopenLane,
  snapshotInboxLaneForItem,
} from "./activeSnapshotWorkflowModel.js";

describe("active snapshot workflow model", () => {
  const snapshotEmail = {
    _activeSnapshot: true,
    snapshot_item_id: 1,
    _lane: "needs_attention",
  };

  it("normalizes snapshot item lanes for inbox projection", () => {
    expect(snapshotInboxLaneForItem({ lane: "action" })).toBe("needs_attention");
    expect(snapshotInboxLaneForItem({ lane: "fyi", _snapshotCarryover: true })).toBe("carryover");
    expect(snapshotInboxLaneForItem({ lane: "queued", source: "arrival_grace" })).toBe("queued");
    expect(snapshotInboxLaneForItem({ lane: "untriaged_read", source: "arrival_grace_read" })).toBe("untriaged_read");
    expect(snapshotInboxLaneForItem({ lane: "fyi", handled_at: "2026-05-05T12:00:00.000Z" })).toBe("handled");
    expect(snapshotInboxLaneForItem({ lane: "noise", source: "pending_security_grace" })).toBeNull();
  });

  it("centralizes snapshot transition permissions", () => {
    expect(canHandleSnapshotEmail(snapshotEmail, false)).toBe(true);
    expect(canHandleSnapshotEmail({ ...snapshotEmail, _lane: "queued" }, false)).toBe(false);
    expect(canDismissSnapshotEmail({ ...snapshotEmail, _lane: "queued" }, false)).toBe(true);
    expect(canDismissSnapshotEmail({ ...snapshotEmail, _lane: "untriaged_read" }, false)).toBe(false);
    expect(canMoveSnapshotEmailToLane(snapshotEmail, "fyi", false)).toBe(true);
    expect(canMoveSnapshotEmailToLane({ ...snapshotEmail, _lane: "handled" }, "fyi", false)).toBe(false);
  });

  it("restores handled and carryover rows to an actionable lane", () => {
    expect(getSnapshotReopenLane({ _lane: "carryover", lane: "noise" })).toBe("needs_attention");
    expect(getSnapshotReopenLane({ _lane: "handled", lane_at_snapshot: "fyi" })).toBe("fyi");
    expect(getSnapshotReopenLane({ _lane: "handled", lane_at_snapshot: "queued" })).toBe("needs_attention");
  });
});
