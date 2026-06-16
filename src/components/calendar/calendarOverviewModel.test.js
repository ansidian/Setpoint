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

  it("pins the empty-month events description copy", () => {
    const model = getOverviewModel({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {},
      computed: {
        totalEvents: 0,
        allDayEvents: 0,
      },
      data: {},
    });

    expect(model.description).toBe(
      "No events are scheduled in May 2026 yet. Select a day to inspect a clean block or add something new.",
    );
  });

  it("pins the populated-month events description with plural active days", () => {
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
        allDayEvents: 2,
      },
      data: {},
    });

    expect(model.description).toBe(
      "2 active days spread across the month. Select a day to inspect timing, attendees, and links.",
    );
  });

  it("uses singular grammar for a single active day and a single all-day item", () => {
    const model = getOverviewModel({
      view: "events",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {
        1: [{ id: "event-1" }],
      },
      computed: {
        totalEvents: 1,
        allDayEvents: 1,
      },
      data: {},
    });

    expect(model.description).toBe(
      "1 active day spread across the month. Select a day to inspect timing, attendees, and links.",
    );
    expect(model.spotlight.detail).toBe("1 all-day item");
  });

  it("pins the empty-month bills description copy", () => {
    const model = getOverviewModel({
      view: "bills",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {},
      computed: {
        monthTotal: 0,
      },
      data: {},
    });

    expect(model.description).toBe(
      "No scheduled bills land in May 2026 yet. Select a day to inspect the empty rhythm or review the month total.",
    );
    expect(model.spotlight).toMatchObject({
      label: "Scheduled this month",
      value: "$0",
      detail: "Nothing is on the books yet",
    });
  });

  it("summarizes bills from bare arrays and uses singular bill grammar", () => {
    const model = getOverviewModel({
      view: "bills",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {
        1: [{ id: "bill-1" }],
      },
      computed: {
        monthTotal: 75,
      },
      data: {},
    });

    // Bare-array branch: total === active === length, completed === 0.
    expect(model.description).toBe(
      "1 unpaid and 0 paid bill are scheduled this month. Select a day to inspect the stack.",
    );
    expect(model.spotlight).toMatchObject({
      label: "Scheduled this month",
      value: "$75",
      detail: "1 billing day on the grid",
    });
    expect(model.stats).toEqual([
      expect.objectContaining({ label: "Unpaid", value: "1" }),
      expect.objectContaining({ label: "Paid", value: "0" }),
    ]);
  });

  it("treats unexpected bills day values as empty via the fallback branch", () => {
    const model = getOverviewModel({
      view: "bills",
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      todayDate: 2,
      itemsByDay: {
        1: 42,
        2: "unexpected",
        3: null,
      },
      computed: {
        monthTotal: 0,
      },
      data: {},
    });

    // Fallback branch contributes zeros, so the month reads as having no bills,
    // even though three day keys are present on the grid.
    expect(model.description).toBe(
      "No scheduled bills land in May 2026 yet. Select a day to inspect the empty rhythm or review the month total.",
    );
    expect(model.stats).toEqual([
      expect.objectContaining({ label: "Unpaid", value: "0" }),
      expect.objectContaining({ label: "Paid", value: "0" }),
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
