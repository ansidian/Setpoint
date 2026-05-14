import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid.jsx";
import { resolveOverflowPopoverPosition } from "./CalendarCellOverflowPopover.position.js";
import { renderEventsCellContents } from "../views/events/EventsCellContent.jsx";

const VIEW_YEAR = 2026;
const VIEW_MONTH = 3;
const TODAY_DAY = 14;
const CELL_HEIGHT = 140;

const activeView = {
  label: "Events",
  renderCellContents: renderEventsCellContents,
};

const groupedDayView = {
  label: "Bills",
  getDayState(rawItems) {
    if (rawItems?.items) return rawItems;
    const items = Array.isArray(rawItems) ? rawItems : [];
    return {
      items,
      activeItems: items,
      completedItems: [],
      activeCount: items.length,
      completedCount: 0,
      totalCount: items.length,
    };
  },
  renderCellContents({ items }) {
    return items.items.map((item) => (
      <span key={item.id}>{item.title}</span>
    ));
  },
};

function buildFallbackDayState(items) {
  const resolvedItems = Array.isArray(items) ? items : [];
  return {
    items: resolvedItems,
    totalCount: resolvedItems.length,
  };
}

function dayLabel(day) {
  return new Date(VIEW_YEAR, VIEW_MONTH, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function buildEvent(day, index) {
  const start = new Date(Date.UTC(VIEW_YEAR, VIEW_MONTH, day, 16 + index, 0, 0));
  return {
    id: `${day}-${index}`,
    title: `Day ${day} event ${index + 1}`,
    startMs: start.getTime(),
    endMs: start.getTime() + 30 * 60 * 1000,
    allDay: false,
    color: "#4285f4",
  };
}

function renderGrid(itemsByDay, overrides = {}) {
  const props = {
    view: "events",
    viewYear: VIEW_YEAR,
    viewMonth: VIEW_MONTH,
    currentYear: VIEW_YEAR,
    currentMonth: VIEW_MONTH,
    todayDate: TODAY_DAY,
    firstDay: 3,
    daysInMonth: 30,
    trailingEmpty: 9,
    itemsByDay,
    selectedDay: null,
    selectedItemId: null,
    viewData: { isLoading: false },
    activeView,
    layout: {
      tier: "lg",
      stacked: false,
      weekHeaderGap: 6,
      cellHeight: CELL_HEIGHT,
      gridGap: 8,
    },
    suppressOutsideClick: vi.fn(),
    showEventsLoadingState: false,
    buildFallbackDayState,
    closeEventEditor: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedItemId: vi.fn(),
    setDeadlineEditor: vi.fn(),
    canGoPrev: true,
    navigateMonth: vi.fn(),
    ...overrides,
  };
  const wrapGrid = (ui) => (
    <div data-testid="calendar-modal-panel">
      {ui}
    </div>
  );
  const result = render(wrapGrid(<CalendarGrid {...props} />));

  return {
    ...result,
    rerender: (ui) => result.rerender(wrapGrid(ui)),
    props,
  };
}

let originalResizeObserver;

beforeEach(() => {
  window.innerWidth = 1440;
  window.innerHeight = 900;

  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    delete globalThis.ResizeObserver;
  }
});

describe("CalendarGrid overflow motion coverage", () => {
  it("exposes day cells as labelled keyboard-selectable grid cells", () => {
    const setSelectedDay = vi.fn();
    renderGrid({}, { setSelectedDay });

    const dayCell = screen.getByTestId("calendar-cell-20");
    expect(dayCell.getAttribute("role")).toBe("gridcell");
    expect(dayCell.getAttribute("aria-label")).toMatch(/Monday, April 20, No events/i);

    fireEvent.keyDown(dayCell, { key: "Enter" });
    expect(setSelectedDay).toHaveBeenCalledWith(20);
  });

  it("uses one coarse mouse-wheel notch on the month grid to navigate one month", () => {
    const navigateMonth = vi.fn();
    renderGrid({}, { navigateMonth });

    const gridShell = screen.getByTestId("calendar-grid-shell");
    fireEvent.wheel(gridShell, { deltaY: 100, deltaMode: 0, cancelable: true });
    expect(navigateMonth).toHaveBeenCalledWith(1, { source: "month-grid-wheel" });
    expect(navigateMonth).toHaveBeenCalledTimes(1);
  });

  it("collapses a tapering wheel stream into one month navigation", () => {
    const navigateMonth = vi.fn();
    renderGrid({}, { navigateMonth });

    const gridShell = screen.getByTestId("calendar-grid-shell");
    fireEvent.wheel(gridShell, { deltaY: 24, deltaMode: 0, cancelable: true });
    fireEvent.wheel(gridShell, { deltaY: 19, deltaMode: 0, cancelable: true });
    fireEvent.wheel(gridShell, { deltaY: 13, deltaMode: 0, cancelable: true });

    expect(navigateMonth).toHaveBeenCalledWith(1, { source: "month-grid-wheel" });
    expect(navigateMonth).toHaveBeenCalledTimes(1);
  });

  it("keeps the month wheel lock through grid remounts", () => {
    const navigateMonth = vi.fn();
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const monthWheelStateRef = {
      current: {
        lastNavigateAt: -Infinity,
        ignoreUntil: -Infinity,
        lastWheelAt: -Infinity,
        lastWheelDelta: 0,
      },
    };
    const { props, rerender } = renderGrid({}, { navigateMonth, monthWheelStateRef });

    const gridShell = screen.getByTestId("calendar-grid-shell");
    fireEvent.wheel(gridShell, { deltaY: 100, deltaMode: 0, cancelable: true });
    expect(navigateMonth).toHaveBeenCalledTimes(1);

    rerender(<CalendarGrid key="next-month" {...props} viewMonth={VIEW_MONTH + 1} />);

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    expect(navigateMonth).toHaveBeenCalledTimes(1);
  });

  it("does not navigate the month grid for horizontal-dominant wheel gestures", () => {
    const navigateMonth = vi.fn();
    renderGrid({}, { navigateMonth });

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaX: 260,
      deltaY: 80,
      deltaMode: 0,
      cancelable: true,
    });

    expect(navigateMonth).not.toHaveBeenCalled();
  });

  it("does not wheel-navigate to a previous month when the view disallows it", () => {
    const navigateMonth = vi.fn();
    renderGrid({}, { canGoPrev: false, navigateMonth });

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: -260,
      deltaMode: 0,
      cancelable: true,
    });

    expect(navigateMonth).not.toHaveBeenCalled();
  });

  it("renders adjacent-month boundary segments around the actual current month", () => {
    renderGrid({}, {
      viewMonth: 4,
      currentMonth: 3,
      firstDay: 5,
      daysInMonth: 31,
      trailingEmpty: 6,
    });

    const boundary = screen.getByTestId("calendar-month-boundary-overlay");
    const rightStroke = within(boundary)
      .getByTestId("calendar-month-boundary-right-2026-04-30-2026-04-30");

    expect(rightStroke.getAttribute("data-boundary-side")).toBe("right");
  });

  it("renders adjacent-month boundary segments outside the actual current month", () => {
    renderGrid({}, {
      viewMonth: 5,
      currentMonth: 3,
      firstDay: 1,
      daysInMonth: 30,
      trailingEmpty: 4,
    });

    const boundary = screen.getByTestId("calendar-month-boundary-overlay");
    const rightStroke = within(boundary)
      .getByTestId("calendar-month-boundary-right-2026-05-31-2026-05-31");

    expect(rightStroke.getAttribute("data-boundary-side")).toBe("right");
  });

  it("renders date-keyed adjacent day items for non-event views", () => {
    renderGrid({}, {
      view: "bills",
      activeView: groupedDayView,
      viewMonth: 4,
      currentMonth: 3,
      firstDay: 5,
      daysInMonth: 31,
      trailingEmpty: 6,
      itemsByDate: {
        "2026-04-30": groupedDayView.getDayState([
          { id: "bill-apr-30", title: "April utility" },
        ]),
      },
    });

    const adjacentCell = screen.getByTestId("calendar-cell-2026-04-30");
    const boundary = screen.getByTestId("calendar-month-boundary-overlay");
    const rightStroke = within(boundary)
      .getByTestId("calendar-month-boundary-right-2026-04-30-2026-04-30");

    expect(within(adjacentCell).getByText("April utility")).toBeTruthy();
    expect(rightStroke.getAttribute("data-boundary-side")).toBe("right");
  });

  it("shows same visible chip count for today and non-today cells with matching event counts", async () => {
    renderGrid({
      14: Array.from({ length: 4 }, (_, index) => buildEvent(14, index)),
      15: Array.from({ length: 4 }, (_, index) => buildEvent(15, index)),
    });

    const todayCell = screen.getByTestId("calendar-cell-14");
    const siblingCell = screen.getByTestId("calendar-cell-15");

    await waitFor(() => {
      const todayChips = within(todayCell).queryAllByTestId("calendar-cell-item-chip");
      const siblingChips = within(siblingCell).queryAllByTestId("calendar-cell-item-chip");
      expect(todayChips.length).toBeGreaterThan(0);
      expect(todayChips).toHaveLength(siblingChips.length);
    });

    const visibleCount = within(todayCell).getAllByTestId("calendar-cell-item-chip").length;
    expect(within(todayCell).getByTestId("calendar-cell-overflow-trigger-14").textContent).toBe(`+${4 - visibleCount} more`);
    expect(within(siblingCell).getByTestId("calendar-cell-overflow-trigger-15").textContent).toBe(`+${4 - visibleCount} more`);
  });

  it("renders real pinned spans as selectable buttons and removes duplicate normal chips", () => {
    const setSelectedDay = vi.fn();
    const setSelectedDateKey = vi.fn();
    const setSelectedItemId = vi.fn();
    const onOpenFloatingDetail = vi.fn();
    const spanEvent = {
      id: "span-1",
      title: "Conference",
      allDay: true,
      writable: true,
      startMs: new Date("2026-04-20T07:00:00Z").getTime(),
      endMs: new Date("2026-04-23T07:00:00Z").getTime(),
      color: "#4285f4",
    };

    renderGrid({ 20: [spanEvent] }, {
      viewData: { events: [spanEvent], isLoading: false },
      setSelectedDay,
      setSelectedDateKey,
      setSelectedItemId,
      onOpenFloatingDetail,
    });

    const span = screen.getByTestId("calendar-event-span-segment");
    Object.defineProperty(span, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 300,
        height: 36,
        right: 300,
        bottom: 36,
        toJSON() {
          return this;
        },
      }),
    });
    expect(span.tagName).toBe("BUTTON");
    expect(screen.queryByTestId("calendar-cell-item-chip")).toBeNull();

    fireEvent.click(span, { clientX: 4 });

    expect(setSelectedDay).toHaveBeenCalledWith(20);
    expect(setSelectedDateKey).toHaveBeenCalledWith("2026-04-20");
    expect(setSelectedItemId).toHaveBeenCalledWith("span-1");
    expect(onOpenFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "span-1",
      dateKey: "2026-04-20",
      anchorKind: "span",
    }));
  });

  it("keeps same-day overflow open when selecting a covering all-day span", async () => {
    const spanEvent = {
      id: "span-1",
      title: "Conference",
      allDay: true,
      writable: true,
      startMs: new Date("2026-04-20T07:00:00Z").getTime(),
      endMs: new Date("2026-04-23T07:00:00Z").getTime(),
      color: "#4285f4",
    };
    const timedEvents = Array.from({ length: 5 }, (_, index) => buildEvent(20, index));

    renderGrid({ 20: [spanEvent, ...timedEvents] }, {
      viewData: { events: [spanEvent], isLoading: false },
    });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    await screen.findByText(dayLabel(20));

    fireEvent.click(screen.getByTestId("calendar-event-span-segment"), { clientX: 4 });

    await waitFor(() => {
      expect(
        screen.queryByTestId("calendar-cell-overflow-popover") ||
        screen.queryByTestId("calendar-cell-inline-overflow"),
      ).toBeTruthy();
    });
  });

  it("opens hidden deadline overlay rows with deadline floating detail metadata", async () => {
    const onOpenFloatingDetail = vi.fn();
    const deadline = {
      id: "todo-hidden",
      calendarItemKind: "deadline",
      title: "Hidden Todoist task",
      due_date: "2026-04-20",
      due_time: "5:00 PM",
      source: "todoist",
      status: "incomplete",
    };

    renderGrid({
      20: [
        ...Array.from({ length: 5 }, (_, index) => buildEvent(20, index)),
        deadline,
      ],
    }, { onOpenFloatingDetail });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    const popover = await screen.findByTestId("calendar-cell-overflow-popover");
    fireEvent.click(within(popover).getByText("Hidden Todoist task"));

    expect(onOpenFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "todoist:todo-hidden",
      view: "deadlines",
      itemsSnapshot: [expect.objectContaining({ id: "todo-hidden" })],
    }));
  });

  it("renders pinned ghost spans as inert aria-hidden chips", () => {
    renderGrid({}, {
      ghostPreview: {
        kind: "event",
        ghosts: [{
          id: "ghost-1",
          kind: "event",
          title: "Draft hold",
          startDate: "2026-04-20",
          endDate: "2026-04-20",
          allDay: true,
          color: "#89b4fa",
        }],
      },
    });

    const ghost = screen.getByTestId("calendar-ghost-chip");
    expect(ghost.tagName).toBe("DIV");
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.getAttribute("data-ghost-kind")).toBe("event");
  });

  it("retargets open overflow popover to second trigger without remounting or closing first", async () => {
    renderGrid({
      15: Array.from({ length: 5 }, (_, index) => buildEvent(15, index)),
      16: Array.from({ length: 5 }, (_, index) => buildEvent(16, index)),
    });

    const firstTrigger = screen.getByTestId("calendar-cell-overflow-trigger-15");
    const secondTrigger = screen.getByTestId("calendar-cell-overflow-trigger-16");

    fireEvent.click(firstTrigger);

    const firstPopover = await screen.findByTestId("calendar-cell-overflow-popover");
    expect(within(firstPopover).getByText(dayLabel(15))).toBeTruthy();
    expect(within(firstPopover).getByText("Day 15 event 4")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-cell-overflow-popover")).toHaveLength(1);

    fireEvent.pointerDown(secondTrigger);
    fireEvent.click(secondTrigger);

    await waitFor(() => {
      const popovers = screen.getAllByTestId("calendar-cell-overflow-popover");
      expect(popovers).toHaveLength(1);
      expect(popovers[0]).toBe(firstPopover);
      expect(within(popovers[0]).getByText(dayLabel(16))).toBeTruthy();
      expect(within(popovers[0]).getByText("Day 16 event 4")).toBeTruthy();
      expect(within(popovers[0]).queryByText("Day 15 event 4")).toBeNull();
    });
  });

  it("positions fallback overflow popovers inside the viewport when the trigger is on the last row", () => {
    window.innerHeight = 360;
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    Object.defineProperty(trigger, "isConnected", { configurable: true, value: true });
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 960,
        y: 310,
        left: 960,
        top: 310,
        right: 1020,
        bottom: 340,
        width: 60,
        height: 30,
        toJSON() {
          return this;
        },
      }),
    });

    const position = resolveOverflowPopoverPosition(trigger);

    expect(position.top).toBeGreaterThanOrEqual(16);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(window.innerHeight - 16);
    trigger.remove();
  });

  it("closes overflow popover when clicking same trigger again", async () => {
    renderGrid({
      15: Array.from({ length: 5 }, (_, index) => buildEvent(15, index)),
    });

    const trigger = screen.getByTestId("calendar-cell-overflow-trigger-15");

    fireEvent.click(trigger);
    expect(await screen.findByTestId("calendar-cell-overflow-popover")).toBeTruthy();

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
    });
  });

  it("clears an active Calendar Event Selection Set when selecting a birthday span", () => {
    const clearEventSelection = vi.fn();
    const setSelectedItemId = vi.fn();
    const birthday = {
      id: "birthday-1",
      title: "Maya's birthday",
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
      allDay: true,
      writable: false,
      startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
      sourceColor: "#ff887c",
      color: "#ff887c",
    };

    renderGrid(
      { 20: [birthday] },
      {
        viewData: { isLoading: false, events: [birthday] },
        eventQuickActions: {
          eventSelectionActive: true,
          clearEventSelection,
        },
        setSelectedItemId,
      },
    );

    fireEvent.click(screen.getByTestId("calendar-event-span-segment"), { clientX: 4 });

    expect(clearEventSelection).toHaveBeenCalledTimes(1);
    expect(setSelectedItemId).toHaveBeenCalledWith("birthday-1");
  });

  it("reanchors parked birthday detail from its floating-detail item id when selection drifted", async () => {
    const onReanchorFloatingDetail = vi.fn();
    const onDirectItemAction = vi.fn();
    const setSelectedDay = vi.fn();
    const setSelectedDateKey = vi.fn();
    const setSelectedItemId = vi.fn();
    const birthday = {
      id: "birthday-1",
      title: "Maya's birthday",
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
      allDay: true,
      writable: false,
      startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
      sourceColor: "#ff887c",
      color: "#ff887c",
    };
    const unrelatedEvent = buildEvent(21, 0);

    renderGrid(
      { 20: [birthday], 21: [unrelatedEvent] },
      {
        viewData: { isLoading: false, events: [birthday] },
        floatingDetailParked: true,
        floatingDetailDateKey: "2026-04-20",
        floatingDetailItemId: "birthday-1",
        selectedDay: 21,
        selectedDateKey: "2026-04-21",
        selectedItemId: "21-0",
        onDirectItemAction,
        onReanchorFloatingDetail,
        setSelectedDay,
        setSelectedDateKey,
        setSelectedItemId,
      },
    );

    expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("calendar-cell-21").getAttribute("aria-selected")).toBe("false");

    await waitFor(() => {
      expect(onReanchorFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
        itemId: "birthday-1",
        dateKey: "2026-04-20",
        anchorKind: "chip",
      }));
    });
    expect(setSelectedDay).toHaveBeenCalledWith(20);
    expect(setSelectedDateKey).toHaveBeenCalledWith("2026-04-20");
    expect(setSelectedItemId).toHaveBeenCalledWith("birthday-1");
    expect(onDirectItemAction).toHaveBeenCalledWith("birthday-1", "2026-04-20");
  });

  it("does not revive stale overflow anchors after month navigation", async () => {
    const dayEvents = Array.from({ length: 5 }, (_, index) => buildEvent(20, index));
    const { props, rerender } = renderGrid({ 20: dayEvents });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    expect(await screen.findByTestId("calendar-cell-overflow-popover")).toBeTruthy();

    rerender(
      <CalendarGrid
        {...props}
        itemsByDay={{}}
        viewMonth={VIEW_MONTH + 1}
        currentMonth={VIEW_MONTH + 1}
      />,
    );

    expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();

    rerender(<CalendarGrid {...props} itemsByDay={{ 20: dayEvents }} />);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
      expect(screen.getByTestId("calendar-cell-overflow-trigger-20")).toBeTruthy();
    });
  });

  it("opens overflow when a parked floating detail targets a hidden item", async () => {
    const dayEvents = Array.from({ length: 8 }, (_, index) => buildEvent(20, index));
    const onReanchorFloatingDetail = vi.fn();

    renderGrid(
      { 20: dayEvents },
      {
        floatingDetailParked: true,
        floatingDetailDateKey: "2026-04-20",
        floatingDetailItemId: "20-7",
        onReanchorFloatingDetail,
      },
    );

    expect(screen.getByTestId("calendar-cell-overflow-trigger-20")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.queryByTestId("calendar-cell-overflow-popover") ||
        screen.queryByTestId("calendar-cell-inline-overflow"),
      ).toBeTruthy();
    });
    expect(screen.getByText("Day 20 event 8")).toBeTruthy();
    await waitFor(() => {
      expect(onReanchorFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
        itemId: "20-7",
        dateKey: "2026-04-20",
        anchorKind: "overflow-row",
      }));
    });
  });

  it("closes open overflow when ghost removal changes the hidden item composition", async () => {
    const dayEvents = Array.from({ length: 4 }, (_, index) => buildEvent(20, index));
    const ghostPreview = {
      kind: "event",
      ghosts: [{
        id: "ghost-create-20",
        kind: "event",
        title: "Draft hold",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "15:30",
        allDay: false,
        color: "#89b4fa",
      }],
    };
    const { props, rerender } = renderGrid({ 20: dayEvents }, { ghostPreview });

    fireEvent.click(await screen.findByTestId("calendar-cell-overflow-trigger-20"));
    expect(await screen.findByTestId("calendar-cell-overflow-popover")).toBeTruthy();

    rerender(<CalendarGrid {...props} itemsByDay={{ 20: dayEvents }} ghostPreview={null} />);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
    });
  });
});
