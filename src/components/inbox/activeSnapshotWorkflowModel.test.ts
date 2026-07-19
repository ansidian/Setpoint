import { describe, expect, it } from "vitest";
import {
  canDismissSnapshotEmail,
  canHandleSnapshotEmail,
  canMoveSnapshotEmailToLane,
  canReopenSnapshotEmail,
  getSnapshotReopenLane,
  hasActiveSnapshotItem,
  isSnapshotDismissibleLane,
  isSnapshotWorkflowLane,
  snapshotInboxLaneForItem,
} from "./activeSnapshotWorkflowModel";
import type { InboxEmailLike } from "./inboxTypes";

describe("active snapshot workflow model", () => {
  const snapshotEmail: InboxEmailLike = {
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

  it.each([
    ["needs_attention", true, true, false, true, false, true, true],
    ["carryover", true, true, false, true, false, true, true],
    ["fyi", true, true, false, true, true, false, true],
    ["noise", false, true, false, true, true, true, false],
    ["handled", false, false, true, true, false, false, false],
    ["queued", false, true, false, false, false, false, false],
    ["untriaged_read", false, false, false, false, false, false, false],
  ] as const)(
    "owns %s lane transition permissions",
    (lane, canHandle, canDismiss, canReopen, workflowLane, moveToNeeds, moveToFyi, moveToNoise) => {
      const email = { ...snapshotEmail, _lane: lane };

      expect(hasActiveSnapshotItem(email)).toBe(true);
      expect(isSnapshotWorkflowLane(email)).toBe(workflowLane);
      expect(isSnapshotDismissibleLane(email)).toBe(canDismiss);
      expect(canHandleSnapshotEmail(email, false)).toBe(canHandle);
      expect(canDismissSnapshotEmail(email, false)).toBe(canDismiss);
      expect(canReopenSnapshotEmail(email, false)).toBe(canReopen);
      expect(canMoveSnapshotEmailToLane(email, "needs_attention", false)).toBe(moveToNeeds);
      expect(canMoveSnapshotEmailToLane(email, "fyi", false)).toBe(moveToFyi);
      expect(canMoveSnapshotEmailToLane(email, "noise", false)).toBe(moveToNoise);
    },
  );

  it("denies every transition without an active item id or in a read-only snapshot", () => {
    for (const email of [
      { ...snapshotEmail, snapshot_item_id: undefined },
      { ...snapshotEmail, _activeSnapshot: false },
    ]) {
      expect(hasActiveSnapshotItem(email)).toBe(false);
      expect(canHandleSnapshotEmail(email, false)).toBe(false);
      expect(canDismissSnapshotEmail(email, false)).toBe(false);
      expect(canReopenSnapshotEmail({ ...email, _lane: "handled" }, false)).toBe(false);
      expect(canMoveSnapshotEmailToLane(email, "fyi", false)).toBe(false);
    }

    expect(canHandleSnapshotEmail(snapshotEmail, true)).toBe(false);
    expect(canDismissSnapshotEmail(snapshotEmail, true)).toBe(false);
    expect(canReopenSnapshotEmail({ ...snapshotEmail, _lane: "handled" }, true)).toBe(false);
    expect(canMoveSnapshotEmailToLane(snapshotEmail, "fyi", true)).toBe(false);
  });

  it("restores handled and carryover rows to an actionable lane", () => {
    expect(getSnapshotReopenLane({ _lane: "carryover", lane: "noise" })).toBe("needs_attention");
    expect(getSnapshotReopenLane({ _lane: "handled", lane_at_snapshot: "fyi" })).toBe("fyi");
    expect(getSnapshotReopenLane({ _lane: "handled", lane_at_snapshot: "queued" })).toBe("needs_attention");
  });
});
