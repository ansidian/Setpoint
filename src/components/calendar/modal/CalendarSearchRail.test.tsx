import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("CalendarSearchRail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
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

  it("activates the visibly highlighted row when switching activation direction", () => {
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
      results[0],
      expect.objectContaining({ anchorKind: "grid-chip" }),
    );
    expect(search.setHighlightedIndex).toHaveBeenLastCalledWith(1);
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
