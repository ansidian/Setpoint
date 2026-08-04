import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useCalendarModalHotkeys, { type CalendarModalHotkeysOptions } from "./useCalendarModalHotkeys";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";

function dispatchEscape(target: EventTarget) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function setup() {
  return setupRouting({
    floatingDetail: { open: true, mode: "detail" },
  });
}

// Mutable ref objects so the document-listener closure can read the latest
// floating-detail snapshot, matching how the controller wires these refs.
function makeRef<T>(initial: T) {
  return { current: initial };
}

function setupRouting(overrides: Partial<CalendarModalHotkeysOptions> = {}) {
  const state = {
    floatingDetail: overrides.floatingDetail ?? null,
    cycleCount: 0,
    navigation: [] as number[],
    viewDate: null as { month: number; year: number } | null,
    selectedDay: null as number | null,
    selectedDateKey: null as string | null,
    agendaScroll: null as { type: "today" } | null,
    shakeCount: 0,
    openedEventEdit: null as FloatingEditorItem | null,
    openedDeadlineEdit: null as FloatingEditorItem | null,
    eventCreateDate: null as string | null,
    deadlineCreateDate: null as string | null,
    deadlineOverlayVisible: false,
    eventOverlayToggles: 0,
    flipCount: 0,
    deleteCount: 0,
  };
  const navigateMonth = (direction: number) => { state.navigation.push(direction); };
  const callbacks = {
    closeCalendarModal: () => {},
    closeEventEditor: () => {},
    setDeadlineEditor: () => {},
    setDeadlineDraftPreview: () => {},
    setSuppressFocusRing: () => {},
    setFloatingDetail: (detail: unknown) => { state.floatingDetail = detail as typeof state.floatingDetail; },
    handleViewChange: () => {},
    cycleView: () => { state.cycleCount += 1; },
    cancelFloatingEditor: () => {},
    flipFloatingDetailSide: () => { state.flipCount += 1; },
    shakeFloatingEditor: () => { state.shakeCount += 1; },
    setViewDate: (value: unknown) => { state.viewDate = value as typeof state.viewDate; },
    setFetchAnchor: () => {},
    setLabelMonth: () => {},
    setSelectedDay: (value: unknown) => { state.selectedDay = value as number | null; },
    setSelectedDateKey: (value: unknown) => { state.selectedDateKey = value as string | null; },
    setSelectedItemId: () => {},
    requestAgendaScroll: (command: { type: "today" }) => { state.agendaScroll = command; },
    resolveSelectedAgendaEditAnchor: () => ({}),
    openFloatingEventEdit: (item: FloatingEditorItem) => { state.openedEventEdit = item; },
    openFloatingDeadlineEdit: (item: FloatingEditorItem) => { state.openedDeadlineEdit = item; },
    openFloatingEventCreate: (dateKey: string | null) => { state.eventCreateDate = dateKey; },
    openFloatingDeadlineCreate: (dateKey: string | null) => { state.deadlineCreateDate = dateKey; },
    toggleEventOverlay: () => { state.eventOverlayToggles += 1; },
    toggleDeadlineOverlay: () => {},
    toggleCompletedDeadlineOverlay: () => {},
    setDeadlineOverlayVisible: (visible: boolean) => { state.deadlineOverlayVisible = visible; },
    onCopySelectedEvent: () => {},
    onPasteCopiedEvent: () => {},
    onDeleteSelectedEvents: () => { state.deleteCount += 1; return true; },
    onBeginEventSelectionSetFromSelected: () => false,
    openCalendarSearch: () => {},
    cancelCalendarSearch: () => false,
  };

  const floatingDetailRef = overrides.floatingDetailRef ?? makeRef({ open: false });
  const navigateMonthRef = overrides.navigateMonthRef ?? makeRef(navigateMonth);

  const props = {
    open: true,
    canGoPrev: true,
    currentMonth: 5,
    currentYear: 2026,
    todayDate: 15,
    view: "events",
    viewYear: 2026,
    viewMonth: 5,
    eventEditor: { isEditorOpen: false, isDirty: false, editable: true, openEdit: () => {}, openCreate: () => {} },
    deadlineEditor: null,
    selectedItemId: null,
    selectedDay: 15,
    selectedDateKey: "2026-06-15",
    activeView: { getItemId: (item: FloatingEditorItem) => item.id },
    itemsByDay: {},
    itemsByDate: {},
    floatingDetail: floatingDetailRef.current,
    floatingDetailRef,
    usesFloatingEditor: true,
    deadlineOverlayVisible: false,
    navigateMonthRef,
    ...callbacks,
    ...overrides,
  };

  renderHook(() => useCalendarModalHotkeys(props as CalendarModalHotkeysOptions));
  return state;
}

function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
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

    const state = setup();
    dispatchEscape(input);
    expect(state.floatingDetail).toEqual({ open: true, mode: "detail" });
  });

  it("still closes the floating detail for Escape originating elsewhere", () => {
    const state = setup();
    dispatchEscape(document.body);
    expect(state.floatingDetail).toBeNull();
  });

  it("ignores all calendar hotkeys while a blocking shell overlay is present", () => {
    const state = setupRouting();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "blocking");
    document.body.appendChild(overlay);

    for (const key of ["3", "t"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(state.cycleCount).toBe(0);
    expect(state.viewDate).toBeNull();
  });

  it("does not cycle when the key originates inside a suspended hotkey target", () => {
    const state = setupRouting();
    const rail = document.createElement("div");
    rail.setAttribute("data-suspend-calendar-hotkeys", "true");
    const input = document.createElement("input");
    rail.appendChild(input);
    document.body.appendChild(rail);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true }));

    expect(state.cycleCount).toBe(0);
  });
});

describe("useCalendarModalHotkeys shell-tab routing", () => {
  it("cycles and consumes the calendar's plain 3 hotkey", () => {
    const state = setupRouting();
    const event = new KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true });

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(state.cycleCount).toBe(1);
  });

  it("leaves browser-modified 3 shortcuts untouched", () => {
    const state = setupRouting();

    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent("keydown", {
        key: "3",
        ...modifier,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(state.cycleCount).toBe(0);
  });

  it("leaves retired and other shell-tab keys untouched", () => {
    const state = setupRouting();

    for (const init of [
      { key: "v" },
      { key: "V", shiftKey: true },
    ]) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        ...init,
        bubbles: true,
        cancelable: true,
      }));
    }

    for (const init of [
      { key: "1" },
      { key: "1", metaKey: true },
      { key: "1", ctrlKey: true },
      { key: "2" },
      { key: "4" },
      { key: "5" },
    ]) {
      const event = new KeyboardEvent("keydown", {
        ...init,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(state.cycleCount).toBe(0);
  });
});

describe("useCalendarModalHotkeys month navigation", () => {
  it("ArrowLeft paginates to the previous month when canGoPrev", () => {
    const state = setupRouting();
    press("ArrowLeft");
    expect(state.navigation).toEqual([-1]);
  });

  it("'p' paginates to the previous month", () => {
    const state = setupRouting();
    press("p");
    expect(state.navigation).toEqual([-1]);
  });

  it("does not paginate backward when canGoPrev is false", () => {
    const state = setupRouting({ canGoPrev: false });
    press("ArrowLeft");
    expect(state.navigation).toEqual([]);
  });

  it("ArrowRight paginates to the next month", () => {
    const state = setupRouting();
    press("ArrowRight");
    expect(state.navigation).toEqual([1]);
  });

  it("'n' paginates to the next month", () => {
    const state = setupRouting();
    press("n");
    expect(state.navigation).toEqual([1]);
  });
});

describe("useCalendarModalHotkeys jump-to-today", () => {
  it("'t' resets the view to the current month and selects today", () => {
    const state = setupRouting();

    press("t");

    expect(state.viewDate).toEqual({ month: 5, year: 2026 });
    expect(state.selectedDay).toBe(15);
    expect(state.selectedDateKey).toBe("2026-06-15");
    expect(state.agendaScroll).toEqual({ type: "today" });
  });

  it("'t' shakes (does not jump) when a dirty floating editor is open", () => {
    const floatingDetailRef = makeRef({ open: true, mode: "edit", dirty: true });
    const state = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press("t");

    expect(state.shakeCount).toBe(1);
    expect(state.viewDate).toBeNull();
    expect(state.agendaScroll).toBeNull();
  });
});

describe("useCalendarModalHotkeys edit-selected routing", () => {
  it("'e' on a selected deadline routes to the deadline editor", () => {
    const deadline = { id: 42, calendarItemKind: "deadline" };
    const state = setupRouting({
      selectedItemId: 42,
      selectedDateKey: "2026-06-15",
      itemsByDate: { "2026-06-15": [deadline] },
    });

    press("e");

    expect(state.openedDeadlineEdit).toBe(deadline);
    expect(state.openedEventEdit).toBeNull();
  });

  it("'e' on a selected event routes to the event editor", () => {
    const event = { id: 7, startMs: 1_700_000_000_000 };
    const state = setupRouting({
      selectedItemId: 7,
      selectedDateKey: "2026-06-15",
      itemsByDate: { "2026-06-15": [event] },
    });

    press("e");

    expect(state.openedEventEdit).toBe(event);
    expect(state.openedDeadlineEdit).toBeNull();
  });
});

describe("useCalendarModalHotkeys overlay + create shortcuts", () => {
  it("shift+c opens the floating deadline create and reveals the deadline overlay", () => {
    const state = setupRouting();

    press("c", { shiftKey: true });

    expect(state.deadlineOverlayVisible).toBe(true);
    expect(state.deadlineCreateDate).toBe("2026-06-15");
    expect(state.eventCreateDate).toBeNull();
  });

  it("shift+e toggles the event overlay", () => {
    const state = setupRouting();

    press("e", { shiftKey: true });

    expect(state.eventOverlayToggles).toBe(1);
    expect(state.openedEventEdit).toBeNull();
  });
});

describe("useCalendarModalHotkeys space flip", () => {
  it("Space flips the side of a clean grid-origin floating detail", () => {
    const floatingDetailRef = makeRef({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      userDragged: false,
      dirty: false,
    });
    const state = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press(" ");

    expect(state.flipCount).toBe(1);
  });

  it("Space does not flip when the floating detail is dirty", () => {
    const floatingDetailRef = makeRef({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      userDragged: false,
      dirty: true,
    });
    const state = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press(" ");

    expect(state.flipCount).toBe(0);
  });
});

describe("useCalendarModalHotkeys delete selected", () => {
  it("Delete forwards to onDeleteSelectedEvents in the events view", () => {
    const state = setupRouting();
    press("Delete");
    expect(state.deleteCount).toBe(1);
  });

  it("Backspace forwards to onDeleteSelectedEvents in the events view", () => {
    const state = setupRouting();
    press("Backspace");
    expect(state.deleteCount).toBe(1);
  });
});
