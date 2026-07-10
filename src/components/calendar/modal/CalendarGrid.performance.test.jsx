import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid.jsx";
import CalendarCellItemStack from "./CalendarCellItemStack.jsx";
import * as spanLayoutModule from "./calendarEventSpanLayout.js";
import * as calendarGridRowModelModule from "../../../hooks/calendar/calendarGridRowModel.js";
import { renderEventsCellContents } from "../views/events/EventsCellContent.jsx";
import { renderBillsCellContents } from "../views/bills/BillsCellContent.jsx";
import {
  allComplete as billsAllComplete,
  billMatchesItemId,
  compute as computeBillsState,
  getDayState as getBillsDayState,
  hasOverdue as billsHasOverdue,
} from "../views/bills/billsModel.js";

vi.mock("./calendarEventSpanLayout.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildCalendarEventSpanLayout: vi.fn(actual.buildCalendarEventSpanLayout),
  };
});

vi.mock("./CalendarCellItemStack.jsx", () => ({
  default: vi.fn(({ dateKey }) => <div data-testid={`item-stack-${dateKey}`} />),
}));

vi.mock("../../../hooks/calendar/calendarGridRowModel.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildGridRows: vi.fn(actual.buildGridRows),
  };
});

const VIEW_YEAR = 2026;
const VIEW_MONTH = 3;

const activeView = {
  label: "Events",
  renderCellContents: ({ dateKey, ghosts = [] }) => (
    <div data-testid={`cell-content-${dateKey}`}>
      {ghosts.map((ghost) => (
        <span key={ghost.id}>{ghost.title}</span>
      ))}
    </div>
  ),
};

function buildFallbackDayState(items) {
  const list = Array.isArray(items) ? items : [];
  return { items: list, totalCount: list.length };
}

function buildGridProps(overrides = {}) {
  return {
    view: "events",
    viewYear: VIEW_YEAR,
    viewMonth: VIEW_MONTH,
    currentYear: VIEW_YEAR,
    currentMonth: VIEW_MONTH,
    todayDate: 20,
    firstDay: 3,
    daysInMonth: 30,
    itemsByDay: {},
    itemsByDate: {},
    selectedDay: null,
    selectedDateKey: null,
    selectedItemId: null,
    viewData: { events: [], isLoading: false },
    activeView,
    layout: {
      tier: "lg",
      stacked: false,
      weekHeaderGap: 6,
      cellHeight: 164,
      gridGap: 8,
    },
    showGridSkeleton: false,
    buildFallbackDayState,
    closeEventEditor: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),
    eventQuickActions: {},
    deadlineQuickActions: {},
    ...overrides,
  };
}

function renderGrid(props) {
  const wrapGrid = (ui) => (
    <div data-testid="calendar-modal-panel">
      {ui}
    </div>
  );
  const result = render(wrapGrid(<CalendarGrid {...props} />));

  return {
    ...result,
    rerenderGrid: (nextProps) => result.rerender(wrapGrid(<CalendarGrid {...nextProps} />)),
  };
}

let originalResizeObserver;

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.mocked(spanLayoutModule.buildCalendarEventSpanLayout).mockClear();
  vi.mocked(calendarGridRowModelModule.buildGridRows).mockClear();
  vi.mocked(CalendarCellItemStack).mockClear();
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

describe("CalendarGrid editor performance", () => {
  it("updates single-day ghost titles without rebuilding span layout", () => {
    const firstGhostPreview = {
      kind: "event",
      ghosts: [{
        id: "ghost-create-20",
        kind: "event",
        title: "Draft hold",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "15:30",
        endTime: "16:00",
        allDay: false,
        color: "#89b4fa",
      }],
    };
    const props = buildGridProps({ ghostPreview: firstGhostPreview });
    const { rerenderGrid } = renderGrid(props);
    const callsAfterInitialRender = spanLayoutModule.buildCalendarEventSpanLayout.mock.calls.length;

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Draft hold")).toBeTruthy();

    rerenderGrid({
      ...props,
      ghostPreview: {
        ...firstGhostPreview,
        ghosts: [{
          ...firstGhostPreview.ghosts[0],
          title: "Draft hold, still typing",
        }],
      },
    });

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Draft hold, still typing")).toBeTruthy();
    expect(spanLayoutModule.buildCalendarEventSpanLayout).toHaveBeenCalledTimes(callsAfterInitialRender);
  });

  it("does not rerender every cell for single-day ghost title edits", () => {
    const renderCellContents = vi.fn(activeView.renderCellContents);
    const firstGhostPreview = {
      kind: "event",
      ghosts: [{
        id: "ghost-create-20",
        kind: "event",
        title: "Draft hold",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "15:30",
        endTime: "16:00",
        allDay: false,
        color: "#89b4fa",
      }],
    };
    const props = buildGridProps({
      activeView: {
        ...activeView,
        renderCellContents,
      },
      ghostPreview: firstGhostPreview,
    });
    const { rerenderGrid } = renderGrid(props);
    renderCellContents.mockClear();

    rerenderGrid({
      ...props,
      ghostPreview: {
        ...firstGhostPreview,
        ghosts: [{
          ...firstGhostPreview.ghosts[0],
          title: "Draft hold, still typing",
        }],
      },
    });

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Draft hold, still typing")).toBeTruthy();
    expect(renderCellContents).toHaveBeenCalledTimes(1);
    expect(renderCellContents).toHaveBeenCalledWith(expect.objectContaining({
      dateKey: "2026-04-20",
    }));
  });
});

describe("CalendarGrid cell descriptor identity (PERF-01)", () => {
  const EVENT_ITEM_DAY_15 = {
    id: "evt-15",
    title: "Standing meeting",
    startMs: new Date("2026-04-15T18:00:00.000Z").getTime(),
    endMs: new Date("2026-04-15T18:30:00.000Z").getTime(),
    color: "#4285f4",
  };

  const eventsActiveView = {
    label: "Events",
    renderCellContents: renderEventsCellContents,
  };

  function itemStackCallsFor(dateKey) {
    return vi.mocked(CalendarCellItemStack).mock.calls.filter(
      ([callProps]) => callProps.dateKey === dateKey,
    );
  }

  it("keeps an untouched cell's descriptor array referentially identical across an unrelated grid re-render", () => {
    const props = buildGridProps({
      activeView: eventsActiveView,
      itemsByDate: { "2026-04-15": [EVENT_ITEM_DAY_15] },
      itemsByDay: { 15: [EVENT_ITEM_DAY_15] },
      selectedItemId: null,
    });
    const { rerenderGrid } = renderGrid(props);

    const firstCalls = itemStackCallsFor("2026-04-15");
    expect(firstCalls.length).toBeGreaterThan(0);
    const firstItems = firstCalls[firstCalls.length - 1][0].items;

    // An unrelated selection change is a shared prop for every grid cell, so
    // it forces every CalendarGridCellSlot (and therefore this untouched
    // cell) to re-render, even though day 15's own items/ghosts/layout
    // inputs never changed.
    rerenderGrid({
      ...props,
      selectedItemId: "some-other-item-id",
    });

    const secondCalls = itemStackCallsFor("2026-04-15");
    expect(secondCalls.length).toBeGreaterThan(firstCalls.length);
    const secondItems = secondCalls[secondCalls.length - 1][0].items;

    expect(secondItems).toBe(firstItems);
  });
});

describe("CalendarGrid bills cell descriptor identity (PERF-01 follow-up)", () => {
  const BILL_SCHEDULE_DAY_15 = {
    id: "bill-15",
    scheduleId: "sched-15",
    name: "Rent",
    payee: "Landlord",
    amount: 1200,
    next_date: "2026-04-15",
    paid: false,
    type: "bill",
  };

  // Build itemsByDate/itemsByDay the same way billsView.compute() does in
  // production (schedules -> groupBills-ed dayState objects), rather than
  // handing the grid a raw array. billsView.compute() groups every value
  // before storage, so the grid's real getDayState calls always receive an
  // object with `activeItems` and hit its own short-circuit
  // (`if (rawItems?.activeItems) return rawItems;`), returning it unchanged.
  // See the note above `billDayStateCache` in billsModel.js.
  const billsComputed = computeBillsState({
    data: { schedules: [BILL_SCHEDULE_DAY_15], payeeMap: {} },
    viewYear: VIEW_YEAR,
    viewMonth: VIEW_MONTH,
  });

  const billsActiveView = {
    label: "Bills",
    getDayState: getBillsDayState,
    hasOverdue: billsHasOverdue,
    allComplete: billsAllComplete,
    getItemId: (bill) => bill?.scheduleId || bill?.id,
    matchesItemId: billMatchesItemId,
    renderCellContents: renderBillsCellContents,
  };

  function itemStackCallsFor(dateKey) {
    return vi.mocked(CalendarCellItemStack).mock.calls.filter(
      ([callProps]) => callProps.dateKey === dateKey,
    );
  }

  it("keeps an untouched bills cell's descriptor array referentially identical across an unrelated grid re-render", () => {
    const props = buildGridProps({
      view: "bills",
      activeView: billsActiveView,
      itemsByDate: billsComputed.itemsByDate,
      itemsByDay: billsComputed.itemsByDay,
      selectedItemId: null,
    });
    const { rerenderGrid } = renderGrid(props);

    const firstCalls = itemStackCallsFor("2026-04-15");
    expect(firstCalls.length).toBeGreaterThan(0);
    const firstItems = firstCalls[firstCalls.length - 1][0].items;

    // An unrelated selection change is a shared prop for every grid cell, so
    // it forces every CalendarGridCellSlot (and therefore this untouched
    // cell) to re-render, even though day 15's own items/ghosts/layout
    // inputs never changed. This guards the real production contract via
    // getDayState's short-circuit on an already-grouped value (billsComputed
    // above, built the same way billsView.compute() builds it) plus the
    // upstream memoization of `computed` in useCalendarModalViewModel — NOT
    // via the getDayState WeakMap cache, which this scenario never reaches
    // (see the comment above billDayStateCache in billsModel.js). This test
    // therefore passes on its own regardless of that cache's presence.
    rerenderGrid({
      ...props,
      selectedItemId: "some-other-item-id",
    });

    const secondCalls = itemStackCallsFor("2026-04-15");
    expect(secondCalls.length).toBeGreaterThan(firstCalls.length);
    const secondItems = secondCalls[secondCalls.length - 1][0].items;

    expect(secondItems).toBe(firstItems);
  });
});

describe("CalendarGridCells memoization (PERF-L02)", () => {
  it("memoizes gridRows + cellLookup to avoid rebuilds on identical props", () => {
    const props = buildGridProps({
      viewYear: 2026,
      viewMonth: 3,
    });
    const { rerenderGrid } = renderGrid(props);
    const callsAfterInitialRender = vi.mocked(calendarGridRowModelModule.buildGridRows).mock.calls.length;

    // Re-render with identical props — buildGridRows should not be called again
    rerenderGrid(props);

    const callsAfterRerender = vi.mocked(calendarGridRowModelModule.buildGridRows).mock.calls.length;
    expect(callsAfterRerender).toBe(callsAfterInitialRender);
  });
});
