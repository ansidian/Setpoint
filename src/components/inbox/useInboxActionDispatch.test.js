import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  markEmailAsRead: vi.fn().mockResolvedValue({}),
  markEmailAsUnread: vi.fn().mockResolvedValue({}),
  trashEmail: vi.fn().mockResolvedValue({}),
  trashEmailOnExit: vi.fn(),
  snoozeEmail: vi.fn().mockResolvedValue({}),
  unsnoozeEmail: vi.fn().mockResolvedValue({}),
  moveSnapshotItemLane: vi.fn().mockResolvedValue({}),
  dismissSnapshotItemForToday: vi.fn().mockResolvedValue({}),
  restoreSnapshotItemForToday: vi.fn().mockResolvedValue({}),
  markSnapshotItemHandled: vi.fn().mockResolvedValue({}),
  reopenSnapshotItem: vi.fn().mockResolvedValue({}),
  pinEmail: vi.fn().mockResolvedValue({}),
  unpinEmail: vi.fn().mockResolvedValue({}),
}));

const api = await import("../../api");
const { default: useInboxActionDispatch } = await import("./useInboxActionDispatch.js");

const NOW = new Date("2026-05-03T15:00:00.000Z");

function makeHarness(overrides = {}) {
  const calls = {
    moveBy: vi.fn(),
    onLiveReadOverrideChange: vi.fn(),
    closeSelectedEmail: vi.fn(),
    updateIndexedSearchRead: vi.fn(),
    onActiveSnapshotRefresh: vi.fn().mockResolvedValue({}),
    replaceUndoSlot: vi.fn(),
    setSelectedId: vi.fn(),
    setLiveTrashedUids: vi.fn(),
    setSnapshotOptimistic: vi.fn(),
    setSnoozedMap: vi.fn(),
    setPinnedOverrides: vi.fn(),
  };
  const snapshotPendingRef = { current: new Set() };
  const snapshotRequestRef = { current: 0 };
  const props = {
    selectedEmail: null,
    readOnly: false,
    snapshotPendingRef,
    snapshotRequestRef,
    ...calls,
    ...overrides,
  };
  const { result } = renderHook((p) => useInboxActionDispatch(p), { initialProps: props });
  return { dispatch: () => result.current, calls, snapshotPendingRef, snapshotRequestRef, result };
}

function snapshotEmail(overrides = {}) {
  return {
    id: "gmail-a-msg-1",
    uid: "gmail-a-msg-1",
    snapshot_item_id: 42,
    _activeSnapshot: true,
    _lane: "needs_attention",
    lane: "needs_attention",
    subject: "Review the lease",
    read: false,
    ...overrides,
  };
}

// Apply a functional state updater against a seed to observe its effect.
function applyUpdater(mockFn, seed, callIndex = 0) {
  const updater = mockFn.mock.calls[callIndex][0];
  return updater(seed);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useInboxActionDispatch snapshot command builders", () => {
  it("moves a lane: paints the override, calls the lane API, advanceAfter=false, undo restores the prior lane", async () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-move-lane", "fyi");
      await Promise.resolve();
    });

    expect(api.moveSnapshotItemLane).toHaveBeenCalledWith(42, "fyi");
    // Lane move does not advance selection.
    expect(calls.moveBy).not.toHaveBeenCalled();

    const overlay = applyUpdater(calls.setSnapshotOptimistic, new Map()).get("42");
    expect(overlay).toMatchObject({
      laneOverride: "fyi",
      hidden: false,
      pendingAction: "move-lane",
      pending: true,
    });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot).toMatchObject({ type: "snapshot-move-lane", message: "Moved to FYI" });

    await act(async () => {
      await slot.undo();
    });
    expect(api.moveSnapshotItemLane).toHaveBeenLastCalledWith(42, "needs_attention");
    expect(calls.setSelectedId).toHaveBeenCalledWith("gmail-a-msg-1");
  });

  it("dismiss: hides the row, calls dismiss API, advances selection, undo restores via restore API", async () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-dismiss");
      await Promise.resolve();
    });

    expect(api.dismissSnapshotItemForToday).toHaveBeenCalledWith(42);
    expect(calls.moveBy).toHaveBeenCalledWith(1);

    const overlay = applyUpdater(calls.setSnapshotOptimistic, new Map()).get("42");
    expect(overlay).toMatchObject({ hidden: true, pendingAction: "dismiss", pending: true });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot.message).toBe("Email dismissed");
    await act(async () => {
      await slot.undo();
    });
    expect(api.restoreSnapshotItemForToday).toHaveBeenCalledWith(42);
    // removeOverlay undo path deletes the overlay entirely.
    const afterUndo = applyUpdater(
      calls.setSnapshotOptimistic,
      new Map([["42", { hidden: true }]]),
      calls.setSnapshotOptimistic.mock.calls.length - 1,
    );
    expect(afterUndo.has("42")).toBe(false);
  });

  it("handled: overlays handled state, calls handled API, advances, undo reopens to the reopen lane", async () => {
    const email = snapshotEmail({ _lane: "fyi", lane: "fyi" });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-handled");
      await Promise.resolve();
    });

    expect(api.markSnapshotItemHandled).toHaveBeenCalledWith(42);
    expect(calls.moveBy).toHaveBeenCalledWith(1);

    const overlay = applyUpdater(calls.setSnapshotOptimistic, new Map()).get("42");
    expect(overlay).toMatchObject({
      laneOverride: "handled",
      statusOverride: "handled",
      pendingAction: "handled",
      handledAt: NOW.toISOString(),
    });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    await act(async () => {
      await slot.undo();
    });
    expect(api.reopenSnapshotItem).toHaveBeenCalledWith(42);
    const restored = applyUpdater(
      calls.setSnapshotOptimistic,
      new Map(),
      calls.setSnapshotOptimistic.mock.calls.length - 1,
    ).get("42");
    expect(restored).toMatchObject({ laneOverride: "fyi", statusOverride: null, pendingAction: "undo-handled" });
  });

  it("reopen: restores the reopen lane, calls reopen API, advanceAfter=false, undo re-marks handled", async () => {
    const email = snapshotEmail({
      _lane: "handled",
      lane: "needs_attention",
      handled_at: "2026-05-03T16:00:00.000Z",
    });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-reopen");
      await Promise.resolve();
    });

    expect(api.reopenSnapshotItem).toHaveBeenCalledWith(42);
    expect(calls.moveBy).not.toHaveBeenCalled();

    const overlay = applyUpdater(calls.setSnapshotOptimistic, new Map()).get("42");
    expect(overlay).toMatchObject({
      laneOverride: "needs_attention",
      statusOverride: null,
      handledAt: null,
      pendingAction: "reopen",
    });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    await act(async () => {
      await slot.undo();
    });
    expect(api.markSnapshotItemHandled).toHaveBeenCalledWith(42);
  });

  it("skips a no-op lane-move undo (same lane) without calling the API", async () => {
    const email = snapshotEmail({ _lane: "fyi", lane: "fyi" });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-move-lane", "fyi");
      await Promise.resolve();
    });
    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    api.moveSnapshotItemLane.mockClear();
    await act(async () => {
      await slot.undo();
    });
    expect(api.moveSnapshotItemLane).not.toHaveBeenCalled();
  });

  it("guards snapshot commands: catch-up, read-only, missing item, in-flight item, and disallowed lane", async () => {
    // catch-up email is never mutated
    {
      const { dispatch, calls } = makeHarness({
        selectedEmail: snapshotEmail({ _lane: "catch_up" }),
      });
      await act(async () => { dispatch()("snapshot-handled"); await Promise.resolve(); });
      expect(api.markSnapshotItemHandled).not.toHaveBeenCalled();
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
    }
    // read-only freezes mutations
    {
      const { dispatch, calls } = makeHarness({
        selectedEmail: snapshotEmail(),
        readOnly: true,
      });
      await act(async () => { dispatch()("snapshot-dismiss"); await Promise.resolve(); });
      expect(api.dismissSnapshotItemForToday).not.toHaveBeenCalled();
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
    }
    // handled is disallowed on an already-handled row (builder returns null)
    {
      const { dispatch, calls } = makeHarness({
        selectedEmail: snapshotEmail({ _lane: "handled" }),
      });
      await act(async () => { dispatch()("snapshot-handled"); await Promise.resolve(); });
      expect(api.markSnapshotItemHandled).not.toHaveBeenCalled();
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
    }
    // already-pending item is suppressed
    {
      const snapshotPendingRef = { current: new Set(["42"]) };
      const { dispatch, calls } = makeHarness({
        selectedEmail: snapshotEmail(),
        snapshotPendingRef,
      });
      await act(async () => { dispatch()("snapshot-dismiss"); await Promise.resolve(); });
      expect(api.dismissSnapshotItemForToday).not.toHaveBeenCalled();
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
    }
  });

  it("releases the pending lock and clears pending on a settled command", async () => {
    const email = snapshotEmail();
    const { dispatch, calls, snapshotPendingRef } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-dismiss");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(snapshotPendingRef.current.has("42")).toBe(false);
    // The settle pass flips the overlay's pending flag off (requestToken match).
    const settled = applyUpdater(
      calls.setSnapshotOptimistic,
      new Map([["42", { hidden: true, pending: true, requestToken: 1 }]]),
      calls.setSnapshotOptimistic.mock.calls.length - 1,
    ).get("42");
    expect(settled.pending).toBe(false);
  });

  it("rolls back the overlay and refreshes when a snapshot command rejects", async () => {
    api.markSnapshotItemHandled.mockRejectedValueOnce(new Error("stale snapshot"));
    const email = snapshotEmail();
    const { dispatch, calls, snapshotPendingRef } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("snapshot-handled");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.onActiveSnapshotRefresh).toHaveBeenCalled();
    expect(snapshotPendingRef.current.has("42")).toBe(false);
    const rolledBack = applyUpdater(
      calls.setSnapshotOptimistic,
      new Map([["42", { laneOverride: "handled", requestToken: 1 }]]),
      calls.setSnapshotOptimistic.mock.calls.length - 1,
    );
    expect(rolledBack.has("42")).toBe(false);
  });
});

describe("useInboxActionDispatch trash routing", () => {
  it("routes a live email to live optimism and a deferred provider commit", async () => {
    const email = { id: "live-1", uid: "live-1", _live: true, read: false };
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => {
      dispatch()("trash");
    });

    const trashed = applyUpdater(calls.setLiveTrashedUids, new Set());
    expect([...trashed]).toEqual(["live-1"]);
    expect(calls.moveBy).toHaveBeenCalledWith(1);

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot).toMatchObject({ type: "trash", message: "Email moved to trash" });
    // The provider call is deferred until commit, not at dispatch time.
    expect(api.trashEmail).not.toHaveBeenCalled();

    await act(async () => {
      await slot.commit();
    });
    expect(api.trashEmail).toHaveBeenCalledWith("live-1");
    expect(calls.onActiveSnapshotRefresh).toHaveBeenCalled();

    slot.commitOnExit();
    expect(api.trashEmailOnExit).toHaveBeenCalledWith("live-1");

    // Undo lifts the optimistic trash and restores selection.
    await act(async () => {
      await slot.undo();
    });
    const restored = applyUpdater(
      calls.setLiveTrashedUids,
      new Set(["live-1"]),
      calls.setLiveTrashedUids.mock.calls.length - 1,
    );
    expect([...restored]).toEqual([]);
    expect(calls.setSelectedId).toHaveBeenCalledWith("live-1");
  });

  it("routes an active-snapshot email to snapshot optimism with a deferred commit", async () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => {
      dispatch()("trash");
    });

    const overlay = applyUpdater(calls.setSnapshotOptimistic, new Map()).get("42");
    expect(overlay).toMatchObject({ hidden: true, pendingAction: "trash" });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(api.trashEmail).not.toHaveBeenCalled();
    await act(async () => {
      await slot.commit();
    });
    expect(api.trashEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    slot.commitOnExit();
    expect(api.trashEmailOnExit).toHaveBeenCalledWith("gmail-a-msg-1");
  });

  it("routes a briefing email to a commit that trashes without a snapshot refresh", async () => {
    const email = { id: "briefing-1", uid: "briefing-1", read: false };
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => {
      dispatch()("trash");
    });

    expect(calls.setLiveTrashedUids).not.toHaveBeenCalled();
    expect(calls.setSnapshotOptimistic).not.toHaveBeenCalled();

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    await act(async () => {
      await slot.commit();
    });
    expect(api.trashEmail).toHaveBeenCalledWith("briefing-1");
    // Briefing trash does not refresh the active snapshot.
    expect(calls.onActiveSnapshotRefresh).not.toHaveBeenCalled();
  });

  it("blocks trash for read-only and catch-up emails", () => {
    {
      const { dispatch, calls } = makeHarness({
        selectedEmail: { id: "x", uid: "x", _live: true },
        readOnly: true,
      });
      act(() => { dispatch()("trash"); });
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
      expect(calls.moveBy).not.toHaveBeenCalled();
    }
    {
      const { dispatch, calls } = makeHarness({
        selectedEmail: { id: "c", uid: "c", _catchUp: true },
      });
      act(() => { dispatch()("trash"); });
      expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
    }
  });
});

describe("useInboxActionDispatch optimistic snooze", () => {
  it("optimistically snoozes, calls snoozeEmail with the row snapshot, and advances", async () => {
    const email = snapshotEmail({ from: "Dana", fromEmail: "dana@example.com", preview: "hi" });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });
    const until = NOW.getTime() + 6 * 60 * 60 * 1000;

    act(() => {
      dispatch()("snooze", until);
    });

    const snoozed = applyUpdater(calls.setSnoozedMap, new Map());
    expect(snoozed.get("gmail-a-msg-1")).toBe(until);
    expect(api.snoozeEmail).toHaveBeenCalledWith(
      "gmail-a-msg-1",
      until,
      expect.objectContaining({ uid: "gmail-a-msg-1", subject: "Review the lease" }),
    );
    expect(calls.moveBy).toHaveBeenCalledWith(1);

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot.type).toBe("snooze");
    await act(async () => {
      await slot.undo();
    });
    expect(api.unsnoozeEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.setSelectedId).toHaveBeenCalledWith("gmail-a-msg-1");
  });

  it("rolls the snooze map back when the snooze request rejects", async () => {
    api.snoozeEmail.mockRejectedValueOnce(new Error("snooze failed"));
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });
    const until = NOW.getTime() + 60 * 60 * 1000;

    await act(async () => {
      dispatch()("snooze", until);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The rejection rollback removes the optimistic entry.
    const rolledBack = applyUpdater(
      calls.setSnoozedMap,
      new Map([["gmail-a-msg-1", until]]),
      calls.setSnoozedMap.mock.calls.length - 1,
    );
    expect(rolledBack.has("gmail-a-msg-1")).toBe(false);
  });

  it("rejects a snooze timestamp that is not in the future", () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => {
      dispatch()("snooze", NOW.getTime() - 1000);
    });

    expect(api.snoozeEmail).not.toHaveBeenCalled();
    expect(calls.setSnoozedMap).not.toHaveBeenCalled();
    expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
  });
});

describe("useInboxActionDispatch navigation and read toggle", () => {
  it("moves selection forward and backward without touching the API", () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => { dispatch()("next"); });
    expect(calls.moveBy).toHaveBeenLastCalledWith(1);
    act(() => { dispatch()("prev"); });
    expect(calls.moveBy).toHaveBeenLastCalledWith(-1);
  });

  it("toggling an unread email to read marks read and updates the search index", () => {
    const email = snapshotEmail({ read: false });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => { dispatch()("toggle-read"); });

    expect(api.markEmailAsRead).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.onLiveReadOverrideChange).toHaveBeenCalledWith("gmail-a-msg-1", true);
    expect(calls.updateIndexedSearchRead).toHaveBeenCalledWith("gmail-a-msg-1", true);
    expect(calls.closeSelectedEmail).not.toHaveBeenCalled();
  });

  it("toggling a read email to unread marks unread and closes the reader", () => {
    const email = snapshotEmail({ read: true });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => { dispatch()("toggle-read"); });

    expect(api.markEmailAsUnread).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.onLiveReadOverrideChange).toHaveBeenCalledWith("gmail-a-msg-1", false);
    expect(calls.closeSelectedEmail).toHaveBeenCalledTimes(1);
  });
});

describe("useInboxActionDispatch pin-toggle", () => {
  it("pins an unpinned email: calls pinEmail with a snapshot, sets the override optimistically, undo calls unpinEmail", async () => {
    const email = snapshotEmail({ from: "Dana", fromEmail: "dana@example.com", preview: "hi" });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("pin-toggle");
      await Promise.resolve();
    });

    expect(api.pinEmail).toHaveBeenCalledWith(
      "gmail-a-msg-1",
      expect.objectContaining({ uid: "gmail-a-msg-1", subject: "Review the lease" }),
    );
    expect(api.unpinEmail).not.toHaveBeenCalled();

    const override = applyUpdater(calls.setPinnedOverrides, new Map()).get("gmail-a-msg-1");
    expect(override).toMatchObject({ pinned: true });
    expect(override.entry).toMatchObject({ uid: "gmail-a-msg-1" });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot).toMatchObject({ type: "pin-toggle", message: "Email pinned" });

    await act(async () => {
      await slot.undo();
    });
    expect(api.unpinEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.onActiveSnapshotRefresh).toHaveBeenCalled();
    // Undo also rolls the override back off the map.
    const afterUndo = applyUpdater(
      calls.setPinnedOverrides,
      new Map([["gmail-a-msg-1", { pinned: true }]]),
      calls.setPinnedOverrides.mock.calls.length - 1,
    );
    expect(afterUndo.has("gmail-a-msg-1")).toBe(false);
  });

  it("unpins a _pinned email: calls unpinEmail; undo re-pins", async () => {
    const email = snapshotEmail({ _pinned: true });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("pin-toggle");
      await Promise.resolve();
    });

    expect(api.unpinEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(api.pinEmail).not.toHaveBeenCalled();

    const override = applyUpdater(calls.setPinnedOverrides, new Map()).get("gmail-a-msg-1");
    expect(override).toMatchObject({ pinned: false, entry: null });

    const slot = calls.replaceUndoSlot.mock.calls[0][0];
    expect(slot).toMatchObject({ type: "pin-toggle", message: "Email unpinned" });

    await act(async () => {
      await slot.undo();
    });
    expect(api.pinEmail).toHaveBeenCalledWith(
      "gmail-a-msg-1",
      expect.objectContaining({ uid: "gmail-a-msg-1" }),
    );
  });

  it("works when readOnly === true (no early return)", async () => {
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email, readOnly: true });

    await act(async () => {
      dispatch()("pin-toggle");
      await Promise.resolve();
    });

    expect(api.pinEmail).toHaveBeenCalledWith("gmail-a-msg-1", expect.any(Object));
    expect(calls.replaceUndoSlot).toHaveBeenCalled();
    expect(calls.setPinnedOverrides).toHaveBeenCalled();
  });

  it("rolls the optimistic override back when the API call rejects", async () => {
    api.pinEmail.mockRejectedValueOnce(new Error("pin failed"));
    const email = snapshotEmail();
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("pin-toggle");
      await Promise.resolve();
      await Promise.resolve();
    });

    const rolledBack = applyUpdater(
      calls.setPinnedOverrides,
      new Map([["gmail-a-msg-1", { pinned: true, entry: {} }]]),
      calls.setPinnedOverrides.mock.calls.length - 1,
    );
    expect(rolledBack.has("gmail-a-msg-1")).toBe(false);
  });
});
