import { describe, expect, it } from "vitest";
import {
  gridVisibleDateRange,
  agendaCrossesGridBoundary,
  agendaTargetForGridMonth,
} from "./calendarScrollSyncModel";

describe("calendarScrollSyncModel", () => {
  it("preserves six-row visible ranges across weekday, leap-year, and year boundaries", () => {
    const cases = [
      [{ year: 2026, month: 0 }, { firstDay: 4, daysInMonth: 31 }, { firstDate: "2025-12-28", lastDate: "2026-02-07" }],
      [{ year: 2026, month: 1 }, { firstDay: 0, daysInMonth: 28 }, { firstDate: "2026-02-01", lastDate: "2026-03-14" }],
      [{ year: 2025, month: 1 }, { firstDay: 6, daysInMonth: 28 }, { firstDate: "2025-01-26", lastDate: "2025-03-08" }],
      [{ year: 2024, month: 1 }, { firstDay: 4, daysInMonth: 29 }, { firstDate: "2024-01-28", lastDate: "2024-03-09" }],
      [{ year: 2025, month: 11 }, { firstDay: 1, daysInMonth: 31 }, { firstDate: "2025-11-30", lastDate: "2026-01-10" }],
      [{ year: 2026, month: 3 }, { firstDay: 3, daysInMonth: 30 }, { firstDate: "2026-03-29", lastDate: "2026-05-09" }],
    ] as const;

    for (const [month, shape, expected] of cases) {
      expect(gridVisibleDateRange(month, shape), `${month.year}-${month.month + 1} visible range`).toEqual(expected);
    }
  });

  it("preserves agenda boundary detection and target-month derivation", () => {
    const range = { firstDate: "2025-12-28", lastDate: "2026-02-07" };
    const cases = [
      ["2026-01-15", { crossed: false }],
      ["2025-12-28", { crossed: false }],
      ["2026-02-07", { crossed: false }],
      ["2025-12-27", { crossed: true, targetMonth: { year: 2025, month: 11 } }],
      ["2026-02-08", { crossed: true, targetMonth: { year: 2026, month: 1 } }],
      ["2026-06-15", { crossed: true, targetMonth: { year: 2026, month: 5 } }],
      ["2026-01-31", { crossed: true, targetMonth: { year: 2026, month: 0 } }],
    ] as const;

    for (const [dateKey, expected] of cases.slice(0, 6)) {
      expect(agendaCrossesGridBoundary(dateKey, range), `${dateKey} boundary result`).toEqual(expected);
    }

    const febRange = { firstDate: "2026-02-01", lastDate: "2026-03-14" };
    expect(agendaCrossesGridBoundary(cases[6]![0], febRange)).toEqual(cases[6]![1]);
  });

  it("formats the first agenda target date for every month boundary", () => {
    const cases = [
      [2026, 0, "2026-01-01"],
      [2026, 2, "2026-03-01"],
      [2026, 11, "2026-12-01"],
      [2025, 0, "2025-01-01"],
    ] as const;

    for (const [year, month, expected] of cases) {
      expect(agendaTargetForGridMonth(year, month), `${year}-${month + 1} target`).toBe(expected);
    }
  });
});
