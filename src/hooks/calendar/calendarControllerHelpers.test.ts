import { describe, expect, it } from "vitest";
import {
  dedupeEvents, findItemLocation, itemFromCalendarSearchResult, resolvePendingFocusItem
} from "./calendarControllerHelpers";
import type { CalendarComputedItems, CalendarControllerItem, CalendarViewAdapter } from "./calendarControllerHelpers";
import calendarEventsView from "../../components/calendar/views/eventsView.tsx";
import { getDeadlineOverlayComputed } from "../../components/calendar/views/events/eventsPlanningModel.ts";

const eventsView: CalendarViewAdapter = {
  getItemId: (item: CalendarControllerItem) => item?.id,
  matchesItemId: (item: CalendarControllerItem, id: unknown) => String(item?.id) === String(id),
};

const getDeadlineOverlayComputedTyped = getDeadlineOverlayComputed as (input: {
  deadlineData: { upcoming: CalendarControllerItem[] };
  viewYear: number;
  viewMonth: number;
  showCompleted: boolean;
}) => CalendarComputedItems;

describe("calendarControllerHelpers", () => {

  it("dedupeEvents drops duplicates by id + originalStartTime, preserving order", () => {
    const a = { id: "1" };
    const b = { id: "1", originalStartTime: "x" };
    const c = { id: "2" };
    const result = dedupeEvents([a, { id: "1" }, b, c, b]);
    expect(result).toEqual([a, b, c]);
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

  it("resolvePendingFocusItem prefers an open same-date match over a completed one", () => {
    const computed = {
      itemsByDate: {
        "2026-06-10": [
          { id: "x", status: "complete" },
          { id: "x", status: "open" },
        ],
      },
    };
    expect(resolvePendingFocusItem({ activeView: eventsView, computed, dateKey: "2026-06-10", itemId: "x" }))
      .toEqual({ id: "x", status: "open" });
  });

  it("resolvePendingFocusItem activates the live recurring occurrence when focus targets a stale completed one", () => {
    // Mirrors the controller path: a recurring Todoist task whose dashboard
    // focus id points at a completed occurrence (2026-04-21) while the live
    // open occurrence sits on a later day (2026-04-23). The deadline-overlay
    // computed is built exactly as eventsView does at runtime.
    const computed = getDeadlineOverlayComputedTyped({
      deadlineData: {
        upcoming: [
          { id: "todo-rec", title: "Completed occurrence", due_date: "2026-04-21", status: "complete", is_recurring: true },
          { id: "todo-rec", title: "Current occurrence", due_date: "2026-04-23", status: "open", is_recurring: true },
        ],
      },
      viewYear: 2026,
      viewMonth: 3,
      showCompleted: true,
    });

    const resolved = resolvePendingFocusItem({
      activeView: calendarEventsView,
      computed,
      dateKey: "2026-04-21",
      itemId: "deadline:todo-rec:2026-04-21",
    });

    expect(resolved!.title).toBe("Current occurrence");
    expect(resolved!.status).toBe("open");
    expect(resolved!.agendaDateKey).toBe("2026-04-23");
  });

  it("resolvePendingFocusItem keeps the completed occurrence when no live occurrence exists", () => {
    const computed = getDeadlineOverlayComputedTyped({
      deadlineData: {
        upcoming: [
          { id: "todo-rec", title: "Completed occurrence", due_date: "2026-04-21", status: "complete", is_recurring: true },
        ],
      },
      viewYear: 2026,
      viewMonth: 3,
      showCompleted: true,
    });

    const resolved = resolvePendingFocusItem({
      activeView: calendarEventsView,
      computed,
      dateKey: "2026-04-21",
      itemId: "deadline:todo-rec:2026-04-21",
    });

    expect(resolved!.title).toBe("Completed occurrence");
    expect(resolved!.status).toBe("complete");
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
