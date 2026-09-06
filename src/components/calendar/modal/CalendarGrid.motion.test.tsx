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
