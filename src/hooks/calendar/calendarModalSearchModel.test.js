import { describe, expect, it } from "vitest";
import {
  activationTargetFromCalendarSearchResult,
  calendarSearchPlaceholder,
  calendarSearchStateLabel,
  calendarSearchKeyAction,
  calendarSearchStartIndex,
  shouldShowCalendarSearchSkeleton,
  nextCalendarSearchHighlight,
  searchScopeForCalendarView,
} from "./calendarModalSearchModel.js";

describe("calendarModalSearchModel", () => {
  it("maps active calendar views to server search scopes", () => {
    expect(searchScopeForCalendarView("events")).toBe("events");
    expect(searchScopeForCalendarView("legacy")).toBe("events");
    expect(searchScopeForCalendarView("bills")).toBe("bills");
  });

  it("wraps result highlight movement", () => {
    expect(nextCalendarSearchHighlight({ currentIndex: 0, resultCount: 3, direction: 1 })).toBe(1);
    expect(nextCalendarSearchHighlight({ currentIndex: 2, resultCount: 3, direction: 1 })).toBe(0);
    expect(nextCalendarSearchHighlight({ currentIndex: 0, resultCount: 3, direction: -1 })).toBe(2);
    expect(nextCalendarSearchHighlight({ currentIndex: 4, resultCount: 0, direction: 1 })).toBe(-1);
  });

  it("resolves keyboard actions for highlight, activation, clear, and close", () => {
    expect(calendarSearchKeyAction({
      key: "ArrowDown",
      highlightedIndex: 0,
      resultCount: 2,
      query: "fi",
    })).toEqual({ type: "highlight", index: 1 });

    expect(calendarSearchKeyAction({
      key: "Enter",
      highlightedIndex: 1,
      resultCount: 2,
      query: "fi",
    })).toEqual({ type: "activate", index: 1, nextIndex: 0 });

    expect(calendarSearchKeyAction({
      key: "Enter",
      shiftKey: true,
      highlightedIndex: 1,
      resultCount: 3,
      query: "fi",
    })).toEqual({ type: "activate", index: 1, nextIndex: 0 });

    expect(calendarSearchKeyAction({
      key: "Escape",
      highlightedIndex: 0,
      resultCount: 2,
      query: "fi",
    })).toEqual({ type: "clear" });

    expect(calendarSearchKeyAction({
      key: "Escape",
      highlightedIndex: 0,
      resultCount: 2,
      query: "",
    })).toEqual({ type: "close" });
  });

  it("shapes activation targets from normalized search results", () => {
    expect(activationTargetFromCalendarSearchResult({
      type: "deadline",
      itemId: "deadline:todo-1:2026-06-01",
      itemDate: "2026-06-01",
      activation: {
        view: "events",
        detailKind: "deadline",
        dateKey: "2026-06-01",
        itemId: "deadline:todo-1:2026-06-01",
      },
    })).toEqual({
      view: "events",
      detailKind: "deadline",
      dateKey: "2026-06-01",
      itemId: "deadline:todo-1:2026-06-01",
    });
  });

  it("derives scope-specific placeholders, no-results labels, and skeleton visibility", () => {
    expect(calendarSearchPlaceholder("events")).toBe("Search events and deadlines");
    expect(calendarSearchPlaceholder("bills")).toBe("Search bills");

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "rent",
      pending: false,
      results: [],
    })).toBe("No events or deadlines found");
    expect(calendarSearchStateLabel({
      scope: "bills",
      query: "rent",
      pending: false,
      results: [],
    })).toBe("No bills found");

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "rent",
      pending: true,
      results: [],
    })).toBe("Searching");
    expect(calendarSearchStateLabel({
      scope: "events",
      query: "rent",
      pending: true,
      results: [{ id: "event:1" }],
    })).toBe("Updating");

    expect(shouldShowCalendarSearchSkeleton({
      query: "rent",
      pending: true,
      results: [],
    })).toBe(true);
    expect(shouldShowCalendarSearchSkeleton({
      query: "rent",
      pending: true,
      results: [{ id: "event:1" }],
    })).toBe(false);
    expect(shouldShowCalendarSearchSkeleton({
      query: "",
      pending: true,
      results: [],
    })).toBe(false);
  });

  it("distinguishes Google event mirror freshness from true no-match states", () => {
    const initializingCoverage = {
      sources: [
        {
          key: "google_calendar",
          searched: false,
          syncHealth: { state: "initializing" },
        },
        {
          key: "deadlines",
          searched: true,
        },
      ],
    };

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "final",
      coverage: initializingCoverage,
      results: [],
    })).toBe("Calendar events indexing");

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "final",
      coverage: initializingCoverage,
      results: [{ id: "deadline:1", type: "deadline" }],
    })).toBe("Partial results: deadlines only");

    const staleCoverage = {
      sources: [
        {
          key: "google_calendar",
          searched: true,
          syncHealth: { state: "stale", lastError: "raw provider failure" },
        },
        {
          key: "deadlines",
          searched: true,
        },
      ],
    };

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "final",
      coverage: staleCoverage,
      results: [{ id: "event:1", type: "event" }],
    })).toBe("Showing available results");

    expect(calendarSearchStateLabel({
      scope: "events",
      query: "final",
      coverage: staleCoverage,
      results: [],
    })).toBe("No matches in available results");
  });

  it("starts search selection on the closest upcoming result or most recent past result", () => {
    const results = [
      { id: "old", itemDate: "2025-11-01" },
      { id: "tomorrow-later", itemDate: "2026-05-13" },
      { id: "today", itemDate: "2026-05-12" },
      { id: "tomorrow", itemDate: "2026-05-13" },
    ];

    expect(calendarSearchStartIndex(results, "2026-05-12")).toBe(2);
    expect(calendarSearchStartIndex(results, "2026-05-13")).toBe(1);
    expect(calendarSearchStartIndex(results, "2027-01-01")).toBe(3);
  });

  it("skips hidden results for keyboard activation and initial selection", () => {
    const results = [
      { id: "hidden-today", itemDate: "2026-05-12", hidden: true },
      { id: "visible-tomorrow", itemDate: "2026-05-13" },
      { id: "hidden-future", itemDate: "2026-05-14", activation: { visible: false } },
    ];

    expect(calendarSearchStartIndex(results, "2026-05-12")).toBe(1);
    expect(calendarSearchKeyAction({
      key: "Enter",
      highlightedIndex: 0,
      resultCount: results.length,
      results,
      query: "work",
    })).toEqual({ type: "activate", index: 1, nextIndex: 1 });
  });
});
