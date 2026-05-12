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
    expect(searchScopeForCalendarView("deadlines")).toBe("events");
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
      itemId: "todo-1",
      itemDate: "2026-06-01",
      activation: {
        view: "events",
        detailView: "deadlines",
        dateKey: "2026-06-01",
        itemId: "todo-1",
      },
    })).toEqual({
      view: "events",
      detailView: "deadlines",
      dateKey: "2026-06-01",
      itemId: "todo-1",
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
