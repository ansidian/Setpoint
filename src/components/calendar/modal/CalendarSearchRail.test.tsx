import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSearchRail from "./CalendarSearchRail";
import type { CalendarSearchResultLike } from "../../../hooks/calendar/calendarModalSearchModel";
import type { CalendarSearchActivationContext } from "../../../hooks/calendar/useCalendarModalSearch";

function makeSearch(overrides = {}) {
  return {
    open: true,
    query: "",
    setQuery: vi.fn(),
    clearQuery: vi.fn(),
    closeSearch: vi.fn(),
    cancelSearch: vi.fn(() => false),
    openSearch: vi.fn(),
    focusRequestId: 1,
    focusSelectAll: true,
    scope: "events" as const,
    results: [],
    setImmediateResults: vi.fn(),
    pending: false,
    error: null,
    highlightedIndex: -1,
    setHighlightedIndex: vi.fn(),
    scrollTop: 0,
    setScrollTop: vi.fn(),
    autoCenterResults: true,
    markResultsAutoCentered: vi.fn(),
    truncated: false,
    coverage: null,
    handleInputKeyDown: vi.fn(),
    activateResult: vi.fn(),
    activateHighlighted: vi.fn(),
    activateDateHeader: vi.fn(),
    selectedDateKey: null,
    selectedItemId: null,
    ...overrides,
  };
}

function testRect(top: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: 0, y: top, width: 100, height });
}

function installRafTimer() {
  const requestSpy = vi.spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 0));
  const cancelSpy = vi.spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id) => window.clearTimeout(id));
  return () => {
    requestSpy.mockRestore();
    cancelSpy.mockRestore();
  };
}

describe("CalendarSearchRail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders compact result rows with hollow source dots and selected source-color state", () => {
    const search = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:todo-1:2026-05-20",
          type: "deadline",
          itemId: "deadline:todo-1:2026-05-20",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Deadline",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: 0,
      selectedDateKey: "2026-05-20",
      selectedItemId: "deadline:todo-1:2026-05-20",
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.textContent).toContain("Final project");
    expect(row.textContent).toContain("CS 4220");
    expect(row.textContent).not.toContain("Todoist");
    expect(row.getAttribute("data-source-color")).toBe("#e44332");
    expect(row.getAttribute("data-highlighted")).toBe("true");
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(row.getAttribute("data-visual-state")).toBe("selected");
    expect(row.querySelector("[data-calendar-search-source-dot='true']")?.getAttribute("data-source-color")).toBe("#e44332");
  });

  it("renders birthday search results as special-date markers without all-day metadata", () => {
    const search = makeSearch({
      query: "birthday",
      results: [
        {
          id: "event:birthday-1",
          type: "event",
          itemId: "birthday-1",
          itemDate: "2026-05-22",
          title: "Maya's birthday",
          subtitle: "All day · All day",
          sourceLabel: "Birthdays",
          sourceColor: "#ff887c",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(row.textContent).toContain("Maya's birthday");
    expect(row.textContent).not.toMatch(/all.day/i);
    expect(row.getAttribute("data-source-color")).toBe("#ff887c");
  });

  it("matches deadline rows against stable occurrence selection ids from floating detail", () => {
    const baseSearch = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:todo-1:2026-05-20",
          type: "deadline",
          itemId: "deadline:todo-1:2026-05-20",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Deadline",
          sourceColor: "#e44332",
          payload: { id: "todo-1" },
          activation: {
            view: "events",
            detailKind: "deadline",
            dateKey: "2026-05-20",
            itemId: "deadline:todo-1:2026-05-20",
          },
        },
      ],
      selectedDateKey: "2026-05-20",
      selectedItemId: "deadline:todo-1:2026-05-20",
    });
    const { rerender } = render(<CalendarSearchRail search={baseSearch} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-result-row").getAttribute("data-selected")).toBe("true");

    rerender(
      <CalendarSearchRail
        search={{
          ...baseSearch,
          selectedItemId: "deadline:todo-1:2026-05-21",
        }}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-result-row").getAttribute("data-selected")).toBe("false");
  });

  it("does not use the keyboard highlight as the selected color state", () => {
    const search = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:todo-1:2026-05-20",
          type: "deadline",
          itemId: "deadline:todo-1:2026-05-20",
          itemDate: "2026-05-20",
          title: "Final project",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: 0,
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.getAttribute("data-highlighted")).toBe("true");
    expect(row.getAttribute("data-selected")).toBe("false");
    expect(row.getAttribute("data-visual-state")).toBe("highlighted");
  });

  it("keeps pointer hover separate from selected and highlighted state", () => {
    const search = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:todo-1:2026-05-20",
          type: "deadline",
          itemId: "deadline:todo-1:2026-05-20",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Deadline",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: -1,
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.getAttribute("data-visual-state")).toBe("idle");

    fireEvent.mouseEnter(row);

    expect(search.setHighlightedIndex).not.toHaveBeenCalled();
    expect(row.getAttribute("data-highlighted")).toBe("false");
    expect(row.getAttribute("data-selected")).toBe("false");
    expect(row.getAttribute("data-visual-state")).toBe("idle");

    fireEvent.mouseLeave(row);

    expect(row.getAttribute("data-visual-state")).toBe("idle");
  });

  it("shows initializing and partial coverage states without raw sync details", () => {
    const initializingCoverage = {
      sources: [
        {
          key: "google_calendar",
          searched: false,
          syncHealth: {
            state: "initializing",
            lastError: "calendar_search_occurrences token failed",
          },
        },
        { key: "deadlines", searched: true },
      ],
    };
    const { rerender } = render(
      <CalendarSearchRail
        search={makeSearch({
          query: "final",
          coverage: initializingCoverage,
          results: [],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-state").textContent).toBe("Calendar events indexing");
    expect(screen.queryByText(/calendar_search_occurrences|token/i)).toBeNull();

    rerender(
      <CalendarSearchRail
        search={makeSearch({
          query: "final",
          coverage: initializingCoverage,
          results: [
            {
              id: "deadline:1",
              type: "deadline",
              itemId: "deadline-1",
              itemDate: "2026-05-20",
              title: "Final project",
              sourceColor: "#e44332",
            },
          ],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-state").textContent).toBe("Partial results: deadlines only");
    expect(screen.getByText("Final project")).toBeTruthy();
  });

  it("shows stable skeleton rows only while pending without visible results", () => {
    const { rerender } = render(
      <CalendarSearchRail
        search={makeSearch({
          query: "final",
          pending: true,
          results: [],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-state").textContent).toBe("Searching");
    expect(screen.getByTestId("calendar-search-results").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("calendar-search-skeleton")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-search-skeleton-row")).toHaveLength(6);

    rerender(
      <CalendarSearchRail
        search={makeSearch({
          query: "",
          pending: true,
          results: [],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.queryByTestId("calendar-search-skeleton")).toBeNull();
  });

  it("routes input keys, clear, close, and row activation through search props", () => {
    const search = makeSearch({
      query: "bill",
      results: [
        {
          id: "bill:1",
          type: "bill",
          itemId: "bill-1",
          itemDate: "2026-05-22",
          title: "Rent",
          sourceLabel: "Bills",
          sourceColor: "#22c55e",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="search-replaces-agenda" />);

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "ArrowDown" });
    expect(search.handleInputKeyDown).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search.clearQuery).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(search.closeSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("calendar-search-result-row"));
    expect(search.activateResult).toHaveBeenCalledWith(
      search.results[0],
      expect.objectContaining({
        anchorElement: screen.getByTestId("calendar-search-result-row"),
        sourceCellElement: screen.getByTestId("calendar-search-result-row"),
        anchorKind: "search-result-row",
      }),
    );
  });

  it("uses the search row activation context for keyboard results hidden in grid overflow", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 0,
      getResultActivationContext: (
        _result: CalendarSearchResultLike,
        _index: number,
        fallbackContext: CalendarSearchActivationContext,
      ) => ({
        ...fallbackContext,
        anchorKind: "search-result-row",
      }),
      results: [
        {
          id: "event:overflow",
          type: "event",
          itemId: "overflow",
          itemDate: "2026-05-12",
          title: "Overflow event",
          sourceColor: "#4285f4",
        },
        {
          id: "event:next",
          type: "event",
          itemId: "next",
          itemDate: "2026-05-13",
          title: "Next event",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);
    const row = screen.getAllByTestId("calendar-search-result-row")[0];

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "Enter" });

    expect(search.activateResult).toHaveBeenCalledWith(
      search.results[0],
      expect.objectContaining({
        anchorElement: row,
        sourceCellElement: row,
        anchorKind: "search-result-row",
      }),
    );
    expect(search.setHighlightedIndex).toHaveBeenCalledWith(1);
  });

  it("uses Shift+Enter to open the previous navigable row", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 1,
      results: [
        {
          id: "event:previous",
          type: "event",
          itemId: "previous",
          itemDate: "2026-05-12",
          title: "Previous event",
          sourceColor: "#4285f4",
        },
        {
          id: "event:current",
          type: "event",
          itemId: "current",
          itemDate: "2026-05-13",
          title: "Current event",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "Enter", shiftKey: true });

    expect(search.activateResult).toHaveBeenCalledWith(
      search.results[1],
      expect.objectContaining({
        anchorKind: "grid-chip",
      }),
    );
    expect(search.setHighlightedIndex).toHaveBeenCalledWith(0);
  });

  it("scrolls the search rail to follow the row activated by Shift+Enter", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 0,
      results: [
        {
          id: "event:previous",
          type: "event",
          itemId: "previous",
          itemDate: "2026-05-12",
          title: "Previous event",
          sourceColor: "#4285f4",
        },
        {
          id: "event:current",
          type: "event",
          itemId: "current",
          itemDate: "2026-05-13",
          title: "Current event",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);
    const scroller = screen.getByTestId("calendar-search-results");
    const previousRow = screen.getAllByTestId("calendar-search-result-row")[0]!;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 320 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 160, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => testRect(100, 120));
    previousRow.getBoundingClientRect = vi.fn(() => testRect(20, 58));
    scroller.scrollTo = scrollTo;

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "Enter", shiftKey: true });

    expect(search.setHighlightedIndex).toHaveBeenCalledWith(1);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 36,
      behavior: "smooth",
    });
    expect(search.setScrollTop).toHaveBeenCalledWith(36);
  });

  it("keeps the activated last search result clear of the rail bottom edge when the queued highlight wraps", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 1,
      results: [
        {
          id: "event:first",
          type: "event",
          itemId: "first",
          itemDate: "2026-05-12",
          title: "First event",
          sourceColor: "#4285f4",
        },
        {
          id: "event:last",
          type: "event",
          itemId: "last",
          itemDate: "2026-05-13",
          title: "Last event",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);
    const scroller = screen.getByTestId("calendar-search-results");
    const lastRow = screen.getAllByTestId("calendar-search-result-row")[1]!;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 320 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 40, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => testRect(100, 120));
    lastRow.getBoundingClientRect = vi.fn(() => testRect(242, 58));
    scroller.scrollTo = scrollTo;

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "Enter" });

    expect(search.setHighlightedIndex).toHaveBeenCalledWith(0);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 164,
      behavior: "smooth",
    });
    expect(search.setScrollTop).toHaveBeenCalledWith(164);
  });

  it("pivots from the last opened row when switching from backward to forward activation", () => {
    const results = [
      {
        id: "event:previous",
        type: "event",
        itemId: "previous",
        itemDate: "2026-05-12",
        title: "Previous event",
        sourceColor: "#4285f4",
      },
      {
        id: "event:current",
        type: "event",
        itemId: "current",
        itemDate: "2026-05-13",
        title: "Current event",
        sourceColor: "#4285f4",
      },
      {
        id: "event:next",
        type: "event",
        itemId: "next",
        itemDate: "2026-05-14",
        title: "Next event",
        sourceColor: "#4285f4",
      },
    ];
    const search = makeSearch({ query: "work", highlightedIndex: 1, results });
    const { rerender } = render(<CalendarSearchRail search={search} layoutMode="three-rail" />);
    const input = screen.getByTestId("calendar-search-input");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(search.activateResult).toHaveBeenLastCalledWith(
      results[1],
      expect.objectContaining({ anchorKind: "grid-chip" }),
    );
    expect(search.setHighlightedIndex).toHaveBeenLastCalledWith(0);

    rerender(<CalendarSearchRail search={{ ...search, highlightedIndex: 0 }} layoutMode="three-rail" />);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(search.activateResult).toHaveBeenLastCalledWith(
      results[2],
      expect.objectContaining({ anchorKind: "grid-chip" }),
    );
    expect(search.setHighlightedIndex).toHaveBeenLastCalledWith(0);
  });

  it("pivots from the last opened row when switching from forward to backward activation", () => {
    const results = [
      {
        id: "event:previous",
        type: "event",
        itemId: "previous",
        itemDate: "2026-05-12",
        title: "Previous event",
        sourceColor: "#4285f4",
      },
      {
        id: "event:current",
        type: "event",
        itemId: "current",
        itemDate: "2026-05-13",
        title: "Current event",
        sourceColor: "#4285f4",
      },
      {
        id: "event:next",
        type: "event",
        itemId: "next",
        itemDate: "2026-05-14",
        title: "Next event",
        sourceColor: "#4285f4",
      },
    ];
    const search = makeSearch({ query: "work", highlightedIndex: 1, results });
    const { rerender } = render(<CalendarSearchRail search={search} layoutMode="three-rail" />);
    const input = screen.getByTestId("calendar-search-input");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(search.activateResult).toHaveBeenLastCalledWith(
      results[1],
      expect.objectContaining({ anchorKind: "grid-chip" }),
    );
    expect(search.setHighlightedIndex).toHaveBeenLastCalledWith(2);

    rerender(<CalendarSearchRail search={{ ...search, highlightedIndex: 2 }} layoutMode="three-rail" />);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(search.activateResult).toHaveBeenLastCalledWith(
      results[0],
      expect.objectContaining({ anchorKind: "grid-chip" }),
    );
    expect(search.setHighlightedIndex).toHaveBeenLastCalledWith(2);
  });

  it("selects all on explicit search focus but only moves caret on scope switches", () => {
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    const setSelectionRangeSpy = vi.spyOn(HTMLInputElement.prototype, "setSelectionRange");
    const { rerender } = render(
      <CalendarSearchRail
        search={makeSearch({
          scope: "events",
          query: "final",
          focusRequestId: 1,
          focusSelectAll: true,
        })}
        layoutMode="three-rail"
      />,
    );

    expect(selectSpy).toHaveBeenCalledTimes(1);

    rerender(
      <CalendarSearchRail
        search={makeSearch({
          scope: "bills",
          query: "rent",
          focusRequestId: 1,
          focusSelectAll: true,
        })}
        layoutMode="three-rail"
      />,
    );

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(setSelectionRangeSpy).toHaveBeenCalledWith(4, 4);
  });

  it("groups results by agenda-style date headers, dims past rows, and shows detail instead of source text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    const search = makeSearch({
      query: "review",
      results: [
        {
          id: "event:past",
          type: "event",
          itemId: "event-past",
          itemDate: "2026-05-10",
          title: "Very long review title that should wrap across two lines instead of truncating",
          subtitle: "10:00 AM · 1h",
          location: "Conference Room B",
          sourceLabel: "Personal",
          sourceColor: "#d50000",
        },
        {
          id: "deadline:future",
          type: "deadline",
          itemId: "deadline:deadline-future:2026-05-14",
          itemDate: "2026-05-14",
          title: "Project review",
          subtitle: "CS 4220",
          sourceLabel: "Deadline",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: 1,
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-results").getAttribute("data-calendar-local-scroll")).toBe("true");
    expect(screen.getByText("SUNDAY 5/10/26")).toBeTruthy();
    expect(screen.getByText("THURSDAY 5/14/26")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-search-date-header")[0]!.getAttribute("data-date-tone")).toBe("normal");
    expect(screen.getByText("Conference Room B")).toBeTruthy();
    expect(screen.getByText("CS 4220")).toBeTruthy();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.queryByText("Todoist")).toBeNull();

    const rows = screen.getAllByTestId("calendar-search-result-row");
    expect(rows[0]!.getAttribute("data-past")).toBe("true");
    expect(rows[0]!.getAttribute("data-source-color")).toBe("#d50000");
    expect(rows[1]!.getAttribute("data-past")).toBe("false");

    const title = screen.getByText("Very long review title that should wrap across two lines instead of truncating");
    expect(title.getAttribute("data-title-wrap")).toBe("two-lines");
  });

  it("mirrors agenda date headers with relative labels, today color, weather, and activation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T19:00:00.000Z"));
    const search = makeSearch({
      query: "work",
      results: [
        {
          id: "event:yesterday",
          type: "event",
          itemId: "event-yesterday",
          itemDate: "2026-05-10",
          title: "Work",
          sourceColor: "#4285f4",
        },
        {
          id: "event:today",
          type: "event",
          itemId: "event-today",
          itemDate: "2026-05-11",
          title: "Work",
          sourceColor: "#4285f4",
        },
        {
          id: "event:tomorrow",
          type: "event",
          itemId: "event-tomorrow",
          itemDate: "2026-05-12",
          title: "Work",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(
      <CalendarSearchRail
        search={search}
        layoutMode="three-rail"
        weatherData={{
          high: 89,
          low: 60,
          icon: "Sun",
          summary: "Sunny",
          dailyForecast: [
            { dateKey: "2026-05-12", high: 76, low: 58, icon: "CloudSun", summary: "Partly cloudy" },
          ],
        }}
      />,
    );

    expect(screen.getByText("YESTERDAY 5/10/26")).toBeTruthy();
    expect(screen.getByText("TODAY 5/11/26")).toBeTruthy();
    expect(screen.getByText("TOMORROW 5/12/26")).toBeTruthy();
    expect(screen.getByText("89°/60°")).toBeTruthy();
    expect(screen.getByText("76°/58°")).toBeTruthy();

    const todayHeader = screen.getByRole("button", { name: "Select today 5/11/26" });
    expect(todayHeader.getAttribute("data-date-tone")).toBe("today");

    fireEvent.keyDown(todayHeader, { key: "Enter" });
    expect(search.activateDateHeader).toHaveBeenCalledWith("2026-05-11");
    expect(search.setHighlightedIndex).toHaveBeenCalledWith(1);
  });

  it("centers completed search results around today instead of starting at the oldest match", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    const restoreRaf = installRafTimer();
    const search = makeSearch({
      open: true,
      query: "work",
      pending: false,
      results: [
        {
          id: "event:old",
          type: "event",
          itemId: "old",
          itemDate: "2021-06-20",
          title: "Work",
          sourceColor: "#4285f4",
        },
        {
          id: "event:next",
          type: "event",
          itemId: "next",
          itemDate: "2026-05-13",
          title: "Work",
          sourceColor: "#4285f4",
        },
        {
          id: "event:future",
          type: "event",
          itemId: "future",
          itemDate: "2030-06-15",
          title: "Work",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const scroller = screen.getByTestId("calendar-search-results");
    const targetHeader = screen.getAllByTestId("calendar-search-date-header")[1]!;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => testRect(100, 300));
    targetHeader.getBoundingClientRect = vi.fn(() => testRect(760, 34));
    scroller.scrollTo = scrollTo;

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 527,
      behavior: "auto",
    });
    expect(search.setScrollTop).toHaveBeenCalledWith(527);
    expect(search.markResultsAutoCentered).toHaveBeenCalled();
    restoreRaf();
  });

  it("centers completed search results on the most recent result when every match is past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    const restoreRaf = installRafTimer();
    const search = makeSearch({
      open: true,
      query: "work",
      pending: false,
      results: [
        {
          id: "event:old",
          type: "event",
          itemId: "old",
          itemDate: "2021-06-20",
          title: "Work",
          sourceColor: "#4285f4",
        },
        {
          id: "event:recent",
          type: "event",
          itemId: "recent",
          itemDate: "2026-05-11",
          title: "Work",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const scroller = screen.getByTestId("calendar-search-results");
    const targetHeader = screen.getAllByTestId("calendar-search-date-header")[1]!;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => testRect(100, 300));
    targetHeader.getBoundingClientRect = vi.fn(() => testRect(560, 34));
    scroller.scrollTo = scrollTo;

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 327,
      behavior: "auto",
    });
    expect(search.setScrollTop).toHaveBeenCalledWith(327);
    restoreRaf();
  });

  it("restores and reports result scroll position when auto-centering is disabled", () => {
    const search = makeSearch({
      query: "work",
      scrollTop: 84,
      autoCenterResults: false,
      results: [
        {
          id: "event:1",
          type: "event",
          itemId: "event-1",
          itemDate: "2026-05-12",
          title: "Work",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const scroller = screen.getByTestId("calendar-search-results");
    expect(scroller.scrollTop).toBe(84);

    fireEvent.scroll(scroller, { target: { scrollTop: 120 } });
    expect(search.setScrollTop).toHaveBeenCalledWith(120);
  });
});
