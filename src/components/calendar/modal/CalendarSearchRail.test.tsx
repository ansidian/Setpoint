import { cleanup, render, screen } from "@testing-library/react";
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

});
