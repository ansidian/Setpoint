import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import useCalendarModalOutsideDismiss from "./useCalendarModalOutsideDismiss.js";

function Host({ open, closeCalendarModal = () => {} }) {
  const panelRef = useRef(null);
  useCalendarModalOutsideDismiss({
    open,
    panelRef,
    floatingDetail: null,
    setFloatingDetail: () => {},
    closeCalendarModal,
    shakeFloatingEditor: () => {},
  });
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="panel">
      <button type="button" data-testid="inside-button">inside</button>
    </div>
  );
}

describe("useCalendarModalOutsideDismiss entry focus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("focuses the panel on open when focus is still outside the modal", () => {
    const { getByTestId } = render(<Host open />);

    act(() => {
      vi.advanceTimersByTime(32);
    });

    expect(document.activeElement).toBe(getByTestId("panel"));
  });

  it("does not steal focus from a portaled menu layer that focused first", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const menuButton = document.createElement("button");
    menu.appendChild(menuButton);
    document.body.appendChild(menu);

    render(<Host open />);
    menuButton.focus();

    act(() => {
      vi.advanceTimersByTime(32);
    });

    expect(document.activeElement).toBe(menuButton);
  });
});

describe("useCalendarModalOutsideDismiss overlay carve-out", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("does not close the calendar for pointerdown inside a data-suspend-calendar-hotkeys='all' overlay", () => {
    const closeCalendarModal = vi.fn();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "all");
    const inner = document.createElement("button");
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    render(<Host open closeCalendarModal={closeCalendarModal} />);
    fireEvent.pointerDown(inner);
    expect(closeCalendarModal).not.toHaveBeenCalled();
  });

  it("still closes the calendar for pointerdown on a genuinely outside target", () => {
    const closeCalendarModal = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    render(<Host open closeCalendarModal={closeCalendarModal} />);
    fireEvent.pointerDown(outside);
    expect(closeCalendarModal).toHaveBeenCalledTimes(1);
  });
});
