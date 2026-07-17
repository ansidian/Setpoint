import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarModalHotkeys, { type CalendarModalHotkeysOptions } from "./useCalendarModalHotkeys";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";

function dispatchEscape(target: EventTarget) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function setup() {
  const { setFloatingDetail } = setupRouting({
    floatingDetail: { open: true, mode: "detail" },
  });
  return { setFloatingDetail };
}

// Mutable ref objects so the document-listener closure can read the latest
// floating-detail snapshot, matching how the controller wires these refs.
function makeRef<T>(initial: T) {
  return { current: initial };
}

// A full prop bundle wiring every callback the routing switch can invoke as a
// spy. Overrides let each test pin the few props its branch reads. The hook
// owns its own keydown listener on `document` (capture phase), so cases
// dispatch a real KeyboardEvent and assert the outbound callback contract.
function setupRouting(overrides: Partial<CalendarModalHotkeysOptions> = {}) {
  const navigateMonth = vi.fn();
  const callbacks = {
    closeCalendarModal: vi.fn(),
    closeEventEditor: vi.fn(),
    setDeadlineEditor: vi.fn(),
    setDeadlineDraftPreview: vi.fn(),
    setSuppressFocusRing: vi.fn(),
    setFloatingDetail: vi.fn(),
    handleViewChange: vi.fn(),
    cycleView: vi.fn(),
    cancelFloatingEditor: vi.fn(),
    flipFloatingDetailSide: vi.fn(),
    shakeFloatingEditor: vi.fn(),
    setViewDate: vi.fn(),
    setFetchAnchor: vi.fn(),
    setLabelMonth: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),
    requestAgendaScroll: vi.fn(),
    resolveSelectedAgendaEditAnchor: vi.fn(() => ({})),
    openFloatingEventEdit: vi.fn(),
    openFloatingDeadlineEdit: vi.fn(),
    openFloatingEventCreate: vi.fn(),
    openFloatingDeadlineCreate: vi.fn(),
    toggleEventOverlay: vi.fn(),
    toggleDeadlineOverlay: vi.fn(),
    toggleCompletedDeadlineOverlay: vi.fn(),
    setDeadlineOverlayVisible: vi.fn(),
    onCopySelectedEvent: vi.fn(),
    onPasteCopiedEvent: vi.fn(),
    onDeleteSelectedEvents: vi.fn(() => true),
    onBeginEventSelectionSetFromSelected: vi.fn(() => false),
    openCalendarSearch: vi.fn(),
    cancelCalendarSearch: vi.fn(() => false),
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
    eventEditor: { isEditorOpen: false, isDirty: false, editable: true, openEdit: vi.fn(), openCreate: vi.fn() },
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
  return { ...callbacks, navigateMonth };
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

describe("useCalendarModalHotkeys month navigation", () => {
  it("ArrowLeft paginates to the previous month when canGoPrev", () => {
    const { navigateMonth } = setupRouting();
    press("ArrowLeft");
    expect(navigateMonth).toHaveBeenCalledTimes(1);
    expect(navigateMonth).toHaveBeenCalledWith(-1);
  });

  it("'p' paginates to the previous month", () => {
    const { navigateMonth } = setupRouting();
    press("p");
    expect(navigateMonth).toHaveBeenCalledWith(-1);
  });

  it("does not paginate backward when canGoPrev is false", () => {
    const { navigateMonth } = setupRouting({ canGoPrev: false });
    press("ArrowLeft");
    expect(navigateMonth).not.toHaveBeenCalled();
  });

  it("ArrowRight paginates to the next month", () => {
    const { navigateMonth } = setupRouting();
    press("ArrowRight");
    expect(navigateMonth).toHaveBeenCalledTimes(1);
    expect(navigateMonth).toHaveBeenCalledWith(1);
  });

  it("'n' paginates to the next month", () => {
    const { navigateMonth } = setupRouting();
    press("n");
    expect(navigateMonth).toHaveBeenCalledWith(1);
  });
});

describe("useCalendarModalHotkeys jump-to-today", () => {
  it("'t' resets the view to the current month and selects today", () => {
    const {
      setViewDate,
      setSelectedDay,
      setSelectedDateKey,
      requestAgendaScroll,
    } = setupRouting();

    press("t");

    expect(setViewDate).toHaveBeenCalledWith({ month: 5, year: 2026 });
    expect(setSelectedDay).toHaveBeenCalledWith(15);
    expect(setSelectedDateKey).toHaveBeenCalledWith("2026-06-15");
    expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "today" });
  });

  it("'t' shakes (does not jump) when a dirty floating editor is open", () => {
    const floatingDetailRef = makeRef({ open: true, mode: "edit", dirty: true });
    const { shakeFloatingEditor, setViewDate, requestAgendaScroll } = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press("t");

    expect(shakeFloatingEditor).toHaveBeenCalledTimes(1);
    expect(setViewDate).not.toHaveBeenCalled();
    expect(requestAgendaScroll).not.toHaveBeenCalled();
  });
});

describe("useCalendarModalHotkeys edit-selected routing", () => {
  it("'e' on a selected deadline routes to the deadline editor", () => {
    const deadline = { id: 42, calendarItemKind: "deadline" };
    const { openFloatingDeadlineEdit, openFloatingEventEdit } = setupRouting({
      selectedItemId: 42,
      selectedDateKey: "2026-06-15",
      itemsByDate: { "2026-06-15": [deadline] },
    });

    press("e");

    expect(openFloatingDeadlineEdit).toHaveBeenCalledTimes(1);
    expect(openFloatingDeadlineEdit.mock.calls[0]![0]).toBe(deadline);
    expect(openFloatingEventEdit).not.toHaveBeenCalled();
  });

  it("'e' on a selected event routes to the event editor", () => {
    const event = { id: 7, startMs: 1_700_000_000_000 };
    const { openFloatingEventEdit, openFloatingDeadlineEdit } = setupRouting({
      selectedItemId: 7,
      selectedDateKey: "2026-06-15",
      itemsByDate: { "2026-06-15": [event] },
    });

    press("e");

    expect(openFloatingEventEdit).toHaveBeenCalledTimes(1);
    expect(openFloatingEventEdit.mock.calls[0]![0]).toBe(event);
    expect(openFloatingDeadlineEdit).not.toHaveBeenCalled();
  });
});

describe("useCalendarModalHotkeys overlay + create shortcuts", () => {
  it("shift+c opens the floating deadline create and reveals the deadline overlay", () => {
    const { openFloatingDeadlineCreate, setDeadlineOverlayVisible, openFloatingEventCreate } = setupRouting();

    press("c", { shiftKey: true });

    expect(setDeadlineOverlayVisible).toHaveBeenCalledWith(true);
    expect(openFloatingDeadlineCreate).toHaveBeenCalledTimes(1);
    expect(openFloatingDeadlineCreate).toHaveBeenCalledWith("2026-06-15");
    expect(openFloatingEventCreate).not.toHaveBeenCalled();
  });

  it("shift+e toggles the event overlay", () => {
    const { toggleEventOverlay, openFloatingEventEdit } = setupRouting();

    press("e", { shiftKey: true });

    expect(toggleEventOverlay).toHaveBeenCalledTimes(1);
    expect(openFloatingEventEdit).not.toHaveBeenCalled();
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
    const { flipFloatingDetailSide } = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press(" ");

    expect(flipFloatingDetailSide).toHaveBeenCalledTimes(1);
  });

  it("Space does not flip when the floating detail is dirty", () => {
    const floatingDetailRef = makeRef({
      open: true,
      mode: "detail",
      anchorKind: "chip",
      userDragged: false,
      dirty: true,
    });
    const { flipFloatingDetailSide } = setupRouting({
      floatingDetailRef,
      floatingDetail: floatingDetailRef.current,
    });

    press(" ");

    expect(flipFloatingDetailSide).not.toHaveBeenCalled();
  });
});

describe("useCalendarModalHotkeys delete selected", () => {
  it("Delete forwards to onDeleteSelectedEvents in the events view", () => {
    const { onDeleteSelectedEvents } = setupRouting();
    press("Delete");
    expect(onDeleteSelectedEvents).toHaveBeenCalledTimes(1);
  });

  it("Backspace forwards to onDeleteSelectedEvents in the events view", () => {
    const { onDeleteSelectedEvents } = setupRouting();
    press("Backspace");
    expect(onDeleteSelectedEvents).toHaveBeenCalledTimes(1);
  });
});
