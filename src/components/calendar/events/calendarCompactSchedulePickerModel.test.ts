import { describe, expect, it } from "vitest";
import {
  applyCompactScheduleDate,
  applyCompactScheduleTime,
  getCompactScheduleMonthCells,
  isDateInDraftRange,
  monthFromDateKey,
} from "./calendarCompactSchedulePickerModel";

describe("calendarCompactSchedulePickerModel", () => {
  it("builds a six-week month grid and resolves the displayed month", () => {
    const cells = getCompactScheduleMonthCells(2026, 4);

    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({
      year: 2026,
      month: 3,
      day: 26,
      dateKey: "2026-04-26",
      inMonth: false,
    });
    expect(cells[41]?.dateKey).toBe("2026-06-06");
    expect(monthFromDateKey("2026-05-20")).toEqual({ year: 2026, month: 4 });
  });

  it("detects inclusive draft ranges and clamps date edits", () => {
    const draft = { startDate: "2026-05-10", endDate: "2026-05-12" };

    expect(isDateInDraftRange("2026-05-10", draft)).toBe(true);
    expect(isDateInDraftRange("2026-05-12", draft)).toBe(true);
    expect(isDateInDraftRange("2026-05-13", draft)).toBe(false);
    expect(applyCompactScheduleDate(draft, "startDate", "2026-05-14")).toEqual({
      startDate: "2026-05-14",
      endDate: "2026-05-14",
    });
    expect(applyCompactScheduleDate(draft, "endDate", "2026-05-09")).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-10",
    });
  });

  it("seeds a 30-minute end from the start time across midnight", () => {
    expect(applyCompactScheduleTime({
      startDate: "2026-05-10",
      endDate: "2026-05-10",
      startTime: "09:00",
      endTime: "09:30",
    }, "startTime", "23:50")).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-11",
      startTime: "23:50",
      endTime: "00:20",
    });
  });

  it("rolls a same-day earlier end overnight but leaves valid and multi-day ranges alone", () => {
    const sameDay = {
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "09:00",
      endTime: "09:30",
    };

    expect(applyCompactScheduleTime(sameDay, "endTime", "08:00").endDate).toBe("2026-04-21");
    expect(applyCompactScheduleTime(sameDay, "endTime", "10:00").endDate).toBe("2026-04-20");
    expect(applyCompactScheduleTime({ ...sameDay, endDate: "2026-04-21" }, "endTime", "08:00").endDate)
      .toBe("2026-04-21");
  });
});
