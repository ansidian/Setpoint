import { useState } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarScrollContainer from "./CalendarScrollContainer.jsx";
import { monthBlockHeight, monthIndexToDate, SCROLL_SETTLE_MS } from "../../../hooks/calendar/calendarScrollModel.js";
import eventsView from "../views/eventsView.jsx";
import billsView from "../views/billsView.jsx";

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

const layout = {
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

function buildFallbackDayState(items) {
  const list = Array.isArray(items) ? items : [];
  return { items: list, totalCount: list.length };
}

function renderContainer(overrides = {}) {
  const baseProps = {
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
    buildFallbackDayState,
    closeEventEditor: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),

    suppressOutsideClick: false,
    ...overrides,
  };
  return render(<CalendarScrollContainer {...baseProps} />);
}

function monthOffset(targetIndex) {
  let offset = 0;
  for (let i = -24; i < targetIndex; i++) {
    const { year, month } = monthIndexToDate(i, CURRENT_YEAR, CURRENT_MONTH);
    offset += monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
  }
  return offset;
}

function monthHeight(targetIndex) {
  const { year, month } = monthIndexToDate(targetIndex, CURRENT_YEAR, CURRENT_MONTH);
  return monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
}

// The mount centering write is marked programmatic and clears on the settle
// timer; tests dispatching user scrolls must first wait out that window, the
// same way a real browser's mount echo settles before the user can scroll.
// Polls the onFetchSettle spy (the settle's observable) instead of sleeping a
// fixed interval, so starved timers under suite load cannot flake the wait.
async function awaitMountSettle(onFetchSettle) {
  await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });
  onFetchSettle.mockClear();
}

describe("CalendarScrollContainer", () => {
  it("renders exactly 5 mounted month-block grids", () => {
    const { container } = renderContainer();
    const blocks = container.querySelectorAll("[data-month-block]");
    expect(blocks).toHaveLength(5);
  });

  it("mounts the active month ± 2", () => {
    const { container } = renderContainer();
    const blocks = container.querySelectorAll("[data-month-block]");
    const indices = Array.from(blocks).map((el) =>
      parseInt(el.dataset.monthIndex, 10),
    );
    expect(indices).toEqual([-2, -1, 0, 1, 2]);
  });

  it("renders spacer divs for months outside the mounted window", () => {
    const { container } = renderContainer();
    const spacers = container.querySelectorAll("[data-month-spacer]");
    expect(spacers).toHaveLength(0);
    const allBlocks = container.querySelectorAll("[data-month-index]");
    const mounted = container.querySelectorAll("[data-month-block]");
    expect(allBlocks.length - mounted.length).toBe(49 - 5);
  });

  it("spacer heights match monthBlockHeight", () => {
    const { container } = renderContainer();
    const all = container.querySelectorAll("[data-month-index]");
    for (const el of all) {
      if (el.hasAttribute("data-month-block")) continue;
      const idx = parseInt(el.dataset.monthIndex, 10);
      const { year, month } = monthIndexToDate(idx, CURRENT_YEAR, CURRENT_MONTH);
      const expected = monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
      expect(parseInt(el.style.height, 10)).toBe(expected);
    }
  });

  it("mounted month-block heights match monthBlockHeight", () => {
    const { container } = renderContainer();
    const blocks = container.querySelectorAll("[data-month-block]");
    for (const block of blocks) {
      const idx = parseInt(block.dataset.monthIndex, 10);
      const { year, month } = monthIndexToDate(idx, CURRENT_YEAR, CURRENT_MONTH);
      const expected = monthBlockHeight({ year, month, cellHeight: CELL_HEIGHT, gridGap: GRID_GAP });
      expect(parseInt(block.style.height, 10)).toBe(expected);
    }
  });

  it("renders CalendarGrid without week headers inside mounted blocks", () => {
    const { container } = renderContainer();
    const blocks = container.querySelectorAll("[data-month-block]");
    for (const block of blocks) {
      const headers = block.querySelectorAll("[role='columnheader']");
      expect(headers).toHaveLength(0);
    }
  });

  it("each mounted grid has a role='grid' element with correct ARIA label", () => {
    const { container } = renderContainer();
    const grids = container.querySelectorAll("[role='grid']");
    expect(grids).toHaveLength(5);
    for (const grid of grids) {
      expect(grid.getAttribute("aria-label")).toMatch(/calendar for/);
    }
  });

  it("non-active grids render interactive cells without active-month testids", () => {
    const { container } = renderContainer({ viewData: { events: [], isLoading: false } });
    const blocks = container.querySelectorAll("[data-month-block]");
    const activeTestId = `month-block-${CURRENT_YEAR}-${CURRENT_MONTH}`;
    for (const block of blocks) {
      if (block.dataset.testid === activeTestId) continue;
      expect(block.querySelectorAll("[role='gridcell']").length).toBeGreaterThan(0);
      expect(block.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
      expect(block.querySelector("[data-testid='calendar-grid-shell']")).toBeNull();
    }
  });

  it("works with the bills view", () => {
    const billsView = {
      label: "Bills",
      getDayState(raw) {
        const items = Array.isArray(raw) ? raw : [];
        return { items, activeItems: items, completedItems: [], activeCount: items.length, completedCount: 0, totalCount: items.length };
      },
      renderCellContents: () => null,
    };
    const { container } = renderContainer({ view: "bills", activeView: billsView });
    const blocks = container.querySelectorAll("[data-month-block]");
    expect(blocks).toHaveLength(5);
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
      activeView: billsView,
      itemsByDate: { "2026-07-15": [julyBill], "2026-03-15": [paidMayBill] },
    });

    const julyBlock = container.querySelector("[data-testid='month-block-2026-6']");
    expect(julyBlock?.textContent).toContain("Narwhal");

    // A paid bill two months back renders too (task: stop dropping paid bills).
    const marchBlock = container.querySelector("[data-testid='month-block-2026-2']");
    expect(marchBlock?.textContent).toContain("Torbox");
  });

  it("does not use native CSS scroll snap — settle alignment owns row snapping", () => {
    // Native snap fights Windows discrete-wheel scrolling: Chromium drops
    // wheel events while a snap animation runs, so notch input kept dying
    // mid-gesture. Row alignment now happens on scroll settle instead.
    const { container } = renderContainer({ viewData: { events: [], isLoading: false } });
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
    expect(scrollEl.style.scrollSnapType).toBe("");
    const rows = container.querySelectorAll("[data-testid='calendar-week-row']");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.style.scrollSnapAlign).toBe("");
    }
  });

  describe("settle week-row alignment", () => {
    const PITCH = CELL_HEIGHT + GRID_GAP;

    it("aligns the grid to the nearest week-row start after a user scroll settles", async () => {
      const onFetchSettle = vi.fn();
      const { container } = renderContainer({ onFetchSettle });
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
      await awaitMountSettle(onFetchSettle);

      scrollEl.scrollTop = monthOffset(0) + PITCH * 2 + 37;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });

      expect(scrollEl.scrollTop).toBe(monthOffset(0) + PITCH * 2);
    });

    it("leaves programmatic-navigation settles unaligned", async () => {
      // Mount centering and explicit navigations land where they intend
      // (month starts, centered focus month); only user gestures get the
      // resting row alignment.
      const onFetchSettle = vi.fn();
      const { container } = renderContainer({ onFetchSettle });
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
      await awaitMountSettle(onFetchSettle);

      document.dispatchEvent(new CustomEvent("calendar-grid-scroll-reset"));
      const offMidRow = monthOffset(0) + PITCH * 2 + 37;
      scrollEl.scrollTop = offMidRow;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });

      expect(scrollEl.scrollTop).toBe(offMidRow);
    });

    it("treats scrolling after an alignment as user scrolling again", async () => {
      // The alignment write is marked programmatic; its settle must clear
      // that mark so the next real gesture keeps user semantics.
      const onCancelFloatingEditor = vi.fn();
      const onFetchSettle = vi.fn();
      const { container } = renderContainer({
        floatingDetailOpen: true,
        floatingDetailMode: "create",
        floatingEditorDirty: false,
        onCancelFloatingEditor,
        onFetchSettle,
      });
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
      await awaitMountSettle(onFetchSettle);

      scrollEl.scrollTop = monthOffset(0) + PITCH + 40;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });
      expect(scrollEl.scrollTop).toBe(monthOffset(0) + PITCH);
      onFetchSettle.mockClear();
      // The alignment write echoes no scroll event in jsdom; its settle still
      // runs off the explicit re-arm and must hand control back to the user.
      await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });

      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      expect(onCancelFloatingEditor).toHaveBeenCalledTimes(1);
    });
  });

  it("dispatches calendar-overflow-close on scroll", () => {
    const { container } = renderContainer();
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
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
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
    await awaitMountSettle(onFetchSettle);

    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(onCancelFloatingEditor).toHaveBeenCalledTimes(1);
  });

  it("keeps a dirty floating editor open on user scroll", async () => {
    const onCancelFloatingEditor = vi.fn();
    const onShakeFloatingEditor = vi.fn();
    const onFetchSettle = vi.fn();
    const { container } = renderContainer({
      floatingDetailOpen: true,
      floatingDetailMode: "edit",
      floatingEditorDirty: true,
      onCancelFloatingEditor,
      onShakeFloatingEditor,
      onFetchSettle,
    });
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
    await awaitMountSettle(onFetchSettle);

    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(onCancelFloatingEditor).not.toHaveBeenCalled();
    expect(onShakeFloatingEditor).not.toHaveBeenCalled();
  });

  it("does not cancel a clean floating editor on programmatic-navigation scroll events", async () => {
    const onCancelFloatingEditor = vi.fn();
    const onFetchSettle = vi.fn();
    const { container } = renderContainer({
      floatingDetailOpen: true,
      floatingDetailMode: "create",
      floatingEditorDirty: false,
      onCancelFloatingEditor,
      onFetchSettle,
    });
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
    await awaitMountSettle(onFetchSettle);

    // Programmatic navigation marks the nav active before scrolling; in a
    // real browser the smooth scroll then streams scroll events.
    document.dispatchEvent(new CustomEvent("calendar-grid-scroll-reset"));
    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(onCancelFloatingEditor).not.toHaveBeenCalled();

    // Once the navigation settles, owner scrolling cancels as before.
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
      suppressOutsideClick: false,
    };
    const { container, rerender } = render(<CalendarScrollContainer {...props} />);
    const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
    await awaitMountSettle(props.onFetchSettle);

    // User scroll crosses into the next month; the parent does not consume it.
    scrollEl.scrollTop = monthOffset(1) + 10;
    scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
    await waitFor(() => expect(props.onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });

    // Programmatic navigation three months out must still move the grid.
    rerender(<CalendarScrollContainer {...props} viewMonth={CURRENT_MONTH + 3} />);
    expect(scrollEl.scrollTop).toBe(monthOffset(3));
  });

  it("non-active months show skeleton when isMonthCached returns false", () => {
    const { container } = renderContainer({
      viewData: { events: [], isLoading: false },
      isMonthCached: () => false,
    });
    const blocks = container.querySelectorAll("[data-month-block]");
    const activeTestId = `month-block-${CURRENT_YEAR}-${CURRENT_MONTH}`;
    let skeletonCount = 0;
    for (const block of blocks) {
      if (block.dataset.testid === activeTestId) continue;
      if (block.querySelector("[data-testid='calendar-grid-skeleton']")) skeletonCount++;
    }
    expect(skeletonCount).toBe(4);
  });

  it("non-active months hide skeleton when isMonthCached returns true", () => {
    const { container } = renderContainer({
      viewData: { events: [], isLoading: false },
      isMonthCached: () => true,
    });
    const blocks = container.querySelectorAll("[data-month-block]");
    const activeTestId = `month-block-${CURRENT_YEAR}-${CURRENT_MONTH}`;
    for (const block of blocks) {
      if (block.dataset.testid === activeTestId) continue;
      expect(block.querySelector("[data-testid='calendar-grid-skeleton']")).toBeNull();
    }
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
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
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
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
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
    function ControlledContainer({ onFetchSettle }) {
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
          suppressOutsideClick={false}
        />
      );
    }

    it("still fires the fetch settle when the gesture's final event crosses a month", async () => {
      const onFetchSettle = vi.fn();
      const { container } = render(<ControlledContainer onFetchSettle={onFetchSettle} />);
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
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

    it("reports the crossed month when the settle timer beats the crossing's commit", async () => {
      // The crossing's setState commits in a separate scheduler task; under
      // CPU load that task can land after the settle timer expires, and Node
      // services expired timers before the scheduler's task. A settle that
      // fired pre-commit read the stale mounted index (reporting the origin
      // month) and left nothing for the re-arm effect, so the real settle
      // never came. Force that ordering: run the scroll's rAF synchronously
      // (states queued, uncommitted), then block the thread past the settle
      // window so the timer is due before React can commit.
      const onFetchSettle = vi.fn();
      const { container } = render(<ControlledContainer onFetchSettle={onFetchSettle} />);
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
      await awaitMountSettle(onFetchSettle);

      const rafSpy = vi.spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb) => { cb(performance.now()); return 0; });
      try {
        scrollEl.scrollTop = monthOffset(1) + 10;
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
        const blockUntil = Date.now() + SCROLL_SETTLE_MS + 30;
        while (Date.now() < blockUntil) { /* starve the event loop */ }
      } finally {
        rafSpy.mockRestore();
      }

      const next = monthIndexToDate(1, CURRENT_YEAR, CURRENT_MONTH);
      await waitFor(() => {
        expect(onFetchSettle).toHaveBeenCalledWith(
          expect.objectContaining({ year: next.year, month: next.month, scrollDriven: true }),
        );
      }, { timeout: 5000 });
    });
  });

  describe("settle scrollDriven flag", () => {
    // The controller re-targets the agenda rail on settle, but only for
    // user-driven scrolls — a settle that merely echoes a programmatic
    // navigation (T hotkey, month picker) must not read as user intent or it
    // stomps the explicit agenda command that navigation just issued.
    async function settleAfterScroll({ programmatic }) {
      const onFetchSettle = vi.fn();
      const { container } = renderContainer({ onFetchSettle });
      const scrollEl = container.querySelector("[data-testid='calendar-scroll-container']");
      await awaitMountSettle(onFetchSettle);
      const offset0 = monthOffset(0);
      if (programmatic) {
        document.dispatchEvent(new CustomEvent("calendar-grid-scroll-reset"));
      }
      scrollEl.scrollTop = offset0;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      await waitFor(() => expect(onFetchSettle).toHaveBeenCalled(), { timeout: 5000 });
      return onFetchSettle;
    }

    it("marks user-scroll settles as scrollDriven", async () => {
      const onFetchSettle = await settleAfterScroll({ programmatic: false });
      expect(onFetchSettle).toHaveBeenCalledWith(expect.objectContaining({ scrollDriven: true }));
    });

    it("marks programmatic-navigation settles as not scrollDriven", async () => {
      const onFetchSettle = await settleAfterScroll({ programmatic: true });
      expect(onFetchSettle).toHaveBeenCalledWith(expect.objectContaining({ scrollDriven: false }));
    });
  });

  it("shifts the mounted window when viewYear/viewMonth change", () => {
    const { container, rerender } = renderContainer();
    const props = {
      view: "events",
      activeView,
      layout,
      currentYear: CURRENT_YEAR,
      currentMonth: CURRENT_MONTH,
      todayDate: TODAY_DATE,
      viewYear: CURRENT_YEAR,
      viewMonth: CURRENT_MONTH + 3,
      onDisplayMonthChange: vi.fn(),
    onFetchSettle: vi.fn(),
      viewData: null,
      buildFallbackDayState,
      closeEventEditor: vi.fn(),
      setSelectedDay: vi.fn(),
      setSelectedDateKey: vi.fn(),
      setSelectedItemId: vi.fn(),
  
      suppressOutsideClick: false,
    };
    rerender(<CalendarScrollContainer {...props} />);
    const blocks = container.querySelectorAll("[data-month-block]");
    const indices = Array.from(blocks).map((el) =>
      parseInt(el.dataset.monthIndex, 10),
    );
    expect(indices).toEqual([1, 2, 3, 4, 5]);
  });
});
