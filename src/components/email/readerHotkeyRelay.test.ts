import { describe, expect, it } from "vitest";
import { shouldRelayReaderKey } from "./readerHotkeyRelay";

describe("shouldRelayReaderKey", () => {
  it("relays an inbox command key pressed in the email body", () => {
    expect(
      shouldRelayReaderKey({ key: "f", targetTag: "DIV", isContentEditable: false }),
    ).toBe(true);
  });

  it("relays Escape so the Alfred preview can close from inside its iframe", () => {
    expect(shouldRelayReaderKey({ key: "Escape", targetTag: "BODY" })).toBe(true);
  });

  it("is case-insensitive (Shift/CapsLock variants still relay)", () => {
    expect(shouldRelayReaderKey({ key: "F", targetTag: "DIV" })).toBe(true);
  });

  it("does not relay keys outside the command set (native scroll stays native)", () => {
    for (const key of ["x", "ArrowDown", "ArrowUp", " ", "PageDown"]) {
      expect(shouldRelayReaderKey({ key, targetTag: "DIV" })).toBe(false);
    }
  });

  it("does not relay modifier combos (copy/find/shell ⌘ shortcuts stay native)", () => {
    expect(shouldRelayReaderKey({ key: "e", metaKey: true, targetTag: "DIV" })).toBe(false);
    expect(shouldRelayReaderKey({ key: "f", ctrlKey: true, targetTag: "DIV" })).toBe(false);
    expect(shouldRelayReaderKey({ key: "1", altKey: true, targetTag: "DIV" })).toBe(false);
  });

  it("does not relay keys typed into an editable field inside the email", () => {
    for (const targetTag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(shouldRelayReaderKey({ key: "d", targetTag })).toBe(false);
    }
    expect(shouldRelayReaderKey({ key: "d", targetTag: "DIV", isContentEditable: true })).toBe(false);
  });
});
