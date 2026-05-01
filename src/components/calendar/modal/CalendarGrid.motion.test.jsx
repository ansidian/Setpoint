import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid.jsx";
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

function makeRect({ left, top, width, height }) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    },
  };
}

function parsePx(value) {
  const match = /^([0-9.]+)px$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

function getHeaderHeight(cell) {
  const header = Array.from(cell.children).find((node) => (
    node instanceof HTMLDivElement
    && node.style.display === "flex"
    && node.style.alignItems === "center"
  ));
  const badge = header?.querySelector("span");

  return (
    parsePx(header?.style.height)
    ?? parsePx(header?.style.minHeight)
    ?? parsePx(badge?.style.height)
    ?? parsePx(badge?.style.minHeight)
    ?? 16
  );
}

function getContentHeight(element) {
  const cell = element.parentElement;
  if (!cell) return 0;
  const paddingY = 12;
  const headerGap = 2;
  return Math.max(0, CELL_HEIGHT - paddingY - headerGap - getHeaderHeight(cell));
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

  return render(<CalendarGrid {...props} />);
}

let originalResizeObserver;
let originalClientHeightDescriptor;

beforeEach(() => {
  window.innerWidth = 1440;
  window.innerHeight = 900;

  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      if (
        this instanceof HTMLDivElement
        && this.style.flexGrow === "1"
        && this.style.overflow === "hidden"
        && this.parentElement?.getAttribute("data-testid")?.startsWith("calendar-cell-")
      ) {
        return getContentHeight(this);
      }

      return 0;
    },
  });

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect() {
    const testId = this.getAttribute?.("data-testid") || "";
    const match = /^calendar-cell-overflow-trigger-(\d+)$/.exec(testId);
    if (match) {
      const day = Number(match[1]);
      return makeRect({
        left: 60 + day * 11,
        top: 120 + day * 5,
        width: 58,
        height: 16,
      });
    }

    return makeRect({ left: 0, top: 0, width: 120, height: 24 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalClientHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeightDescriptor);
  } else {
    delete HTMLElement.prototype.clientHeight;
  }

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

  it("uses vertical wheel momentum on the month grid to navigate one month", () => {
    const navigateMonth = vi.fn();
    renderGrid({}, { navigateMonth });

    const gridShell = screen.getByTestId("calendar-grid-shell");
    fireEvent.wheel(gridShell, { deltaY: 100, deltaMode: 0, cancelable: true });
    expect(navigateMonth).not.toHaveBeenCalled();

    fireEvent.wheel(gridShell, { deltaY: 90, deltaMode: 0, cancelable: true });
    expect(navigateMonth).toHaveBeenCalledWith(1);
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

  it("uses the primary boundary color when an adjacent cell belongs to the actual current month", () => {
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
    expect(rightStroke.style.background).toBe("rgb(0, 149, 255)");
    expect(rightStroke.style.width).toBe("2px");
  });

  it("mutes boundaries that do not wrap the actual current month", () => {
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
    expect(rightStroke.style.background).toBe("rgba(137, 180, 250, 0.32)");
    expect(rightStroke.style.width).toBe("2px");
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
    expect(rightStroke.style.background).toBe("rgb(0, 149, 255)");
    expect(rightStroke.style.width).toBe("2px");
  });

  it("shows same visible chip count for today and non-today cells with matching event counts", async () => {
    renderGrid({
      14: Array.from({ length: 4 }, (_, index) => buildEvent(14, index)),
      15: Array.from({ length: 4 }, (_, index) => buildEvent(15, index)),
    });

    const todayCell = screen.getByTestId("calendar-cell-14");
    const siblingCell = screen.getByTestId("calendar-cell-15");

    await waitFor(() => {
      expect(within(todayCell).queryAllByTestId("calendar-cell-item-chip")).toHaveLength(2);
      expect(within(siblingCell).queryAllByTestId("calendar-cell-item-chip")).toHaveLength(2);
    });

    expect(within(todayCell).getAllByTestId("calendar-cell-item-chip")[0].style.height).toBe("30px");
    expect(within(todayCell).getByTestId("calendar-cell-overflow-trigger-14").textContent).toBe("+2 more");
    expect(within(todayCell).getByTestId("calendar-cell-overflow-trigger-14").style.minHeight).toBe("28px");
    expect(within(siblingCell).getByTestId("calendar-cell-overflow-trigger-15").textContent).toBe("+2 more");
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
    expect(ghost.style.pointerEvents).toBe("none");
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

    const firstLeft = firstPopover.style.left;
    const firstTop = firstPopover.style.top;

    fireEvent.pointerDown(secondTrigger);
    fireEvent.click(secondTrigger);

    await waitFor(() => {
      const popovers = screen.getAllByTestId("calendar-cell-overflow-popover");
      expect(popovers).toHaveLength(1);
      expect(popovers[0]).toBe(firstPopover);
      expect(popovers[0].style.left).not.toBe(firstLeft);
      expect(popovers[0].style.top).not.toBe(firstTop);
      expect(within(popovers[0]).getByText(dayLabel(16))).toBeTruthy();
      expect(within(popovers[0]).getByText("Day 16 event 4")).toBeTruthy();
      expect(within(popovers[0]).queryByText("Day 15 event 4")).toBeNull();
    });
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
});
