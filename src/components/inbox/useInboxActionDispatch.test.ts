import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { InboxEmailLike } from "./inboxTypes";
import type { InboxActionDispatchOptions } from "./useInboxActionDispatch";

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
const { default: useInboxActionDispatch } = await import("./useInboxActionDispatch");

const NOW = new Date("2026-05-03T15:00:00.000Z");

interface TestUndoSlot {
  type: string;
  message: string;
  undo: () => Promise<unknown>;
  commit: () => Promise<unknown>;
  commitOnExit: () => unknown;
}

function firstUndoSlot(replaceUndoSlot: Mock): TestUndoSlot {
  return replaceUndoSlot.mock.calls[0]![0] as TestUndoSlot;
}

function makeHarness(overrides: Partial<InboxActionDispatchOptions> = {}) {
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
  const snapshotPendingRef = { current: new Set<string>() };
  const snapshotRequestRef = { current: 0 };
  const props: InboxActionDispatchOptions = {
    selectedEmail: null,
    readOnly: false,
    snapshotPendingRef,
    snapshotRequestRef,
    ...calls,
    ...overrides,
  };
  const { result, rerender } = renderHook((p) => useInboxActionDispatch(p), { initialProps: props });
  return {
    dispatch: () => result.current.onAction,
    announcement: () => result.current.announcement,
    rerenderWith: (partialOverrides: Partial<InboxActionDispatchOptions>) => rerender({ ...props, ...partialOverrides }),
    calls,
    snapshotPendingRef,
    snapshotRequestRef,
    result,
  };
}

function snapshotEmail(overrides: Partial<InboxEmailLike> = {}): InboxEmailLike {
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
function applyUpdater<T>(mockFn: Mock, seed: T, callIndex = 0): T {
  const updater = mockFn.mock.calls[callIndex]![0] as (value: T) => T;
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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
    const slot = firstUndoSlot(calls.replaceUndoSlot);
    vi.mocked(api.moveSnapshotItemLane).mockClear();
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
    expect(settled?.pending).toBe(false);
  });

  it("rolls back the overlay and refreshes when a snapshot command rejects", async () => {
    vi.mocked(api.markSnapshotItemHandled).mockRejectedValueOnce(new Error("stale snapshot"));
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
