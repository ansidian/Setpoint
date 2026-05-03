import { describe, expect, it } from "vitest";
import {
  CURRENT_MONTH_BOUNDARY_COLOR,
  OTHER_MONTH_BOUNDARY_COLOR,
  buildCalendarMonthCells,
} from "./calendarGridUtils.js";

describe("buildCalendarMonthCells", () => {
  it("labels trailing first-of-month days and marks boundaries around the actual current month", () => {
    const cells = buildCalendarMonthCells({
      cellCount: 42,
      currentMonth: 4,
      currentYear: 2026,
      firstDay: 3,
      viewMonth: 3,
      viewYear: 2026,
    });

    const may1 = cells.find((cell) => cell.dateKey === "2026-05-01");
    const may2 = cells.find((cell) => cell.dateKey === "2026-05-02");
    const march31 = cells.find((cell) => cell.dateKey === "2026-03-31");

    expect(may1).toMatchObject({
      dateLabel: "May 1",
      inCurrentMonth: false,
      inActualCurrentMonth: true,
      adjacentPosition: "trailing",
      boundaryColor: CURRENT_MONTH_BOUNDARY_COLOR,
    });
    expect(may1.boundarySides).toEqual(["left", "top"]);
    expect(may2).toMatchObject({
      dateLabel: "2",
      boundaryColor: CURRENT_MONTH_BOUNDARY_COLOR,
    });
    expect(may2.boundarySides).toEqual(["top"]);
    expect(march31).toMatchObject({
      dateLabel: "31",
      adjacentPosition: "leading",
      boundaryColor: OTHER_MONTH_BOUNDARY_COLOR,
    });
    expect(march31.boundarySides).toEqual(["right", "bottom"]);
  });

  it("mutes adjacent-month boundaries that do not wrap the actual current month", () => {
    const cells = buildCalendarMonthCells({
      cellCount: 42,
      currentMonth: 3,
      currentYear: 2026,
      firstDay: 1,
      viewMonth: 5,
      viewYear: 2026,
    });

    const may31 = cells.find((cell) => cell.dateKey === "2026-05-31");

    expect(may31).toMatchObject({
      dateLabel: "31",
      inActualCurrentMonth: false,
      adjacentPosition: "leading",
      boundaryColor: OTHER_MONTH_BOUNDARY_COLOR,
    });
    expect(may31.boundarySides).toEqual(["right", "bottom"]);
  });
});
