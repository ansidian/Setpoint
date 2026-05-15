import { describe, expect, it } from "vitest";
import { getOverviewModel } from "./calendarOverviewModel.js";

describe("calendarOverviewModel", () => {
  it("summarizes event month activity", () => {
    const model = getOverviewModel({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {
        1: [{ id: "event-1" }],
        3: [{ id: "event-2" }],
      },
      computed: {
        totalEvents: 2,
        allDayEvents: 1,
      },
      data: {},
    });

    expect(model.title).toBe("May 2026");
    expect(model.spotlight).toMatchObject({
      label: "Events this month",
      value: "2",
      detail: "1 all-day item",
    });
    expect(model.stats).toEqual([
      expect.objectContaining({ label: "Active days", value: "2" }),
      expect.objectContaining({ label: "All-day", value: "1" }),
    ]);
  });

  it("summarizes bill totals from day state objects", () => {
    const model = getOverviewModel({
      view: "bills",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {
        1: { totalCount: 2, activeCount: 1, completedCount: 1, activeItems: [{}] },
        2: { totalCount: 1, activeCount: 1, completedCount: 0, activeItems: [{}] },
      },
      computed: {
        monthTotal: 1250,
      },
      data: {},
    });

    expect(model.spotlight).toMatchObject({
      label: "Scheduled this month",
      value: "$1,250",
      detail: "2 billing days on the grid",
    });
    expect(model.stats).toEqual([
      expect.objectContaining({ label: "Unpaid", value: "2" }),
      expect.objectContaining({ label: "Paid", value: "1" }),
    ]);
  });

  it("defaults stale workspace overview values to Events", () => {
    const model = getOverviewModel({
      view: "legacy",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 6,
      itemsByDay: {},
      computed: {
        totalEvents: 0,
        allDayEvents: 0,
      },
      data: {
        upcoming: [
          { id: "today", due_date: "2026-05-06" },
          { id: "week", due_date: "2026-05-09" },
        ],
      },
    });

    expect(model.spotlight).toMatchObject({
      label: "Events this month",
      value: "0",
    });
    expect(model.stats).toEqual([
      expect.objectContaining({ label: "Active days", value: "0" }),
      expect.objectContaining({ label: "All-day", value: "0" }),
    ]);
  });
});
