import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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

  it("reverts both optimistic read projections when marking an email read fails", async () => {
    vi.mocked(api.markEmailAsRead).mockRejectedValueOnce(new Error("mark-read failed"));
    const email = snapshotEmail({ read: false });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("toggle-read");
      await Promise.resolve();
    });

    expect(calls.onLiveReadOverrideChange.mock.calls).toEqual([
      ["gmail-a-msg-1", true],
      ["gmail-a-msg-1", false],
    ]);
    expect(calls.updateIndexedSearchRead.mock.calls).toEqual([
      ["gmail-a-msg-1", true],
      ["gmail-a-msg-1", false],
    ]);
    expect(calls.closeSelectedEmail).not.toHaveBeenCalled();
    expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
  });

  it("keeps both optimistic read projections without a revert when marking read succeeds", async () => {
    const email = snapshotEmail({ read: false });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("toggle-read");
      await Promise.resolve();
    });

    expect(calls.onLiveReadOverrideChange.mock.calls).toEqual([
      ["gmail-a-msg-1", true],
    ]);
    expect(calls.updateIndexedSearchRead.mock.calls).toEqual([
      ["gmail-a-msg-1", true],
    ]);
    expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
  });

  it("toggling a read email to unread marks unread and closes the reader", () => {
    const email = snapshotEmail({ read: true });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    act(() => { dispatch()("toggle-read"); });

    expect(api.markEmailAsUnread).toHaveBeenCalledWith("gmail-a-msg-1");
    expect(calls.onLiveReadOverrideChange).toHaveBeenCalledWith("gmail-a-msg-1", false);
    expect(calls.closeSelectedEmail).toHaveBeenCalledTimes(1);
  });

  it("reverts both optimistic read projections but does not reopen the reader when marking unread fails", async () => {
    vi.mocked(api.markEmailAsUnread).mockRejectedValueOnce(new Error("mark-unread failed"));
    const email = snapshotEmail({ read: true });
    const { dispatch, calls } = makeHarness({ selectedEmail: email });

    await act(async () => {
      dispatch()("toggle-read");
      await Promise.resolve();
    });

    expect(calls.onLiveReadOverrideChange.mock.calls).toEqual([
      ["gmail-a-msg-1", false],
      ["gmail-a-msg-1", true],
    ]);
    expect(calls.updateIndexedSearchRead.mock.calls).toEqual([
      ["gmail-a-msg-1", false],
      ["gmail-a-msg-1", true],
    ]);
    expect(calls.closeSelectedEmail).toHaveBeenCalledTimes(1);
    expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
  });

  it("sets a screen-reader announcement when toggling read (a silent, non-toast mutation)", async () => {
    const email = snapshotEmail({ read: false });
    const { dispatch, calls, announcement } = makeHarness({ selectedEmail: email });

    expect(announcement()).toBe("");

    act(() => { dispatch()("toggle-read"); });
    // The real text lands via a microtask (see announce() in
    // useInboxActionDispatch.ts) so it always goes through an empty→text
    // transition; immediately after the synchronous dispatch it's still "".
    expect(announcement()).toBe("");
    await act(async () => { await Promise.resolve(); });

    expect(announcement()).toBe("Marked as read");
    // Silent mutation: no undo toast is produced for toggle-read.
    expect(calls.replaceUndoSlot).not.toHaveBeenCalled();
  });

  it("replaces the announcement text on a subsequent toggle-read", async () => {
    const { dispatch, announcement, rerenderWith } = makeHarness({
      selectedEmail: snapshotEmail({ read: false }),
    });

    act(() => { dispatch()("toggle-read"); });
    await act(async () => { await Promise.resolve(); });
    expect(announcement()).toBe("Marked as read");

    // Simulate the parent re-rendering with the now-read email, as happens in
    // the real component after the optimistic read-state update propagates.
    rerenderWith({ selectedEmail: snapshotEmail({ read: true }) });
    act(() => { dispatch()("toggle-read"); });
    await act(async () => { await Promise.resolve(); });

    expect(announcement()).toBe("Marked as unread");
  });

  it("forces a fresh empty→text DOM transition on back-to-back identical toggle-read announcements", async () => {
    // Two different emails that both happen to produce the SAME announcement
    // text ("Marked as unread") back-to-back — a realistic repeated-triage
    // pattern. Without the clear-then-set two-step, React's identical-value
    // setState bailout means the DOM text node never actually changes and
    // most screen readers would not re-announce the second action.
    const emailA = snapshotEmail({ id: "gmail-a-msg-1", uid: "gmail-a-msg-1", read: true });
    const emailB = snapshotEmail({ id: "gmail-a-msg-2", uid: "gmail-a-msg-2", read: true });
    const { dispatch, announcement, rerenderWith } = makeHarness({ selectedEmail: emailA });

    act(() => { dispatch()("toggle-read"); });
    await act(async () => { await Promise.resolve(); });
    expect(announcement()).toBe("Marked as unread");

    rerenderWith({ selectedEmail: emailB });
    act(() => { dispatch()("toggle-read"); });

    // Immediately after the synchronous dispatch — before the microtask that
    // sets the real text has flushed — the announcement must already have
    // been cleared back to "". This proves a genuine, distinct state
    // transition occurs even though the final text is identical to the
    // previous announcement, not just a same-value no-op.
    expect(announcement()).toBe("");

    await act(async () => { await Promise.resolve(); });
    expect(announcement()).toBe("Marked as unread");
  });
});
