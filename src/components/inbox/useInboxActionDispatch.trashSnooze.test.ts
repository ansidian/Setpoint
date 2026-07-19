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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
    expect(slot.type).toBe("snooze");
    await act(async () => {
      await slot.undo();
    });
    expect(api.unsnoozeEmail).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.setSelectedId).toHaveBeenCalledWith("gmail-a-msg-1");
  });

  it("rolls the snooze map back when the snooze request rejects", async () => {
    vi.mocked(api.snoozeEmail).mockRejectedValueOnce(new Error("snooze failed"));
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
