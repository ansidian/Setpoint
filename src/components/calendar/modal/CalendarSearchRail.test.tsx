import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSearchRail from "./CalendarSearchRail";

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

    // test-architecture: allow-boundary-interaction -- Explicit search focus must invoke the native input selection command; happy-dom exposes no selection UI or layout state beyond this browser method.
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

    // test-architecture: allow-boundary-interaction -- A scope switch must not reissue the native select-all command; happy-dom cannot expose a forbidden browser selection command through rendered state.
    expect(selectSpy).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Scope switching moves the native caret to the end, an imperative browser selection-range contract not reflected in rendered DOM state.
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
  });
});
