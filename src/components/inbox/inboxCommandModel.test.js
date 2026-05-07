import { describe, expect, it } from "vitest";
import {
  applyLiveTrashOptimistic,
  applySnapshotTrashOptimistic,
  buildTrashCommand,
  shouldHandleInboxUndoHotkey,
} from "./inboxCommandModel.js";

describe("inbox command model", () => {
  it("keeps trash command semantics provider-honest by email origin", () => {
    expect(buildTrashCommand({ id: "live-1", uid: "live-1", _live: true })).toMatchObject({
      allowed: true,
      scope: "live",
      uid: "live-1",
      restoreSelectedId: "live-1",
      refreshAfterCommit: true,
    });

    expect(buildTrashCommand({
      id: "snapshot-1",
      uid: "gmail-a-msg-1",
      _activeSnapshot: true,
      snapshot_item_id: 42,
    })).toMatchObject({
      allowed: true,
      scope: "activeSnapshot",
      uid: "gmail-a-msg-1",
      itemId: "42",
      restoreSelectedId: "snapshot-1",
      refreshAfterCommit: true,
    });

    expect(buildTrashCommand({ id: "briefing-1" })).toMatchObject({
      allowed: true,
      scope: "briefing",
      id: "briefing-1",
      uid: "briefing-1",
      refreshAfterCommit: false,
    });
  });

  it("blocks read-only and catch-up trash commands", () => {
    expect(buildTrashCommand({ id: "email-1" }, { readOnly: true })).toEqual({ allowed: false });
    expect(buildTrashCommand({ id: "catch-up", _catchUp: true })).toEqual({ allowed: false });
  });

  it("applies and restores local trash optimism by origin", () => {
    const live = applyLiveTrashOptimistic(new Set(), "uid-1", true);
    expect([...live]).toEqual(["uid-1"]);
    expect([...applyLiveTrashOptimistic(live, "uid-1", false)]).toEqual([]);

    const hidden = applySnapshotTrashOptimistic(new Map(), "42", true);
    expect(hidden.get("42")).toMatchObject({
      hidden: true,
      pendingAction: "trash",
      pending: false,
    });
    expect(applySnapshotTrashOptimistic(hidden, "42", false).has("42")).toBe(false);
  });

  it("scopes Cmd/Ctrl+Z to a live undo slot outside editable targets", () => {
    expect(shouldHandleInboxUndoHotkey({
      key: "z",
      metaKey: true,
      hasUndoSlot: true,
      editableTarget: false,
    })).toBe(true);
    expect(shouldHandleInboxUndoHotkey({
      key: "z",
      metaKey: true,
      hasUndoSlot: true,
      editableTarget: true,
    })).toBe(false);
    expect(shouldHandleInboxUndoHotkey({
      key: "z",
      metaKey: true,
      hasUndoSlot: false,
      editableTarget: false,
    })).toBe(false);
  });
});
