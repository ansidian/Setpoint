import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid";
import { renderEventsCellContents } from "../views/events/EventsCellContent.tsx";

const VIEW_YEAR = 2026;
const VIEW_MONTH = 3;
const TODAY_DAY = 14;
const CELL_HEIGHT = 164;

const activeView = {
  label: "Events",
  renderCellContents: renderEventsCellContents,
};

const groupedDayView = {
  label: "Bills",
  getDayState(rawItems: unknown) {
    if (rawItems && typeof rawItems === "object" && "items" in rawItems) {
      return rawItems as ReturnType<typeof buildFallbackDayState>;
    }
    const items = Array.isArray(rawItems) ? rawItems as Array<{ id: string; title: string }> : [];
    return {
      items,
      activeItems: items,
      completedItems: [],
      activeCount: items.length,
      completedCount: 0,
      totalCount: items.length,
    };
  },
  renderCellContents({ items }: { items: { items: Array<{ id: string; title: string }> } }) {
    return items.items.map((item: { id: string; title: string }) => (
      <span key={item.id}>{item.title}</span>
    ));
  },
};

function buildFallbackDayState(items: unknown) {
  const resolvedItems = Array.isArray(items) ? items : [];
  return {
    items: resolvedItems,
    totalCount: resolvedItems.length,
  };
}

function buildEvent(day: number, index: number) {
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

function buildGridProps(
  itemsByDay: ComponentProps<typeof CalendarGrid>["itemsByDay"],
  overrides: Partial<ComponentProps<typeof CalendarGrid>> = {},
): ComponentProps<typeof CalendarGrid> {
  return {
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
    showEventsLoadingState: false,
    buildFallbackDayState,
    closeEventEditor: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedItemId: vi.fn(),
    ...overrides,
  };
}

function renderGrid(
  itemsByDay: ComponentProps<typeof CalendarGrid>["itemsByDay"],
  overrides: Partial<ComponentProps<typeof CalendarGrid>> = {},
) {
  const props = buildGridProps(itemsByDay, overrides);
  const wrapGrid = (ui: ReactNode) => (
    <div data-testid="calendar-modal-panel">
      {ui}
    </div>
  );
  const result = render(wrapGrid(<CalendarGrid {...props} />));

  return {
    ...result,
    rerender: (ui: ReactNode) => result.rerender(wrapGrid(ui)),
    props,
  };
}

let originalResizeObserver: typeof ResizeObserver | undefined;

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
    Reflect.deleteProperty(globalThis, "ResizeObserver");
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

  it("renders date-keyed items for non-event views in boundary row cells", () => {
    renderGrid({}, {
      view: "bills",
      activeView: groupedDayView,
      viewMonth: 4,
      currentMonth: 3,
      firstDay: 5,
      daysInMonth: 31,
      itemsByDate: {
        "2026-05-01": groupedDayView.getDayState([
          { id: "bill-may-1", title: "May utility" },
        ]) as unknown as ComponentProps<typeof CalendarGrid>["itemsByDay"][number],
      },
    });

    const mayCell = screen.getByTestId("calendar-cell-1");
    expect(within(mayCell).getByText("May utility")).toBeTruthy();

    expect(screen.queryByTestId("calendar-month-boundary-overlay")).toBeNull();
    expect(screen.queryAllByRole("gridcell")
      .find((el) => el.getAttribute("data-boundary-pass-through") === "true")).toBeUndefined();
  });

  it("shows same visible chip count for today and non-today cells with matching event counts", async () => {
    renderGrid({
      14: Array.from({ length: 5 }, (_, index) => buildEvent(14, index)),
      15: Array.from({ length: 5 }, (_, index) => buildEvent(15, index)),
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
    expect(within(todayCell).getByTestId("calendar-cell-overflow-trigger-14").textContent).toBe(`+${5 - visibleCount} more`);
    expect(within(siblingCell).getByTestId("calendar-cell-overflow-trigger-15").textContent).toBe(`+${5 - visibleCount} more`);
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
    await screen.findByTestId("calendar-cell-inline-overflow");

    fireEvent.click(screen.getByTestId("calendar-event-span-segment"), { clientX: 4 });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeTruthy();
    });
  });

  it("opens hidden deadline overlay rows with deadline floating detail metadata", async () => {
    const onOpenFloatingDetail = vi.fn();
    const deadline = {
      id: "todo-hidden",
      calendarItemKind: "deadline",
      title: "Hidden deadline",
      due_date: "2026-04-20",
      due_time: "5:00 PM",
      status: "incomplete",
    };

    renderGrid({
      20: [
        ...Array.from({ length: 5 }, (_, index) => buildEvent(20, index)),
        deadline,
      ],
    }, { onOpenFloatingDetail });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    const overflowLayer = await screen.findByTestId("calendar-cell-inline-overflow");
    fireEvent.click(within(overflowLayer).getByText("Hidden deadline"));

    expect(onOpenFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "deadline:todo-hidden:2026-04-20",
      view: "events",
      detailKind: "deadline",
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

  it("retargets open inline overflow to second trigger without closing first", async () => {
    renderGrid({
      15: Array.from({ length: 5 }, (_, index) => buildEvent(15, index)),
      16: Array.from({ length: 5 }, (_, index) => buildEvent(16, index)),
    });

    const firstTrigger = screen.getByTestId("calendar-cell-overflow-trigger-15");
    const secondTrigger = screen.getByTestId("calendar-cell-overflow-trigger-16");

    fireEvent.click(firstTrigger);

    const firstLayer = await screen.findByTestId("calendar-cell-inline-overflow");
    expect(within(firstLayer).getByText("Day 15 event 4")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-cell-inline-overflow")).toHaveLength(1);

    fireEvent.pointerDown(secondTrigger);
    fireEvent.click(secondTrigger);

    await waitFor(() => {
      const layers = screen.getAllByTestId("calendar-cell-inline-overflow");
      expect(layers).toHaveLength(1);
      expect(within(layers[0]!).getByText("Day 16 event 4")).toBeTruthy();
      expect(within(layers[0]!).queryByText("Day 15 event 4")).toBeNull();
    });
  });

  it("closes inline overflow on Escape", async () => {
    renderGrid({
      15: Array.from({ length: 5 }, (_, index) => buildEvent(15, index)),
    });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-15"));
    expect(await screen.findByTestId("calendar-cell-inline-overflow")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();
    });
  });

  it("closes non-active month overflow when selecting a cell in another mounted month", async () => {
    const dayEvents = Array.from({ length: 5 }, (_, index) => buildEvent(20, index));
    const baseProps = buildGridProps({});

    render(
      <div data-testid="calendar-modal-panel">
        <CalendarGrid
          {...baseProps}
          isActiveMonth={false}
          itemsByDay={{ 20: dayEvents }}
          selectedDay={null}
          selectedItemId={null}
        />
        <CalendarGrid
          {...baseProps}
          viewMonth={VIEW_MONTH + 1}
          currentMonth={VIEW_MONTH + 1}
          firstDay={5}
          daysInMonth={31}
          itemsByDay={{}}
          selectedDay={null}
          selectedItemId={null}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    expect(await screen.findByTestId("calendar-cell-inline-overflow")).toBeTruthy();

    const adjacentMonthCell = screen.getByTestId("calendar-cell-10");
    fireEvent.pointerDown(adjacentMonthCell);
    fireEvent.click(adjacentMonthCell);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();
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

  it("does not revive stale overflow anchors after month navigation", async () => {
    const dayEvents = Array.from({ length: 5 }, (_, index) => buildEvent(20, index));
    const { props, rerender } = renderGrid({ 20: dayEvents });

    fireEvent.click(screen.getByTestId("calendar-cell-overflow-trigger-20"));
    expect(await screen.findByTestId("calendar-cell-inline-overflow")).toBeTruthy();

    rerender(
      <CalendarGrid
        {...props}
        itemsByDay={{}}
        viewMonth={VIEW_MONTH + 1}
        currentMonth={VIEW_MONTH + 1}
      />,
    );

    expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();

    rerender(<CalendarGrid {...props} itemsByDay={{ 20: dayEvents }} />);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();
      expect(screen.getByTestId("calendar-cell-overflow-trigger-20")).toBeTruthy();
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
    expect(await screen.findByTestId("calendar-cell-inline-overflow")).toBeTruthy();

    rerender(<CalendarGrid {...props} itemsByDay={{ 20: dayEvents }} ghostPreview={null} />);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();
    });
  });
});
