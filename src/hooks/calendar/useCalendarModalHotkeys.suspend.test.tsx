import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useCalendarModalHotkeys from "./useCalendarModalHotkeys";

function setup() {
  const noop = () => {};
  const floatingDetail = { open: true, mode: "detail" } as const;
  renderHook(() => useCalendarModalHotkeys({
    open: true,
    canGoPrev: true,
    currentMonth: 5,
    currentYear: 2026,
    todayDate: 15,
    view: "events",
    viewYear: 2026,
    viewMonth: 5,
    eventEditor: { isEditorOpen: false, isDirty: false, editable: true, openEdit: noop, openCreate: noop },
    deadlineEditor: null,
    selectedItemId: null,
    selectedDay: 15,
    selectedDateKey: "2026-06-15",
    activeView: { getItemId: (item) => item.id },
    itemsByDay: {},
    itemsByDate: {},
    floatingDetail,
    floatingDetailRef: { current: floatingDetail },
    usesFloatingEditor: true,
    navigateMonthRef: { current: noop },
    closeEventEditor: noop,
    setDeadlineEditor: noop,
    setDeadlineDraftPreview: noop,
    setSuppressFocusRing: noop,
    setFloatingDetail: noop,
    cycleView: noop,
    cancelFloatingEditor: noop,
    shakeFloatingEditor: noop,
    setViewDate: noop,
    setFetchAnchor: noop,
    setLabelMonth: noop,
    setSelectedDay: noop,
    setSelectedDateKey: noop,
    setSelectedItemId: noop,
    requestAgendaScroll: noop,
    openFloatingEventEdit: noop,
    openFloatingDeadlineEdit: noop,
    openFloatingEventCreate: noop,
    openFloatingDeadlineCreate: noop,
  }));
}

function dispatch(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("calendar browser shortcut ownership", () => {
  it("consumes detail Escape outside a fully suspended target", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "all");
    const input = document.createElement("input");
    overlay.appendChild(input);
    document.body.appendChild(overlay);
    setup();

    expect(dispatch(input, { key: "Escape" })).toBe(false);
    expect(dispatch(document.body, { key: "Escape" })).toBe(true);
  });

  it("leaves keys to blocking overlays and suspended inputs", () => {
    setup();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "blocking");
    document.body.appendChild(overlay);
    for (const key of ["Escape", "3", "t"]) {
      expect(dispatch(document.body, { key })).toBe(false);
    }
    overlay.setAttribute("data-suspend-calendar-hotkeys", "true");
    const input = document.createElement("input");
    overlay.appendChild(input);
    expect(dispatch(input, { key: "3" })).toBe(false);
  });

  it("consumes plain 3 while leaving browser and other shell shortcuts untouched", () => {
    setup();
    expect(dispatch(document.body, { key: "3" })).toBe(true);
    for (const init of [
      { key: "3", metaKey: true }, { key: "3", ctrlKey: true },
      { key: "1" }, { key: "1", metaKey: true }, { key: "1", ctrlKey: true },
      { key: "2" }, { key: "4" }, { key: "5" },
    ]) {
      expect(dispatch(document.body, init)).toBe(false);
    }
  });
});
