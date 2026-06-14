import { describe, expect, it } from "vitest";
import {
  addMonthOffset,
  dedupeEvents,
  deadlineOverlayRecordData,
  findItemLocation,
  hasDeadlineItemsInRange,
  itemDueDate,
  itemFromCalendarSearchResult,
  itemMatchesViewId,
  makeDeadlineOverlayRecord,
  rangeMatches,
  resolvePendingFocusItem,
} from "./calendarControllerHelpers.js";

const eventsView = {
  getItemId: (item) => item?.id,
  matchesItemId: (item, id) => String(item?.id) === String(id),
};

describe("calendarControllerHelpers", () => {
  it("addMonthOffset wraps year boundaries", () => {
    expect(addMonthOffset(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonthOffset(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonthOffset(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });

  it("dedupeEvents drops duplicates by id + originalStartTime, preserving order", () => {
    const a = { id: "1" };
    const b = { id: "1", originalStartTime: "x" };
    const c = { id: "2" };
    const result = dedupeEvents([a, { id: "1" }, b, c, b]);
    expect(result).toEqual([a, b, c]);
  });

  it("rangeMatches compares start/end pairs", () => {
    expect(rangeMatches({ start: "a", end: "b" }, { start: "a", end: "b" })).toBe(true);
    expect(rangeMatches({ start: "a", end: "b" }, { start: "a", end: "c" })).toBe(false);
    expect(rangeMatches(null, { start: "a", end: "b" })).toBe(false);
  });

  it("makeDeadlineOverlayRecord / deadlineOverlayRecordData gate on visible range", () => {
    const range = { start: "2026-06-01", end: "2026-06-30" };
    const record = makeDeadlineOverlayRecord({ items: [] }, range);
    expect(record).toEqual({ data: { items: [] }, range });
    expect(deadlineOverlayRecordData(record, range)).toEqual({ items: [] });
    expect(deadlineOverlayRecordData(record, { start: "2026-07-01", end: "2026-07-31" })).toBeNull();
    expect(makeDeadlineOverlayRecord(null, range)).toBeNull();
  });

  it("hasDeadlineItemsInRange detects in-window deadlines", () => {
    const data = { upcoming: [{ due_date: "2026-06-15" }, { due_date: "2026-07-20" }] };
    expect(hasDeadlineItemsInRange(data, { start: "2026-06-01", end: "2026-06-30" })).toBe(true);
    expect(hasDeadlineItemsInRange(data, { start: "2026-08-01", end: "2026-08-31" })).toBe(false);
  });

  it("itemDueDate prefers agendaDateKey then due_date then next_date", () => {
    expect(itemDueDate({ agendaDateKey: "a", due_date: "b" })).toBe("a");
    expect(itemDueDate({ due_date: "b", next_date: "c" })).toBe("b");
    expect(itemDueDate({ next_date: "c" })).toBe("c");
    expect(itemDueDate({})).toBeNull();
  });

  it("itemMatchesViewId matches via view matcher or raw id", () => {
    expect(itemMatchesViewId(eventsView, { id: "7" }, "7")).toBe(true);
    expect(itemMatchesViewId(eventsView, { id: "7" }, 7)).toBe(true);
    expect(itemMatchesViewId(eventsView, { id: "7" }, "8")).toBe(false);
    expect(itemMatchesViewId(eventsView, null, "7")).toBe(false);
  });

  it("findItemLocation prefers the preferred date key then scans all", () => {
    const computed = {
      itemsByDate: {
        "2026-06-10": [{ id: "a" }],
        "2026-06-11": [{ id: "b" }],
      },
    };
    expect(findItemLocation(eventsView, computed, "b", "2026-06-11")).toEqual({
      dateKey: "2026-06-11",
      item: { id: "b" },
    });
    expect(findItemLocation(eventsView, computed, "a")).toEqual({
      dateKey: "2026-06-10",
      item: { id: "a" },
    });
    expect(findItemLocation(eventsView, computed, "missing")).toBeNull();
  });

  it("resolvePendingFocusItem returns the open same-date match first", () => {
    const computed = {
      itemsByDate: {
        "2026-06-10": [{ id: "x", status: "open" }],
      },
    };
    expect(resolvePendingFocusItem({ activeView: eventsView, computed, dateKey: "2026-06-10", itemId: "x" }))
      .toEqual({ id: "x", status: "open" });
  });

  it("itemFromCalendarSearchResult maps event/deadline/bill shapes", () => {
    expect(itemFromCalendarSearchResult({ type: "event", itemId: "e1", title: "Lunch", itemDate: "2026-06-10", payload: { startMs: 1 } }))
      .toMatchObject({ id: "e1", title: "Lunch", agendaDateKey: "2026-06-10", startMs: 1 });
    expect(itemFromCalendarSearchResult({ type: "deadline", itemId: "deadline:5:2026-06-10", title: "Essay", itemDate: "2026-06-10" }))
      .toMatchObject({ id: "deadline:5:2026-06-10", agendaItemId: "deadline:5:2026-06-10", due_date: "2026-06-10", status: "open" });
    expect(itemFromCalendarSearchResult({ type: "bill", itemId: "b1", title: "Rent", itemDate: "2026-06-01" }))
      .toMatchObject({ id: "b1", name: "Rent", next_date: "2026-06-01" });
    expect(itemFromCalendarSearchResult(null)).toBeNull();
  });
});
