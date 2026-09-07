import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useKeyboardFocusIndicators from "./useKeyboardFocusIndicators";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

// This owner governs keyboard modality across routes and body portals. The DOM
// attribute is its styling contract; real key/focus events exercise the boundary.
describe("keyboard focus indicators", () => {
  const visible = () => document.documentElement.getAttribute("data-sp-keyboard-focus");

  it("enables only intentional keyboard focus and preserves navigation without consuming keys", () => {
    renderHook(useKeyboardFocusIndicators);
    expect(visible()).toBe("false");
    for (const key of ["e", "a", "ArrowDown"]) {
      fireEvent.keyDown(document.body, { key });
      expect(visible()).toBe("false");
    }
    for (const key of ["Tab", "Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => { document.body.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
      expect(visible()).toBe("true");
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
      expect(visible()).toBe("true");
      fireEvent.pointerDown(document.body);
      expect(visible()).toBe("false");
    }
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(visible()).toBe("true");
    fireEvent.keyDown(document.body, { key: "e" });
    expect(visible()).toBe("false");
  });

  it("keeps shortcut autofocus quiet across a portal and retains typing focus", () => {
    renderHook(useKeyboardFocusIndicators);
    const portal = document.createElement("div");
    const input = document.createElement("input");
    portal.append(input);
    document.body.append(portal);
    fireEvent.keyDown(document.body, { key: "e" });
    act(() => { input.focus(); });
    expect(document.activeElement).toBe(input);
    expect(visible()).toBe("false");
    for (const key of ["a", " ", "Enter"]) {
      fireEvent.keyDown(input, { key });
      expect(visible()).toBe("false");
    }
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "a" });
    expect(visible()).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("ignores modifier-only keys and composition, and cleans up its root state", () => {
    const { unmount } = renderHook(useKeyboardFocusIndicators);
    fireEvent.keyDown(document.body, { key: "Enter", isComposing: true });
    expect(visible()).toBe("false");
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(document.body, { key: "Shift" });
    expect(visible()).toBe("true");
    unmount();
    expect(visible()).toBeNull();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(visible()).toBeNull();
  });
});
