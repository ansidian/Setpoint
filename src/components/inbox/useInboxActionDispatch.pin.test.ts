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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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

    const slot = firstUndoSlot(calls.replaceUndoSlot);
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
    vi.mocked(api.pinEmail).mockRejectedValueOnce(new Error("pin failed"));
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
