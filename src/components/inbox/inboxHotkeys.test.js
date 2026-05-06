import { describe, expect, it } from "vitest";
import { resolveInboxHotkeyAction } from "./inboxHotkeys";

const snapshotEmail = {
  id: "msg-1",
  uid: "msg-1",
  snapshot_item_id: 1,
  _activeSnapshot: true,
  _lane: "needs_attention",
};

describe("resolveInboxHotkeyAction", () => {
  it("maps mutable snapshot rows to lifecycle and lane actions", () => {
    expect(resolveInboxHotkeyAction("h", snapshotEmail, false)).toEqual({ kind: "snapshot-handled" });
    expect(resolveInboxHotkeyAction("h", { ...snapshotEmail, _lane: "fyi" }, false)).toEqual({
      kind: "snapshot-handled",
    });
    expect(resolveInboxHotkeyAction("d", snapshotEmail, false)).toEqual({ kind: "snapshot-dismiss" });
    expect(resolveInboxHotkeyAction("f", snapshotEmail, false)).toEqual({
      kind: "snapshot-move-lane",
      lane: "fyi",
    });
    expect(resolveInboxHotkeyAction("n", snapshotEmail, false)).toEqual({
      kind: "snapshot-move-lane",
      lane: "noise",
    });
  });

  it("scopes handled rows to reopen before lane moves", () => {
    const handled = { ...snapshotEmail, _lane: "handled" };

    expect(resolveInboxHotkeyAction("h", handled, false)).toEqual({ kind: "snapshot-reopen" });
    expect(resolveInboxHotkeyAction("f", handled, false)).toBeNull();
  });

  it("leaves read-only and number-key events unresolved", () => {
    expect(resolveInboxHotkeyAction("h", snapshotEmail, true)).toBeNull();
    expect(resolveInboxHotkeyAction("1", snapshotEmail, false)).toBeNull();
  });
});
