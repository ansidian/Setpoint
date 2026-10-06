import { cleanup, render } from "@testing-library/react";
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

  it("selects all on explicit search focus", () => {
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    render(
      <CalendarSearchRail
        search={makeSearch({
          query: "final",
          focusRequestId: 1,
          focusSelectAll: true,
        })}
        layoutMode="three-rail"
      />,
    );

    // test-architecture: allow-boundary-interaction -- Explicit search focus must invoke the native input selection command; happy-dom exposes no selection UI or layout state beyond this browser method.
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

});
