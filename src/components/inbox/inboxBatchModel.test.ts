import { describe, expect, it } from "vitest";
import { batchActionOptions, batchHotkey, batchTargets } from "./inboxBatchModel";
import { selectBatchRow } from "./useInboxBatchSelection";
import type { InboxEmailLike } from "./inboxTypes";

const email = (uid: string, extra: Partial<InboxEmailLike> = {}): InboxEmailLike => ({ uid, _activeSnapshot: true, snapshot_item_id: uid, _lane: "needs_attention", read: false, ...extra });

describe("batch selection and action policy", () => {
  it("seeds visible open mail, toggles identities, and adds ranges in displayed order", () => {
    const shown = ["a", "c", "b", "d"];
    let state = selectBatchRow({ keys: new Set(), anchor: null }, email("c"), { metaKey: true }, shown, email("a"));
    expect([...state.keys]).toEqual(["a", "c"]);
    state = selectBatchRow(state, email("d"), { shiftKey: true }, shown, null);
    expect([...state.keys]).toEqual(["a", "c", "b", "d"]);
    state = selectBatchRow(state, email("c"), { ctrlKey: true }, shown, null);
    expect([...state.keys]).toEqual(["a", "b", "d"]);
    expect(state.anchor).toBe("c");
  });
  it("does not seed a hidden reader or duplicate provider identities", () => {
    const state = selectBatchRow({ keys: new Set(), anchor: null }, email("a"), { ctrlKey: true }, ["a"], email("hidden"));
    expect([...state.keys]).toEqual(["a"]);
    expect(batchTargets([email("a"), email("a", { id: "another-row" })], "read")).toHaveLength(1);
  });
  it.each(["a", "d"])("enters a displayed-order range directly from open email %s", (uid) => {
    const shown = ["a", "c", "b", "d"];
    const state = selectBatchRow({ keys: new Set(), anchor: null }, email("b"), { shiftKey: true }, shown, email(uid));
    expect([...state.keys]).toEqual(uid === "a" ? ["a", "c", "b"] : ["b", "d"]);
    expect(state.anchor).toBe(uid);
  });
  it.each([null, email("hidden")])("starts with the clicked row when Shift has no visible anchor", (current) => {
    const state = selectBatchRow({ keys: new Set(), anchor: "old" }, email("b"), { shiftKey: true }, ["a", "b", "c"], current);
    expect([...state.keys]).toEqual(["b"]);
    expect(state.anchor).toBe("b");
  });
  it("preserves source restrictions while exposing eligible subsets", () => {
    const emails = [email("needs"), email("handled", { _lane: "handled" }), email("queued", { _lane: "queued" }), email("catch", { _lane: "catch_up" }), email("unavailable", { _providerRemoved: true }), email("pending", { _optimisticSnapshotPending: true })];
    expect(batchTargets(emails, "fyi").map(row => row.uid)).toEqual(["needs"]);
    expect(batchTargets(emails, "handled").map(row => row.uid)).toEqual(["needs"]);
    expect(batchTargets(emails, "reopen").map(row => row.uid)).toEqual(["handled"]);
    expect(batchTargets(emails, "dismiss").map(row => row.uid)).toEqual(["needs", "queued"]);
    expect(batchTargets(emails, "trash").map(row => row.uid)).toEqual(["needs", "handled", "queued"]);
    expect(batchActionOptions(emails, true).map(option => option.action)).toEqual(["pin"]);
  });
  it("makes state-setting commands and toggle shortcuts unambiguous", () => {
    const options = batchActionOptions([email("a"), email("b", { read: true, _pinned: true, _lane: "handled" })]);
    expect(options.find(option => option.action === "read")?.count).toBe(1);
    expect(options.find(option => option.action === "unread")?.count).toBe(1);
    expect(batchHotkey("h", options)).toBeNull();
    expect(batchHotkey("p", options)).toBeNull();
    expect(batchHotkey("s", options)).toBeNull();
    expect(batchHotkey("f", options)).toBe("fyi");
    expect(batchHotkey("h", batchActionOptions([email("a")]))).toBe("handled");
  });
});
