import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarModalHotkeys from "./useCalendarModalHotkeys.js";

function dispatchEscape(target) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function setup() {
  const setFloatingDetail = vi.fn();
  renderHook(() => useCalendarModalHotkeys({
    open: true,
    floatingDetail: { open: true, mode: "detail" },
    setFloatingDetail,
    setSuppressFocusRing: vi.fn(),
  }));
  return { setFloatingDetail };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("useCalendarModalHotkeys full suspension", () => {
  it("ignores keys originating inside a data-suspend-calendar-hotkeys='all' container", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "all");
    const input = document.createElement("input");
    overlay.appendChild(input);
    document.body.appendChild(overlay);

    const { setFloatingDetail } = setup();
    dispatchEscape(input);
    expect(setFloatingDetail).not.toHaveBeenCalled();
  });

  it("still closes the floating detail for Escape originating elsewhere", () => {
    const { setFloatingDetail } = setup();
    dispatchEscape(document.body);
    expect(setFloatingDetail).toHaveBeenCalledWith(null);
  });
});
