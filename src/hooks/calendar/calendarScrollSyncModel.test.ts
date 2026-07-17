import { describe, expect, it } from "vitest";
import {
  gridVisibleDateRange,
  agendaCrossesGridBoundary,
  agendaTargetForGridMonth,
} from "./calendarScrollSyncModel";

describe("calendarScrollSyncModel", () => {
  describe("gridVisibleDateRange", () => {
    it("computes 6-row range for a month starting mid-week", () => {
      // Jan 2026: starts Thursday (firstDay=4), 31 days
      // Grid: Dec 28 2025 through Feb 7 2026 (42 cells)
      const range = gridVisibleDateRange({ year: 2026, month: 0 }, { firstDay: 4, daysInMonth: 31 });
      expect(range).toEqual({ firstDate: "2025-12-28", lastDate: "2026-02-07" });
    });

    it("computes 6-row range for a month starting on Sunday", () => {
      // Feb 2026: starts Sunday (firstDay=0), 28 days
      // Grid: Feb 1 through Mar 14 (42 cells)
      const range = gridVisibleDateRange({ year: 2026, month: 1 }, { firstDay: 0, daysInMonth: 28 });
      expect(range).toEqual({ firstDate: "2026-02-01", lastDate: "2026-03-14" });
    });

    it("computes 6-row range for a month starting on Saturday", () => {
      // Feb 2025: starts Saturday (firstDay=6), 28 days
      // Grid: Jan 26 through Mar 8 (42 cells)
      const range = gridVisibleDateRange({ year: 2025, month: 1 }, { firstDay: 6, daysInMonth: 28 });
      expect(range).toEqual({ firstDate: "2025-01-26", lastDate: "2025-03-08" });
    });

    it("handles leap year February", () => {
      // Feb 2024: starts Thursday (firstDay=4), 29 days
      // Grid: Jan 28 through Mar 9 (42 cells)
      const range = gridVisibleDateRange({ year: 2024, month: 1 }, { firstDay: 4, daysInMonth: 29 });
      expect(range).toEqual({ firstDate: "2024-01-28", lastDate: "2024-03-09" });
    });

    it("handles year boundary (December)", () => {
      // Dec 2025: starts Monday (firstDay=1), 31 days
      // Grid: Nov 30 through Jan 10 2026 (42 cells)
      const range = gridVisibleDateRange({ year: 2025, month: 11 }, { firstDay: 1, daysInMonth: 31 });
      expect(range).toEqual({ firstDate: "2025-11-30", lastDate: "2026-01-10" });
    });

    it("handles month starting on Wednesday with 30 days", () => {
      // Apr 2026: starts Wednesday (firstDay=3), 30 days
      // Grid: Mar 29 through May 9 (42 cells)
      const range = gridVisibleDateRange({ year: 2026, month: 3 }, { firstDay: 3, daysInMonth: 30 });
      expect(range).toEqual({ firstDate: "2026-03-29", lastDate: "2026-05-09" });
    });
  });

  describe("agendaCrossesGridBoundary", () => {
    const janRange = { firstDate: "2025-12-28", lastDate: "2026-02-07" };

    it("returns crossed false when topmost date is within range", () => {
      const result = agendaCrossesGridBoundary("2026-01-15", janRange);
      expect(result).toEqual({ crossed: false });
    });

    it("returns crossed false at the first date boundary", () => {
      const result = agendaCrossesGridBoundary("2025-12-28", janRange);
      expect(result).toEqual({ crossed: false });
    });

    it("returns crossed false at the last date boundary", () => {
      const result = agendaCrossesGridBoundary("2026-02-07", janRange);
      expect(result).toEqual({ crossed: false });
    });

    it("returns crossed true when topmost date is before range", () => {
      const result = agendaCrossesGridBoundary("2025-12-27", janRange);
      expect(result).toEqual({ crossed: true, targetMonth: { year: 2025, month: 11 } });
    });

    it("returns crossed true when topmost date is after range", () => {
      const result = agendaCrossesGridBoundary("2026-02-08", janRange);
      expect(result).toEqual({ crossed: true, targetMonth: { year: 2026, month: 1 } });
    });

    it("returns the correct target month for a date far outside range", () => {
      const result = agendaCrossesGridBoundary("2026-06-15", janRange);
      expect(result).toEqual({ crossed: true, targetMonth: { year: 2026, month: 5 } });
    });

    it("handles year boundary crossing backward", () => {
      // Feb 2026 range: Feb 1 to Mar 14
      const febRange = { firstDate: "2026-02-01", lastDate: "2026-03-14" };
      const result = agendaCrossesGridBoundary("2026-01-31", febRange);
      expect(result).toEqual({ crossed: true, targetMonth: { year: 2026, month: 0 } });
    });
  });

  describe("agendaTargetForGridMonth", () => {
    it("returns the first of the given month", () => {
      expect(agendaTargetForGridMonth(2026, 0)).toBe("2026-01-01");
    });

    it("pads single-digit months", () => {
      expect(agendaTargetForGridMonth(2026, 2)).toBe("2026-03-01");
    });

    it("handles December", () => {
      expect(agendaTargetForGridMonth(2026, 11)).toBe("2026-12-01");
    });

    it("handles year boundaries", () => {
      expect(agendaTargetForGridMonth(2025, 0)).toBe("2025-01-01");
    });
  });
});
