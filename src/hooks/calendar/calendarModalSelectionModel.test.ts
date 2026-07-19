import { describe, expect, it, vi } from "vitest";
import {
  buildCalendarModalSyncSnapshot,
  isDateVisibleInMonthGrid,
  parseFocusDate,
  resolveFocusViewDate,
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

  it("builds an opening snapshot without jumping when the focus date is visible in the current grid", () => {
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
      nextViewDate: { month: 3, year: 2026 },
      nextSelectedDay: 2,
      nextSelectedDateKey: "2026-05-02",
      nextSelectedItemId: "event-1",
      nextPendingFocusDate: "2026-05-02",
      nextPendingFocusItemId: "event-1",
      openCreate: false,
    });
  });

  it("moves the view to the focus month when the focus date is not visible in the current grid", () => {
    const snapshot = buildCalendarModalSyncSnapshot({
      open: true,
      view: "events",
      prevOpen: false,
      prevView: "events",
      prevOpenRequestId: 0,
      openRequestId: 0,
      focusDate: "2026-05-04",
      focusItemId: "event-1",
      viewDate: { month: 3, year: 2026 },
      selectedDay: null,
      selectedDateKey: null,
      selectedItemId: null,
      pendingFocusDate: null,
      pendingFocusItemId: null,
    });

    expect(snapshot).toMatchObject({
      nextViewDate: { month: 4, year: 2026 },
      nextSelectedDay: 4,
      nextSelectedDateKey: "2026-05-04",
      nextSelectedItemId: "event-1",
    });
  });

  it("detects focus dates that are already visible as leading or trailing grid days", () => {
    const aprilView = { month: 3, year: 2026 };
    expect(isDateVisibleInMonthGrid(parseFocusDate("2026-03-29"), aprilView)).toBe(true);
    expect(isDateVisibleInMonthGrid(parseFocusDate("2026-05-02"), aprilView)).toBe(true);
    expect(isDateVisibleInMonthGrid(parseFocusDate("2026-05-03"), aprilView)).toBe(false);
    expect(resolveFocusViewDate(parseFocusDate("2026-05-02"), aprilView)).toEqual(aprilView);
    expect(resolveFocusViewDate(parseFocusDate("2026-05-03"), aprilView)).toEqual({ month: 4, year: 2026 });
  });

  it("keeps a pending focus date until a view change consumes it", () => {
    const snapshot = buildCalendarModalSyncSnapshot({
      open: true,
      view: "events",
      prevOpen: true,
      prevView: "bills",
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

  it("keeps the current selected date for plain Events create requests", () => {
    const snapshot = buildCalendarModalSyncSnapshot({
      open: true,
      view: "events",
      prevOpen: true,
      prevView: "events",
      prevOpenRequestId: 1,
      openRequestId: 2,
      focusDate: null,
      focusItemId: "new",
      viewDate: { month: 3, year: 2026 },
      selectedDay: 20,
      selectedDateKey: "2026-04-20",
      selectedItemId: "todo-1",
      pendingFocusDate: null,
      pendingFocusItemId: null,
    });

    expect(snapshot).toMatchObject({
      nextSelectedDay: 20,
      nextSelectedDateKey: "2026-04-20",
      nextSelectedItemId: "new",
      nextPendingFocusDate: null,
      nextPendingFocusItemId: "new",
      openCreate: true,
    });
  });

  it("resets an unfocused fresh open request to today instead of keeping a stale item selection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T16:00:00.000Z"));

    try {
      const snapshot = buildCalendarModalSyncSnapshot({
        open: true,
        view: "events",
        prevOpen: true,
        prevView: "events",
        prevOpenRequestId: 7,
        openRequestId: 8,
        focusDate: null,
        focusItemId: null,
        viewDate: { month: 3, year: 2026 },
        selectedDay: 20,
        selectedDateKey: "2026-04-20",
        selectedItemId: "event-1",
        pendingFocusDate: null,
        pendingFocusItemId: null,
      });

      expect(snapshot).toMatchObject({
        nextViewDate: { month: 4, year: 2026 },
        nextSelectedDay: 11,
        nextSelectedDateKey: "2026-05-11",
        nextSelectedItemId: null,
        nextPendingFocusDate: null,
        nextPendingFocusItemId: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("seeds today's view/day/key from Pacific time, not host-local, on a fresh open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T05:30:00Z"));

    try {
      const snapshot = buildCalendarModalSyncSnapshot({
        open: true,
        view: "events",
        prevOpen: false,
        prevView: "events",
        prevOpenRequestId: 0,
        openRequestId: 0,
        focusDate: null,
        focusItemId: null,
        viewDate: { month: 3, year: 2026 },
        selectedDay: null,
        selectedDateKey: null,
        selectedItemId: null,
        pendingFocusDate: null,
        pendingFocusItemId: null,
      });

      expect(snapshot).toMatchObject({
        nextViewDate: { month: 6, year: 2026 },
        nextSelectedDay: 5,
        nextSelectedDateKey: "2026-07-05",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
