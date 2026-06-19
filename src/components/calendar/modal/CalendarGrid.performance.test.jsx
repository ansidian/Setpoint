import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid.jsx";
import * as spanLayoutModule from "./calendarEventSpanLayout.js";

vi.mock("./calendarEventSpanLayout.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildCalendarEventSpanLayout: vi.fn(actual.buildCalendarEventSpanLayout),
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
