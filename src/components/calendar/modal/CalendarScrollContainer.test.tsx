import { useState } from "react";
import type { ComponentProps } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarScrollContainer from "./CalendarScrollContainer";
import { monthBlockHeight, monthIndexToDate } from "../../../hooks/calendar/calendarScrollModel";
import eventsView from "../views/eventsView.tsx";
import billsView from "../views/billsView.tsx";
import type { CalendarGridItemLike } from "./calendarGridCellModel";
import type { CalendarGridActiveViewContract, CalendarGridLayout } from "./CalendarGrid";
import type { Mock } from "vitest";

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

// The mount centering write is marked programmatic and clears on the settle
// timer; tests dispatching user scrolls must first wait out that window, the
// same way a real browser's mount echo settles before the user can scroll.
// Polls the onFetchSettle spy (the settle's observable) instead of sleeping a
// fixed interval, so starved timers under suite load cannot flake the wait.
async function awaitMountSettle(onFetchSettle: Mock) {
  await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });
  onFetchSettle.mockClear();
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

  it("dispatches calendar-overflow-close on scroll", () => {
    const { container } = renderContainer();
    const scrollEl = getScrollElement(container);
    const handler = vi.fn();
    document.addEventListener("calendar-overflow-close", handler);
    try {
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("calendar-overflow-close", handler);
    }
  });

  it("cancels a clean floating editor on user scroll", async () => {
    const onCancelFloatingEditor = vi.fn();
    const onFetchSettle = vi.fn();
    const { container } = renderContainer({
      floatingDetailOpen: true,
      floatingDetailMode: "create",
      floatingEditorDirty: false,
      onCancelFloatingEditor,
      onFetchSettle,
    });
    const scrollEl = getScrollElement(container);
    await awaitMountSettle(onFetchSettle);

    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(onCancelFloatingEditor).toHaveBeenCalledTimes(1);
  });

  it("does not let an unconsumed scroll crossing swallow the next programmatic navigation", async () => {
    // The controller can ignore a scroll-driven display-month change (agenda-
    // driven suppression, open floating editor). The crossing's scroll-driven
    // flag must not survive to eat the next programmatic navigation.
    const props = {
      view: "events",
      activeView,
      layout,
      currentYear: CURRENT_YEAR,
      currentMonth: CURRENT_MONTH,
      todayDate: TODAY_DATE,
      viewYear: CURRENT_YEAR,
      viewMonth: CURRENT_MONTH,
      onDisplayMonthChange: vi.fn(), // inert: the controller ignored the crossing
      onFetchSettle: vi.fn(),
      viewData: null,
      buildFallbackDayState,
      closeEventEditor: vi.fn(),
      setSelectedDay: vi.fn(),
      setSelectedDateKey: vi.fn(),
      setSelectedItemId: vi.fn(),
    };
    const { container, rerender } = render(<CalendarScrollContainer {...props} />);
    const scrollEl = getScrollElement(container);
    await awaitMountSettle(props.onFetchSettle);

    // User scroll crosses into the next month; the parent does not consume it.
    scrollEl.scrollTop = monthOffset(1) + 10;
    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
    await waitFor(() => expect(props.onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });

    // Programmatic navigation three months out must still move the grid.
    rerender(<CalendarScrollContainer {...props} viewMonth={CURRENT_MONTH + 3} />);
    expect(scrollEl.scrollTop).toBe(monthOffset(3));
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

    it("keeps the focus month when the mount centering write echoes a scroll event", async () => {
      const onDisplayMonthChange = vi.fn();
      const onFetchSettle = vi.fn();
      const { container } = renderContainer({
        viewYear: CURRENT_YEAR,
        viewMonth: CURRENT_MONTH + 2,
        onDisplayMonthChange,
        onFetchSettle,
      });
      const scrollEl = getScrollElement(container);
      // jsdom fires no scroll event for scrollTop writes; emulate the echo a
      // real browser produces for the mount centering write.
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      // The echo settle must not read as user intent or it re-targets the
      // agenda rail to first-of-month, stomping more specific focus commands.
      await waitFor(() => {
        expect(onFetchSettle).toHaveBeenCalledWith(expect.objectContaining({ scrollDriven: false }));
      }, { timeout: 5000 });
      expect(onDisplayMonthChange).not.toHaveBeenCalled();
    });
  });

  describe("scroll settle after a month crossing", () => {
    // The inert-vi.fn() harnesses above never change props, so they cannot
    // catch the settle timer being killed by the re-render that a real
    // display-month change triggers. This harness consumes the change the
    // way the controller does: by updating viewYear/viewMonth.
    function ControlledContainer({ onFetchSettle }: {
      onFetchSettle: NonNullable<ComponentProps<typeof CalendarScrollContainer>["onFetchSettle"]>;
    }) {
      const [viewDate, setViewDate] = useState({ year: CURRENT_YEAR, month: CURRENT_MONTH });
      return (
        <CalendarScrollContainer
          view="events"
          activeView={activeView}
          layout={layout}
          currentYear={CURRENT_YEAR}
          currentMonth={CURRENT_MONTH}
          todayDate={TODAY_DATE}
          viewYear={viewDate.year}
          viewMonth={viewDate.month}
          onDisplayMonthChange={setViewDate}
          onFetchSettle={onFetchSettle}
          viewData={null}
          buildFallbackDayState={buildFallbackDayState}
          closeEventEditor={() => {}}
          setSelectedDay={() => {}}
          setSelectedDateKey={() => {}}
          setSelectedItemId={() => {}}
        />
      );
    }

    it("still fires the fetch settle when the gesture's final event crosses a month", async () => {
      const onFetchSettle = vi.fn();
      const { container } = render(<ControlledContainer onFetchSettle={onFetchSettle} />);
      const scrollEl = getScrollElement(container);
      await awaitMountSettle(onFetchSettle);

      // Final event of a gesture lands inside the next month: the crossing
      // updates the display month, which re-renders with a new activeIndex.
      scrollEl.scrollTop = monthOffset(1) + 10;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

      const next = monthIndexToDate(1, CURRENT_YEAR, CURRENT_MONTH);
      await waitFor(() => {
        expect(onFetchSettle).toHaveBeenCalledWith(
          expect.objectContaining({ year: next.year, month: next.month, scrollDriven: true }),
        );
      }, { timeout: 5000 });
    });

  });

});
