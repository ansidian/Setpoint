import { describe, expect, it } from "vitest";
import { resolveInboxHotkeyAction, shouldSuspendInboxHotkeys } from "./inboxHotkeys";

const snapshotEmail = {
  id: "msg-1",
  uid: "msg-1",
  snapshot_item_id: 1,
  _activeSnapshot: true,
  _lane: "needs_attention",
};

describe("shouldSuspendInboxHotkeys", () => {
  it("does not suspend for an unrelated mounted dialog while focus remains on the body", () => {
    const inboxTarget = document.createElement("div");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(inboxTarget, dialog);

    expect(document.activeElement).toBe(document.body);
    expect(shouldSuspendInboxHotkeys(inboxTarget)).toBe(false);

    inboxTarget.remove();
    dialog.remove();
  });

  it("suspends while focus is inside a dialog", () => {
    const inboxTarget = document.createElement("div");
    const dialog = document.createElement("div");
    const dialogButton = document.createElement("button");
    dialog.setAttribute("role", "dialog");
    dialog.append(dialogButton);
    document.body.append(inboxTarget, dialog);
    dialogButton.focus();

    expect(shouldSuspendInboxHotkeys(inboxTarget)).toBe(true);

    inboxTarget.remove();
    dialog.remove();
  });

  it("suspends when the keydown target is inside a menu", () => {
    const menu = document.createElement("div");
    const menuTarget = document.createElement("button");
    menu.setAttribute("role", "menu");
    menu.append(menuTarget);
    document.body.append(menu);

    expect(shouldSuspendInboxHotkeys(menuTarget)).toBe(true);

    menu.remove();
  });

  it("suspends when the keydown target has an explicit suspension ancestor", () => {
    const suspensionBoundary = document.createElement("div");
    const target = document.createElement("button");
    suspensionBoundary.dataset.suspendInboxHotkeys = "true";
    suspensionBoundary.append(target);
    document.body.append(suspensionBoundary);

    expect(shouldSuspendInboxHotkeys(target)).toBe(true);

    suspensionBoundary.remove();
  });
});

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

  it("does not map destructive or lane hotkeys for Catch-up rows", () => {
    const catchUp = { ...snapshotEmail, _lane: "catch_up", lane_at_snapshot: "fyi" };

    for (const key of ["h", "d", "f", "n", "a", "s", "e"]) {
      expect(resolveInboxHotkeyAction(key, catchUp, false)).toBeNull();
    }
  });

  it("limits arrival-grace lanes to their allowed snapshot shortcuts", () => {
    const queued = { ...snapshotEmail, _lane: "queued" };
    const untriagedRead = { ...snapshotEmail, _lane: "untriaged_read" };

    expect(resolveInboxHotkeyAction("d", queued, false)).toEqual({ kind: "snapshot-dismiss" });
    expect(resolveInboxHotkeyAction("h", queued, false)).toBeNull();
    expect(resolveInboxHotkeyAction("f", queued, false)).toBeNull();

    for (const key of ["h", "d", "f", "n", "a"]) {
      expect(resolveInboxHotkeyAction(key, untriagedRead, false)).toBeNull();
    }
  });

  describe("pin-toggle", () => {
    it("maps 'p' with a selected email to pin-toggle", () => {
      expect(resolveInboxHotkeyAction("p", snapshotEmail, false)).toEqual({ kind: "pin-toggle" });
    });

    it("works with readOnly === true (frozen-snapshot browsing) — unlike s/e", () => {
      expect(resolveInboxHotkeyAction("p", snapshotEmail, true)).toEqual({ kind: "pin-toggle" });
      // Contrast: s/e ARE readOnly-gated and stay null.
      expect(resolveInboxHotkeyAction("s", snapshotEmail, true)).toBeNull();
      expect(resolveInboxHotkeyAction("e", snapshotEmail, true)).toBeNull();
    });

    it("works for catch-up rows — pinning history is the point", () => {
      const catchUp = { ...snapshotEmail, _lane: "catch_up", lane_at_snapshot: "fyi" };
      expect(resolveInboxHotkeyAction("p", catchUp, false)).toEqual({ kind: "pin-toggle" });
    });

    it("returns null with no selectedEmail", () => {
      expect(resolveInboxHotkeyAction("p", null, false)).toBeNull();
    });
  });
});
