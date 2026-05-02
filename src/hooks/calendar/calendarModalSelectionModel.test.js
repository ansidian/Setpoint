import { describe, expect, it } from "vitest";
import {
  buildCalendarModalSyncSnapshot,
  isSameViewDate,
  parseFocusDate,
  ymdFromView,
} from "./calendarModalSelectionModel";

describe("calendarModalSelectionModel", () => {
  it("parses focus dates and rejects empty or invalid input", () => {
    expect(parseFocusDate(null)).toBeNull();
    expect(parseFocusDate("not-a-date")).toBeNull();

    const date = parseFocusDate("2026-04-20");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(3);
    expect(date?.getDate()).toBe(20);
  });

  it("formats the selected date from the active month view", () => {
    expect(ymdFromView({ viewYear: 2026, viewMonth: 3, selectedDay: 9 })).toBe("2026-04-09");
    expect(ymdFromView({ viewYear: 2026, viewMonth: 3, selectedDay: null })).toBeNull();
  });

  it("builds an opening snapshot from focus date and item id", () => {
    const snapshot = buildCalendarModalSyncSnapshot({
      open: true,
      view: "events",
      prevOpen: false,
      prevView: "events",
      prevOpenRequestId: 0,
      openRequestId: 0,
      focusDate: "2026-05-02",
      focusItemId: "event-1",
      viewDate: { month: 3, year: 2026 },
      selectedDay: null,
      selectedDateKey: null,
      selectedItemId: null,
      pendingFocusDate: null,
      pendingFocusItemId: null,
    });

    expect(snapshot).toMatchObject({
      didViewChange: false,
      resetDeadlineEditor: true,
      nextViewDate: { month: 4, year: 2026 },
      nextSelectedDay: 2,
      nextSelectedDateKey: "2026-05-02",
      nextSelectedItemId: "event-1",
      nextPendingFocusDate: "2026-05-02",
      nextPendingFocusItemId: "event-1",
      openCreate: false,
    });
  });

  it("keeps a pending focus date until a view change consumes it", () => {
    const snapshot = buildCalendarModalSyncSnapshot({
      open: true,
      view: "deadlines",
      prevOpen: true,
      prevView: "events",
      prevOpenRequestId: 1,
      openRequestId: 1,
      focusDate: null,
      focusItemId: null,
      viewDate: { month: 3, year: 2026 },
      selectedDay: 20,
      selectedDateKey: "2026-04-20",
      selectedItemId: null,
      pendingFocusDate: "2026-05-04",
      pendingFocusItemId: "todo-1",
    });

    expect(snapshot).toMatchObject({
      didViewChange: true,
      nextViewDate: { month: 4, year: 2026 },
      nextSelectedDay: 4,
      nextSelectedDateKey: "2026-05-04",
      nextSelectedItemId: "todo-1",
      nextPendingFocusDate: null,
      nextPendingFocusItemId: null,
    });
  });

  it("detects view-date equality by month and year", () => {
    expect(isSameViewDate({ month: 4, year: 2026 }, { month: 4, year: 2026 })).toBe(true);
    expect(isSameViewDate({ month: 4, year: 2026 }, { month: 5, year: 2026 })).toBe(false);
  });
});
