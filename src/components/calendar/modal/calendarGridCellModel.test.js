import { describe, expect, it } from "vitest";
import { buildCalendarGridCellModel } from "./calendarGridCellModel.js";

describe("buildCalendarGridCellModel", () => {
  it("resolves date-keyed deadline cells with completed filtering and ghost counts", () => {
    const activeDeadline = { id: "active-1", title: "Active deadline" };
    const completedDeadline = { id: "done-1", title: "Done deadline" };
    const ghost = { kind: "deadline", startDate: "2026-05-01", id: "ghost-1" };

    const model = buildCalendarGridCellModel({
      activeView: {
        label: "Deadlines",
        getDayState: (items) => ({
          items,
          activeItems: items.filter((item) => item.id !== "done-1"),
          completedItems: items.filter((item) => item.id === "done-1"),
          activeCount: items.filter((item) => item.id !== "done-1").length,
          completedCount: items.filter((item) => item.id === "done-1").length,
          totalCount: items.length,
        }),
        getItemId: (item) => item.id,
        hasOverdue: (dayState) => dayState.activeCount > 0,
        allComplete: (dayState) => dayState.totalCount > 0 && dayState.activeCount === 0,
      },
      buildFallbackDayState: (items) => ({ items, totalCount: items.length }),
      cell: {
        dateKey: "2026-05-01",
        day: 1,
        inCurrentMonth: false,
      },
      currentMonth: 4,
      currentYear: 2026,
      eventDateCells: false,
      ghostPreview: { ghosts: [ghost] },
      itemsByDate: {
        "2026-05-01": [activeDeadline, completedDeadline],
      },
      itemsByDay: {
        1: [{ id: "wrong-month" }],
      },
      selectedCellKey: "2026-05-01",
      selectedDay: 1,
      selectedItemId: "active-1",
      shouldFilterCompletedDeadlines: true,
      spanLayout: {
        reservedLaneCountByDate: {},
        pinnedGhostCountByDate: {},
      },
      todayDate: 6,
      view: "deadlines",
      viewData: { isLoading: false },
      viewMonth: 4,
      viewYear: 2026,
    });

    expect(model.cellItems.items).toEqual([activeDeadline]);
    expect(model.itemCount).toBe(2);
    expect(model.hasItems).toBe(true);
    expect(model.hasOverdue).toBe(true);
    expect(model.allComplete).toBe(false);
    expect(model.dayHasSelectedItem).toBe(true);
    expect(model.isSelected).toBe(true);
    expect(model.rawItems).toEqual([activeDeadline, completedDeadline]);
  });
});
