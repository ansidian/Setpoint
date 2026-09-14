import type * as Api from "../../api";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useInboxBatchActions from "./useInboxBatchActions";
import useInboxUndoSlot from "./useInboxUndoSlot";
import type { InboxEmailLike } from "./inboxTypes";

const provider = vi.hoisted(() => ({ rows: new Map<string, { uid: string; read: boolean; _lane?: string; handled_at?: string | null }>(), fail: new Set<string>(), writes: 0, active: 0, peak: 0, wait: null as null | (() => Promise<void>), refreshes: 0 }));
// test-architecture: allow-boundary-mock -- only the authenticated HTTP API is replaced; batch commands, policies, projections and Undo execute together.
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof Api>("../../api");
  const write = async (uid: string, patch?: object) => {
    provider.active++; provider.peak = Math.max(provider.peak, provider.active);
    try {
      await provider.wait?.();
      if (provider.fail.has(uid)) throw new Error("Provider rejected email");
      provider.writes++;
      if (patch) Object.assign(provider.rows.get(uid)!, patch); else provider.rows.delete(uid);
      return { ok: true };
    } finally { provider.active--; }
  };
  return { ...actual,
    markEmailAsRead: (uid: string) => write(uid, { read: true }), markEmailAsUnread: (uid: string) => write(uid, { read: false }),
    trashEmail: (uid: string) => write(uid), trashEmailOnExit: (uid: string) => { provider.rows.delete(uid); provider.writes++; },
    markSnapshotItemHandled: (uid: string) => write(uid, { _lane: "handled", handled_at: "server-timestamp" }),
    reopenSnapshotItem: (uid: string) => write(uid, { _lane: "needs_attention", handled_at: null }),
  };
});

const noReadUpdate = () => {};
function useHarness() {
  const [rows, setRows] = useState<InboxEmailLike[]>(() => [...provider.rows.values()].map(row => ({ ...row, snapshot_item_id: row.uid, _activeSnapshot: true })));
  const refresh = useCallback(async () => { provider.refreshes++; setRows([...provider.rows.values()].map(row => ({ ...row, snapshot_item_id: row.uid, _activeSnapshot: true }))); }, []);
  const undo = useInboxUndoSlot({ onActiveSnapshotRefresh: refresh });
  const batch = useInboxBatchActions({ sourceEmails: rows, scope: "current", readOnly: false, replaceUndoSlot: undo.replaceUndoSlot, finalizeUndoSlot: undo.finalizeUndoSlot, undoSlotRef: undo.undoSlotRef, undoing: undo.undo?.status === "undoing", refresh, updateRead: noReadUpdate });
  return { ...batch, rows: batch.projectRows(rows, true), undo, refresh };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  provider.rows = new Map(["a", "b", "c"].map(uid => [uid, { uid, read: false, _lane: "needs_attention" }]));
  provider.fail.clear(); provider.writes = 0; provider.refreshes = 0; provider.active = 0; provider.peak = 0; provider.wait = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("batch action owner", () => {
  it("rolls back only failures and groups successful changes into one Undo", async () => {
    provider.fail.add("b");
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "read"); });
    expect(result.current.rows.map(row => [row.uid, row.read])).toEqual([["a", true], ["b", false], ["c", true]]);
    expect(result.current.undo.undo?.message).toBe("2 emails updated; 1 failed");
    expect(provider.refreshes).toBe(1);
    await act(async () => { await result.current.undo.onUndo(); });
    expect([...provider.rows.values()].every(row => !row.read)).toBe(true);
    expect(provider.writes).toBe(4);
    expect(provider.refreshes).toBe(2);
  });
  it("defers the entire trash batch for six seconds and cancels it with Undo", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "trash"); });
    expect(result.current.rows).toEqual([]);
    expect(provider.rows.size).toBe(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5999); });
    expect(provider.writes).toBe(0);
    await act(async () => { await result.current.undo.onUndo(); await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.rows).toHaveLength(3);
    expect(provider.writes).toBe(0);
    expect(result.current.busy).toBe(false);
  });
  it("restores failed trash targets, reports partial failure, and refreshes once", async () => {
    provider.fail.add("b");
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "trash"); await vi.advanceTimersByTimeAsync(6000); });
    expect(result.current.rows.map(row => row.uid)).toEqual(["b"]);
    expect(result.current.undo.undo?.error).toBe("2 moved to trash; 1 failed. Failed emails restored.");
    expect(provider.refreshes).toBe(1);
    // Once provider absence was observed, a later external restoration is visible.
    provider.rows.set("a", { uid: "a", read: false });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.rows.map(row => row.uid)).toEqual(["b", "a"]);
  });
  it("captures targets, limits concurrency to four, and rejects overlapping batches", async () => {
    provider.rows = new Map(Array.from({ length: 9 }, (_, n) => [String(n), { uid: String(n), read: false }]));
    const releases: Array<() => void> = [];
    provider.wait = () => new Promise<void>(resolve => releases.push(resolve));
    const { result } = renderHook(useHarness);
    let operation: Promise<void>;
    act(() => { operation = result.current.execute(result.current.rows, "read"); });
    expect(provider.active).toBe(4);
    await act(async () => { await result.current.execute(result.current.rows.slice(0, 1), "trash"); });
    provider.wait = null;
    await act(async () => { releases.forEach(resolve => resolve()); await operation; });
    expect(provider.peak).toBe(4);
    expect(provider.writes).toBe(9);
    expect([...provider.rows.values()].every(row => row.read)).toBe(true);
  });
  it("reconciles server lifecycle timestamps so subsequent external changes win", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "handled"); });
    expect(result.current.rows.every(row => row.handled_at === "server-timestamp")).toBe(true);
    provider.rows.get("a")!._lane = "fyi"; provider.rows.get("a")!.handled_at = null;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.rows.find(row => row.uid === "a")?._lane).toBe("fyi");
  });
  it("reports partial Undo without a duplicate refresh", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "read"); });
    provider.fail.add("b");
    await act(async () => { await result.current.undo.onUndo(); });
    expect(result.current.rows.map(row => row.read)).toEqual([false, true, false]);
    expect(result.current.undo.undo?.error).toBe("2 undone; 1 could not be undone.");
    expect(provider.refreshes).toBe(2);
  });
  it("does not supersede a single-email Undo already in flight", async () => {
    const { result } = renderHook(useHarness);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    act(() => { result.current.undo.replaceUndoSlot({ type: "single-move", message: "Moved email", undo: () => pending }); });
    let undoing!: Promise<void>;
    act(() => { undoing = result.current.undo.onUndo(); });
    await act(async () => { await result.current.execute(result.current.rows, "read"); });
    expect(result.current.undo.undo?.status).toBe("undoing");
    expect(provider.writes).toBe(0);
    expect(result.current.busy).toBe(true);
    await act(async () => { release(); await undoing; });
    expect(result.current.busy).toBe(false);
  });
  it("commits each deferred trash target once on page exit", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => { await result.current.execute(result.current.rows, "trash"); });
    act(() => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("beforeunload")); });
    expect(provider.rows.size).toBe(0);
    expect(provider.writes).toBe(3);
  });
});
