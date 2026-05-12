import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSearchRail from "./CalendarSearchRail.jsx";

function makeSearch(overrides = {}) {
  return {
    open: true,
    query: "",
    setQuery: vi.fn(),
    clearQuery: vi.fn(),
    closeSearch: vi.fn(),
    focusRequestId: 1,
    focusSelectAll: true,
    scope: "events",
    results: [],
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
    activateDateHeader: vi.fn(),
    selectedDateKey: null,
    selectedItemId: null,
    ...overrides,
  };
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
          id: "deadline:1",
          type: "deadline",
          itemId: "todo-1",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Todoist",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: 0,
      selectedDateKey: "2026-05-20",
      selectedItemId: "todo-1",
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.textContent).toContain("Final project");
    expect(row.textContent).toContain("CS 4220");
    expect(row.textContent).not.toContain("Todoist");
    expect(row.getAttribute("data-source-color")).toBe("#e44332");
    expect(row.getAttribute("data-highlighted")).toBe("true");
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(row.style.border).toContain("rgba(228, 67, 50, 0.75)");
    expect(row.style.background).toContain("rgba(228, 67, 50, 0.18)");
  });

  it("matches deadline rows against source-qualified selection ids from floating detail", () => {
    const baseSearch = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:todoist:todo-1:2026-05-20",
          type: "deadline",
          itemId: "todo-1",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Todoist",
          sourceColor: "#e44332",
          payload: { id: "todo-1", source: "todoist" },
          activation: {
            view: "events",
            detailView: "deadlines",
            dateKey: "2026-05-20",
            itemId: "todo-1",
          },
        },
      ],
      selectedDateKey: "2026-05-20",
      selectedItemId: "todoist:todo-1",
    });
    const { rerender } = render(<CalendarSearchRail search={baseSearch} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-result-row").getAttribute("data-selected")).toBe("true");

    rerender(
      <CalendarSearchRail
        search={{
          ...baseSearch,
          selectedItemId: "todoist:todo-1-2026-05-20",
        }}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-result-row").getAttribute("data-selected")).toBe("true");
  });

  it("does not use the keyboard highlight as the selected color state", () => {
    const search = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:1",
          type: "deadline",
          itemId: "todo-1",
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
    expect(row.style.border).toBe("1px solid rgba(255, 255, 255, 0.055)");
    expect(row.style.background).toBe("rgba(255, 255, 255, 0.025)");
  });

  it("uses agenda row hover without promoting hover to the selected color state", () => {
    const search = makeSearch({
      query: "final",
      results: [
        {
          id: "deadline:1",
          type: "deadline",
          itemId: "todo-1",
          itemDate: "2026-05-20",
          title: "Final project",
          subtitle: "CS 4220",
          sourceLabel: "Todoist",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: -1,
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    const row = screen.getByTestId("calendar-search-result-row");
    expect(row.style.background).toBe("rgba(255, 255, 255, 0.025)");
    expect(row.style.transition).toBe(
      "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
    );

    fireEvent.mouseEnter(row);

    expect(search.setHighlightedIndex).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateY(-1px)");
    expect(row.style.borderColor).toBe("rgba(255, 255, 255, 0.12)");
    expect(row.style.background).toBe("rgba(255, 255, 255, 0.025)");

    fireEvent.mouseLeave(row);

    expect(row.style.transform).toBe("translateY(0)");
    expect(row.style.borderColor).toBe("rgba(255, 255, 255, 0.055)");
  });

  it("keeps old results visible while pending", () => {
    const search = makeSearch({
      query: "final",
      pending: true,
      results: [
        {
          id: "event:1",
          type: "event",
          itemId: "event-1",
          itemDate: "2026-05-21",
          title: "Final review",
          sourceLabel: "School",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-state").textContent).toBe("Updating");
    expect(screen.getByText("Final review")).toBeTruthy();
    expect(screen.queryByTestId("calendar-search-skeleton")).toBeNull();
  });

  it("uses scope-specific placeholders and no-results labels", () => {
    const { rerender } = render(<CalendarSearchRail search={makeSearch()} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-input").getAttribute("placeholder")).toBe("Search events and deadlines");

    rerender(
      <CalendarSearchRail
        search={makeSearch({
          scope: "bills",
          query: "rent",
          results: [],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-input").getAttribute("placeholder")).toBe("Search bills");
    expect(screen.getByTestId("calendar-search-state").textContent).toBe("No bills found");
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

  it("labels stale or degraded mirror results as available results", () => {
    render(
      <CalendarSearchRail
        search={makeSearch({
          query: "rent",
          coverage: {
            sources: [
              {
                key: "google_calendar",
                searched: true,
                syncHealth: {
                  state: "degraded",
                  lastError: "raw Google quota body",
                },
              },
              { key: "deadlines", searched: true },
            ],
          },
          results: [
            {
              id: "event:1",
              type: "event",
              itemId: "event-1",
              itemDate: "2026-05-20",
              title: "Rent review",
              sourceColor: "#4285f4",
            },
          ],
        })}
        layoutMode="three-rail"
      />,
    );

    expect(screen.getByTestId("calendar-search-state").textContent).toBe("Showing available results");
    expect(screen.queryByText(/quota|Google/i)).toBeNull();
    expect(screen.getByText("Rent review")).toBeTruthy();
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

  it("opens highlighted rows from Enter through the grid-chip activation path and skips hidden results", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 0,
      isResultNavigable: (result) => result.itemId !== "hidden",
      results: [
        {
          id: "event:hidden",
          type: "event",
          itemId: "hidden",
          itemDate: "2026-05-12",
          title: "Hidden event",
          sourceColor: "#4285f4",
          hidden: true,
        },
        {
          id: "event:visible",
          type: "event",
          itemId: "visible",
          itemDate: "2026-05-13",
          title: "Visible event",
          sourceColor: "#4285f4",
        },
      ],
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    fireEvent.keyDown(screen.getByTestId("calendar-search-input"), { key: "Enter" });

    expect(search.activateResult).toHaveBeenCalledWith(
      search.results[1],
      expect.objectContaining({
        anchorKind: "grid-chip",
      }),
    );
    expect(search.setHighlightedIndex).toHaveBeenCalledWith(1);
    expect(search.handleInputKeyDown).not.toHaveBeenCalled();
  });

  it("uses the search row activation context for keyboard results hidden in grid overflow", () => {
    const search = makeSearch({
      query: "work",
      highlightedIndex: 0,
      getResultActivationContext: (_result, _index, fallbackContext) => ({
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
    const previousRow = screen.getAllByTestId("calendar-search-result-row")[0];
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 320 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 160, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => ({ top: 100, bottom: 220, height: 120 }));
    previousRow.getBoundingClientRect = vi.fn(() => ({ top: 20, bottom: 78, height: 58 }));
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
    const lastRow = screen.getAllByTestId("calendar-search-result-row")[1];
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 320 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 40, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => ({ top: 100, bottom: 220, height: 120 }));
    lastRow.getBoundingClientRect = vi.fn(() => ({ top: 242, bottom: 300, height: 58 }));
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
          itemId: "deadline-future",
          itemDate: "2026-05-14",
          title: "Project review",
          subtitle: "CS 4220",
          sourceLabel: "Todoist",
          sourceColor: "#e44332",
        },
      ],
      highlightedIndex: 1,
    });

    render(<CalendarSearchRail search={search} layoutMode="three-rail" />);

    expect(screen.getByTestId("calendar-search-results").getAttribute("data-calendar-local-scroll")).toBe("true");
    expect(screen.getByText("SUNDAY 5/10/26")).toBeTruthy();
    expect(screen.getByText("THURSDAY 5/14/26")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-search-date-header")[0].style.background).toBe("rgb(31, 31, 36)");
    expect(screen.getByText("Conference Room B")).toBeTruthy();
    expect(screen.getByText("CS 4220")).toBeTruthy();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.queryByText("Todoist")).toBeNull();

    const rows = screen.getAllByTestId("calendar-search-result-row");
    expect(rows[0].getAttribute("data-past")).toBe("true");
    expect(rows[0].getAttribute("data-source-color")).toBe("#d50000");
    expect(rows[1].getAttribute("data-past")).toBe("false");

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
    expect(todayHeader.style.color).toBe("rgb(4, 149, 255)");

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
    const targetHeader = screen.getAllByTestId("calendar-search-date-header")[1];
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => ({ top: 100, bottom: 400, height: 300 }));
    targetHeader.getBoundingClientRect = vi.fn(() => ({ top: 760, bottom: 794, height: 34 }));
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
    const targetHeader = screen.getAllByTestId("calendar-search-date-header")[1];
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    scroller.getBoundingClientRect = vi.fn(() => ({ top: 100, bottom: 400, height: 300 }));
    targetHeader.getBoundingClientRect = vi.fn(() => ({ top: 560, bottom: 594, height: 34 }));
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
