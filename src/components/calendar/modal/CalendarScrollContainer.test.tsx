import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarScrollContainer from "./CalendarScrollContainer";
import { monthBlockHeight, monthIndexToDate } from "../../../hooks/calendar/calendarScrollModel";
import eventsView from "../views/eventsView.tsx";
import billsView from "../views/billsView.tsx";
import type { CalendarGridItemLike } from "./calendarGridCellModel";
import type { CalendarGridActiveViewContract, CalendarGridLayout } from "./CalendarGrid";

// Every test here drives the settle/alignment logic through real-time
// waitFor polling: the settle is a setTimeout(SCROLL_SETTLE_MS) and the scroll
// handler defers its work through requestAnimationFrame, so both the clock and
// rAF must be the genuine implementations for waitFor to observe progress.
// Without isolation a prior test (a sibling here, or in another file sharing
// the worker) can leave fake timers installed or rAF stubbed/spied; inheriting
// that state makes the settle's setTimeout never elapse, so the post-scroll
// waitFor hangs until it times out instead of failing on a value. Re-establish
// real timers before each test, and restore mocks/timers after each so this
// file never exports that state to whatever runs next either.
beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 4;
const TODAY_DATE = 23;
const CELL_HEIGHT = 140;
const GRID_GAP = 8;

const layout: CalendarGridLayout & { contentGap: number } = {
  cellHeight: CELL_HEIGHT,
  gridGap: GRID_GAP,
  weekHeaderGap: 6,
  contentGap: 12,
  stacked: false,
  tier: "xl",
};

const activeView = {
  label: "Events",
  renderCellContents: () => null,
};

function buildFallbackDayState(items: CalendarGridItemLike[]) {
  const list = Array.isArray(items) ? items : [];
  return { items: list, totalCount: list.length };
}

function renderContainer(overrides: Partial<ComponentProps<typeof CalendarScrollContainer>> = {}) {
  const baseProps: ComponentProps<typeof CalendarScrollContainer> = {
    view: "events",
    activeView,
    layout,
    currentYear: CURRENT_YEAR,
    currentMonth: CURRENT_MONTH,
    todayDate: TODAY_DATE,
    viewYear: CURRENT_YEAR,
    viewMonth: CURRENT_MONTH,
    onDisplayMonthChange: vi.fn(),
    onFetchSettle: vi.fn(),
    viewData: null,
    showGridSkeleton: false,
    buildFallbackDayState,
    closeEventEditor: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),
    ...overrides,
  };
  const result = render(<CalendarScrollContainer {...baseProps} />);
  return {
    ...result,
    rerenderContainer: (nextOverrides: Partial<ComponentProps<typeof CalendarScrollContainer>> = {}) => result.rerender(
      <CalendarScrollContainer {...baseProps} {...nextOverrides} />,
    ),
  };
}

function monthOffset(targetIndex: number) {
  let offset = 0;
  for (let i = -24; i < targetIndex; i++) {
    const { year, month } = monthIndexToDate(i, CURRENT_YEAR, CURRENT_MONTH);
    offset += monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
  }
  return offset;
}

function monthHeight(targetIndex: number) {
  const { year, month } = monthIndexToDate(targetIndex, CURRENT_YEAR, CURRENT_MONTH);
  return monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
}

function getScrollElement(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-testid='calendar-scroll-container']")!;
}

describe("CalendarScrollContainer", () => {
  it("each mounted grid has a role='grid' element with correct ARIA label", () => {
    const { container } = renderContainer();
    const grids = container.querySelectorAll("[role='grid']");
    expect(grids).toHaveLength(5);
    const expectedLabels = Array.from({ length: 5 }, (_, index) => {
      const { year, month } = monthIndexToDate(index - 2, CURRENT_YEAR, CURRENT_MONTH);
      const monthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      return `Events calendar for ${monthLabel}`;
    });
    expect(Array.from(grids, (grid) => grid.getAttribute("aria-label"))).toEqual(expectedLabels);
  });

  it("non-active grids render interactive cells without active-month testids", () => {
    const { container } = renderContainer({ viewData: { events: [], isLoading: false } });
    const blocks = container.querySelectorAll<HTMLElement>("[data-month-block]");
    const activeTestId = `month-block-${CURRENT_YEAR}-${CURRENT_MONTH}`;
    for (const block of blocks) {
      if (block.dataset.testid === activeTestId) continue;
      expect(block.querySelectorAll("[role='gridcell']").length).toBeGreaterThan(0);
      expect(block.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
      expect(block.querySelector("[data-testid='calendar-grid-shell']")).toBeNull();
    }
  });

  it("renders bills in a non-active mounted month (chips don't vanish past the active+cached pair)", () => {
    // Bills' itemsByDate spans the whole fetched range (it is not month-scoped
    // like events). A bill due two months ahead must still render in that
    // month's mounted block — the regression handed every non-active,
    // non-cached month emptyObj, so chips only survived in the active month and
    // the one previously-active (cached) month.
    const julyBill = { id: "b-jul", scheduleId: "s-jul", name: "Narwhal", amount: 3.99, next_date: "2026-07-15", type: "bill", paid: false };
    const paidMayBill = { id: "b-may", scheduleId: "s-may", name: "Torbox", amount: 10, next_date: "2026-03-15", type: "bill", paid: true };
    const { container } = renderContainer({
      view: "bills",
      activeView: billsView as unknown as CalendarGridActiveViewContract,
      itemsByDate: { "2026-07-15": [julyBill], "2026-03-15": [paidMayBill] },
    });

    const julyBlock = container.querySelector("[data-testid='month-block-2026-6']");
    expect(julyBlock?.textContent).toContain("Narwhal");

    // A paid bill two months back renders too (task: stop dropping paid bills).
    const marchBlock = container.querySelector("[data-testid='month-block-2026-2']");
    expect(marchBlock?.textContent).toContain("Torbox");
  });

  it("renders event and deadline ghosts in a trailing week owned by the next month block", () => {
    const { container } = renderContainer({
      viewMonth: 3,
      activeView: eventsView,
      viewData: { events: [], isLoading: false },
      ghostPreview: {
        kind: "mixed",
        ghosts: [
          {
            id: "event-ghost",
            kind: "event",
            title: "Boundary event ghost",
            startDate: "2026-04-29",
            endDate: "2026-04-29",
            allDay: true,
            lane: 0,
            conflictCount: 0,
          },
          {
            id: "deadline-ghost",
            kind: "deadline",
            title: "Boundary deadline ghost",
            startDate: "2026-04-30",
            endDate: "2026-04-30",
            lane: 1,
            conflictCount: 0,
          },
        ],
      },
    });

    const mayBlock = container.querySelector("[data-testid='month-block-2026-4']");
    expect(mayBlock?.textContent).toContain("Boundary event ghost");
    expect(mayBlock?.textContent).toContain("Boundary deadline ghost");
  });

  it("renders previous-month deadlines in a leading spillover week", () => {
    const aprilDeadline = {
      id: "todo-apr-boundary",
      title: "April boundary deadline",
      due_date: "2026-04-30",
      status: "open",
    };
    const { container } = renderContainer({
      viewMonth: 3,
      activeView: eventsView,
      viewData: {
        events: [],
        isLoading: false,
        deadlineOverlay: {
          enabled: true,
          showCompleted: true,
          data: { upcoming: [] },
        },
      },
      getMonthDeadlines: (year, month) => ({
        upcoming: year === 2026 && month === 3 ? [aprilDeadline] : [],
      }),
    });

    const mayBlock = container.querySelector("[data-testid='month-block-2026-4']");
    expect(mayBlock?.textContent).toContain("April boundary deadline");
  });

  it("rebuilds mounted deadline previews when only the deadline cache revision changes", () => {
    let aprilDeadlineData = { upcoming: [] as Array<Record<string, unknown>> };
    const emptyDeadlineData = { upcoming: [] };
    const getMonthDeadlines = (year: number, month: number) => (
      year === 2026 && month === 3 ? aprilDeadlineData : emptyDeadlineData
    );
    const sharedProps = {
      viewMonth: 3,
      activeView: eventsView,
      viewData: {
        events: [],
        isLoading: false,
        deadlineOverlay: {
          enabled: true,
          showCompleted: true,
          data: { upcoming: [] },
        },
      },
      getMonthDeadlines,
    };
    const { container, rerenderContainer } = renderContainer({
      ...sharedProps,
      dataRevision: 0,
    });
    expect(container.textContent).not.toContain("New boundary deadline");

    aprilDeadlineData = {
      upcoming: [{
        id: "todo-apr-refresh",
        title: "New boundary deadline",
        due_date: "2026-04-30",
        status: "open",
      }],
    };
    rerenderContainer({
      ...sharedProps,
      dataRevision: 1,
    });

    const mayBlock = container.querySelector("[data-testid='month-block-2026-4']");
    expect(mayBlock?.textContent).toContain("New boundary deadline");
  });

  it("does not render a cached bills month through the events view after switching views", () => {
    const transaction = {
      id: "txn-may",
      date: "2026-05-15",
      payee: "Corner Market",
      amount: 24.5,
      direction: "expense",
    };
    const billsComputed = billsView.compute({
      data: { schedules: [], transactions: [transaction], payeeMap: {} },
      viewYear: CURRENT_YEAR,
      viewMonth: CURRENT_MONTH,
    });
    const { rerenderContainer } = renderContainer({
      view: "bills",
      activeView: billsView as unknown as CalendarGridActiveViewContract,
      itemsByDay: billsComputed.itemsByDay as unknown as Record<number, CalendarGridItemLike[]>,
      itemsByDate: billsComputed.itemsByDate as unknown as Record<string, CalendarGridItemLike[]>,
    });

    rerenderContainer({
      view: "bills",
      activeView: billsView as unknown as CalendarGridActiveViewContract,
      viewMonth: CURRENT_MONTH + 1,
      itemsByDay: {},
      itemsByDate: billsComputed.itemsByDate as unknown as Record<string, CalendarGridItemLike[]>,
    });

    expect(() => rerenderContainer({
      view: "events",
      activeView: eventsView,
      viewMonth: CURRENT_MONTH + 1,
      viewData: { events: [], isLoading: false },
      itemsByDay: {},
      itemsByDate: {},
    })).not.toThrow();
  });

  it("tints a selected deadline chip rendered from a non-active preview month", () => {
    const { container } = renderContainer({
      activeView: eventsView,
      viewData: {
        events: [],
        isLoading: false,
        deadlineOverlay: {
          enabled: true,
          showCompleted: true,
          data: { upcoming: [] },
        },
      },
      isMonthCached: () => true,
      getMonthDeadlines: (year, month) => (
        year === 2026 && month === 3
          ? {
              upcoming: [
                { id: "todo-apr", title: "April deadline", due_date: "2026-04-20", status: "open" },
              ],
            }
          : { upcoming: [] }
      ),
      selectedDay: 20,
      selectedDateKey: "2026-04-20",
      selectedItemId: null,
      floatingDetailOpen: true,
      floatingDetailMode: "detail",
      floatingDetailItemId: "deadline:todo-apr:2026-04-20",
      floatingDetailDateKey: "2026-04-20",
    });

    const aprilBlock = container.querySelector("[data-testid='month-block-2026-3']");
    const chip = aprilBlock?.querySelector("[data-testid='calendar-cell-item-chip']");
    expect(chip?.textContent).toContain("April deadline");
    expect(chip?.getAttribute("data-selected")).toBe("true");
  });

  describe("mount initialization", () => {
    // refYear/refMonth are seeded from today, so centering "today's index"
    // always centered index 0 — silently discarding a focus month the modal
    // mounted on (e.g. dashboard → deadline two months out).
    it("centers the mounted view month, not today", () => {
      const { container } = renderContainer({
        viewYear: CURRENT_YEAR,
        viewMonth: CURRENT_MONTH + 2,
      });
      const scrollEl = getScrollElement(container);
      // jsdom clientHeight is 0, so centering resolves to offset + height / 2.
      expect(scrollEl.scrollTop).toBe(monthOffset(2) + monthHeight(2) / 2);
    });

  });

});
