import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarGrid from "./CalendarGrid";

const VIEW_YEAR = 2026;
const VIEW_MONTH = 3;

const activeView = {
  label: "Events",
  renderCellContents: ({ dateKey, ghosts = [] }: {
    dateKey: string;
    ghosts?: Array<{ id: string; title: string }>;
  }) => (
    <div data-testid={`cell-content-${dateKey}`}>
      {ghosts.map((ghost) => (
        <span key={ghost.id}>{ghost.title}</span>
      ))}
    </div>
  ),
};

function buildFallbackDayState(items: unknown) {
  const list = Array.isArray(items) ? items : [];
  return { items: list, totalCount: list.length };
}

function buildGridProps(
  overrides: Partial<ComponentProps<typeof CalendarGrid>> = {},
): ComponentProps<typeof CalendarGrid> {
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

function renderGrid(props: ComponentProps<typeof CalendarGrid>) {
  const wrapGrid = (ui: ReactNode) => (
    <div data-testid="calendar-modal-panel">
      {ui}
    </div>
  );
  const result = render(wrapGrid(<CalendarGrid {...props} />));

  return {
    ...result,
    rerenderGrid: (nextProps: ComponentProps<typeof CalendarGrid>) => result.rerender(wrapGrid(<CalendarGrid {...nextProps} />)),
  };
}

let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
});

describe("CalendarGrid editor updates", () => {
  it("renders a changed single-day ghost title across an unrelated grid rerender", () => {
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
  });
});
