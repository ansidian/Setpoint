import type * as Api from "../../api";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useInboxController from "./useInboxController";
import { DEFAULT_INBOX_SESSION } from "./useInboxSessionState";
import type { InboxSessionState } from "./useInboxSessionState";
import { makeInboxAccounts, makeLiveInboxEmail } from "./test-utils/inboxFixtures";
import { emailSelectionKey } from "./inboxBatchModel";

const provider = vi.hoisted(() => ({ read: new Set<string>(), trashed: new Set<string>() }));
// test-architecture: allow-boundary-mock -- the HTTP API is the only replaced collaborator; selection, controller, read timer and batch owner run together.
vi.mock("../../api", async () => ({
  ...await vi.importActual<typeof Api>("../../api"),
  fetchSnoozedEmails: async () => [],
  markEmailAsRead: async (uid: string) => { provider.read.add(uid); return { ok: true }; },
  trashEmail: async (uid: string) => { if (uid === "b") throw new Error("Failed"); provider.trashed.add(uid); return { ok: true }; },
}));
const accounts = makeInboxAccounts();
const rows = ["a", "b", "c"].map(uid => makeLiveInboxEmail({ uid, id: uid }));
const empty: [] = [];
const refresh = async () => {};

function useHarness({ mobile = false, snapshotKey = 0 } = {}) {
  const [session, setSession] = useState<InboxSessionState>({ ...DEFAULT_INBOX_SESSION });
  const controller = useInboxController({ emailAccounts: accounts, liveEmails: rows, sessionState: session, onSessionStateChange: setSession,
    isMobile: mobile, commitPendingUndoSignal: snapshotKey, snoozedEntries: empty, resurfacedEntries: empty, onActiveSnapshotRefresh: refresh });
  const { reportDisplayed } = controller.batchSelection;
  const signature = JSON.stringify(controller.visibleEmails.map(emailSelectionKey));
  useEffect(() => { reportDisplayed(JSON.parse(signature)); }, [reportDisplayed, signature]);
  return controller;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  provider.read.clear(); provider.trashed.clear();
  window.history.replaceState({}, "");
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Inbox batch selection owner", () => {
  it.each([{ metaKey: true }, { shiftKey: true }])("cancels pending automatic read with %j and keeps a one-item selection until ordinary click", async (modifiers) => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.onOpen(result.current.visibleEmails[0]!));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => result.current.onOpen(result.current.visibleEmails[1]!, modifiers));
    expect(result.current.batchSelection.selectedEmails).toHaveLength(2);
    expect(result.current.selectedEmail).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(provider.read.size).toBe(0);
    act(() => result.current.onOpen(result.current.visibleEmails[0]!, { ctrlKey: true }));
    expect(result.current.batchSelection.active).toBe(true);
    expect(result.current.batchSelection.selectedEmails).toHaveLength(1);
    act(() => result.current.onOpen(result.current.visibleEmails[1]!));
    expect(result.current.batchSelection.active).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(provider.read.size).toBe(1);
  });
  it.each(["lane", "account", "search", "collection", "history"])("clears selection on %s change", (change) => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.onOpen(result.current.visibleEmails[0]!, { metaKey: true }));
    expect(result.current.batchSelection.active).toBe(true);
    act(() => {
      if (change === "lane") result.current.setLane("fyi");
      if (change === "account") result.current.setAccountId("acc-work");
      if (change === "search") result.current.setSearch("x");
      if (change === "collection") result.current.setCollection("snoozed");
      if (change === "history") window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });
    expect(result.current.batchSelection.active).toBe(false);
  });
  it("removes collapsed rows and keeps a failed trash email selected after settlement", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.onOpen(result.current.visibleEmails[0]!, { metaKey: true }));
    act(() => result.current.onOpen(result.current.visibleEmails[2]!, { shiftKey: true }));
    expect(result.current.batchSelection.selectedEmails).toHaveLength(3);
    act(() => result.current.batchSelection.remove([result.current.visibleEmails[2]!]));
    expect(result.current.batchSelection.selectedEmails).toHaveLength(2);
    await act(async () => { await result.current.batch.execute(result.current.batchSelection.selectedEmails, "trash"); });
    expect(result.current.batchSelection.active).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(result.current.batchSelection.selectedEmails.map(emailSelectionKey)).toEqual(["b"]);
  });
  it("navigates and selects ranges only through displayed rows", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.batchSelection.reportDisplayed(["a", "c"], ["a", "b", "c"]));
    expect(result.current.navigationEmails.map(emailSelectionKey)).toEqual(["a", "c"]);
    act(() => result.current.onOpen(result.current.visibleEmails[0]!));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" })));
    expect(result.current.selectedEmail?.uid).toBe("c");
    act(() => result.current.onOpen(result.current.visibleEmails[0]!));
    act(() => result.current.onOpen(result.current.visibleEmails[2]!, { shiftKey: true }));
    expect(result.current.batchSelection.selectedEmails.map(emailSelectionKey)).toEqual(["a", "c"]);
  });

  it("clears on mobile and snapshot changes", () => {
    const { result, rerender } = renderHook(useHarness, { initialProps: { mobile: false, snapshotKey: 0 } });
    act(() => result.current.onOpen(result.current.visibleEmails[0]!, { metaKey: true }));
    rerender({ mobile: true, snapshotKey: 0 });
    expect(result.current.batchSelection.active).toBe(false);
    rerender({ mobile: false, snapshotKey: 0 });
    act(() => result.current.onOpen(result.current.visibleEmails[0]!, { metaKey: true }));
    rerender({ mobile: false, snapshotKey: 1 });
    expect(result.current.batchSelection.active).toBe(false);
  });
});
