import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Activity, createElement, Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useInboxUndoSlot from "./useInboxUndoSlot";

const INBOX_UNDO_WINDOW_MS = 6_000;
const ERROR_TOAST_MS = 4_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-05-03T15:00:00.000Z"));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useInboxUndoSlot", () => {
  it("dismisses a settled toast when its keep-alive view is hidden", async () => {
    let commitCount = 0;
    const commit = async () => { commitCount += 1; };

    function Harness() {
      const controller = useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() });
      return createElement(
        Fragment,
        null,
        createElement(
          "button",
          {
            type: "button",
            onClick: () => controller.replaceUndoSlot({
              type: "trash",
              message: "Email moved to trash",
              commit,
            }),
          },
          "Trash email",
        ),
        controller.undo ? createElement("div", null, controller.undo.message) : null,
      );
    }

    const visibleTree = createElement(
      Activity,
      { mode: "visible", children: createElement(Harness) },
    );
    const hiddenTree = createElement(
      Activity,
      { mode: "hidden", children: createElement(Harness) },
    );
    const { rerender } = render(visibleTree);

    fireEvent.click(screen.getByRole("button", { name: "Trash email" }));
    expect(screen.getByText("Email moved to trash")).toBeTruthy();

    rerender(hiddenTree);
    await act(async () => {
      await Promise.resolve();
    });
    rerender(visibleTree);

    expect(commitCount).toBe(1);
    expect(screen.queryByText("Email moved to trash")).toBeNull();
  });

  it("surfaces a ready slot then auto-commits once the undo window elapses", async () => {
    let commitCount = 0;
    const commit = async () => { commitCount += 1; };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", commit });
    });

    expect(result.current.undo).toMatchObject({ status: "ready", message: "Email moved to trash" });
    expect(commitCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(INBOX_UNDO_WINDOW_MS);
      await Promise.resolve();
    });

    expect(commitCount).toBe(1);
    expect(result.current.undo).toBeNull();
  });

  it("commits the pending slot at most once across timer fire and explicit finalize", async () => {
    let commitCount = 0;
    const commit = async () => { commitCount += 1; };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", commit });
    });

    await act(async () => {
      result.current.finalizeUndoSlot();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(INBOX_UNDO_WINDOW_MS);
      await Promise.resolve();
    });

    expect(commitCount).toBe(1);
  });

  it("finalizes the previous slot before installing a replacement", async () => {
    let firstCommitCount = 0;
    let secondCommitCount = 0;
    const firstCommit = async () => { firstCommitCount += 1; };
    const secondCommit = async () => { secondCommitCount += 1; };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "First", commit: firstCommit });
    });
    await act(async () => {
      result.current.replaceUndoSlot({ type: "snooze", message: "Second", commit: secondCommit });
      await Promise.resolve();
    });

    expect(firstCommitCount).toBe(1);
    expect(secondCommitCount).toBe(0);
    expect(result.current.undo).toMatchObject({ status: "ready", message: "Second" });
  });

  it("runs the undo callback and clears the slot without committing", async () => {
    let commitCount = 0;
    let undoCount = 0;
    const commit = async () => { commitCount += 1; };
    const undo = async () => { undoCount += 1; };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", commit, undo });
    });

    await act(async () => {
      await result.current.onUndo();
    });

    expect(undoCount).toBe(1);
    expect(result.current.undo).toBeNull();

    // The expired timer must not commit a slot the user already undid.
    await act(async () => {
      vi.advanceTimersByTime(INBOX_UNDO_WINDOW_MS);
      await Promise.resolve();
    });
    expect(commitCount).toBe(0);
  });

  it("ignores a second undo while the first is in flight", async () => {
    let resolveUndo: ((value?: unknown) => void) | undefined;
    let undoCount = 0;
    const undo = () => { undoCount += 1; return new Promise((resolve) => { resolveUndo = resolve; }); };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", undo });
    });

    let firstUndo: Promise<void> | undefined;
    act(() => {
      firstUndo = result.current.onUndo();
    });
    expect(result.current.undo).toMatchObject({ status: "undoing" });

    await act(async () => {
      await result.current.onUndo();
    });
    expect(undoCount).toBe(1);

    await act(async () => {
      resolveUndo?.();
      await firstUndo;
    });
    expect(result.current.undo).toBeNull();
  });

  it("shows an error toast and refreshes when undo rejects", async () => {
    let refreshCount = 0;
    const onActiveSnapshotRefresh = () => { refreshCount += 1; };
    const undo = async () => { throw new Error("Undo exploded"); };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", undo });
    });
    await act(async () => {
      await result.current.onUndo();
    });

    expect(result.current.undo).toMatchObject({ status: "error", error: "Undo exploded" });
    expect(refreshCount).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(ERROR_TOAST_MS);
    });
    expect(result.current.undo).toBeNull();
  });

  it("shows an error toast and refreshes when the auto-commit rejects", async () => {
    let refreshCount = 0;
    let commitCount = 0;
    const onActiveSnapshotRefresh = () => { refreshCount += 1; };
    const commit = async () => { commitCount += 1; throw new Error("Commit failed"); };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", commit });
    });
    await act(async () => {
      vi.advanceTimersByTime(INBOX_UNDO_WINDOW_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitCount).toBe(1);
    expect(result.current.undo).toMatchObject({ status: "error", error: "Commit failed" });
    expect(refreshCount).toBe(1);
  });

  it("uses the keepalive exit commit when the page exits before the window closes", () => {
    let commitCount = 0;
    let exitCommitCount = 0;
    const commit = async () => { commitCount += 1; };
    const commitOnExit = () => { exitCommitCount += 1; };
    const { result } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh: vi.fn() }));

    act(() => {
      result.current.replaceUndoSlot({
        type: "trash",
        message: "Email moved to trash",
        commit,
        commitOnExit,
      });
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(exitCommitCount).toBe(1);
    expect(commitCount).toBe(0);
  });

  it("settles a pending commit on unmount without reporting errors", async () => {
    let refreshCount = 0;
    let commitCount = 0;
    const onActiveSnapshotRefresh = () => { refreshCount += 1; };
    const commit = async () => { commitCount += 1; throw new Error("unmount commit failed"); };
    const { result, unmount } = renderHook(() => useInboxUndoSlot({ onActiveSnapshotRefresh }));

    act(() => {
      result.current.replaceUndoSlot({ type: "trash", message: "Email moved to trash", commit });
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitCount).toBe(1);
    // Unmount settle silences error reporting and snapshot refresh.
    expect(refreshCount).toBe(0);
  });
});
