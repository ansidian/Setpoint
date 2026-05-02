import { describe, expect, it } from "vitest";
import { canNavigateBack, compute } from "./deadlinesModel.js";

describe("deadlinesModel range navigation", () => {
  it("allows previous navigation by rolling window even without overdue data", () => {
    expect(canNavigateBack({
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      data: { minDate: "2025-05-02" },
      computed: {},
    })).toBe(true);

    expect(canNavigateBack({
      viewYear: 2026,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      data: {},
      computed: {},
    })).toBe(true);

    expect(canNavigateBack({
      viewYear: 2025,
      viewMonth: 4,
      currentYear: 2026,
      currentMonth: 4,
      data: { minDate: "2025-05-02" },
      computed: {},
    })).toBe(false);
  });

  it("groups completed Todoist history with active deadlines", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "active", title: "Active", due_date: "2026-05-10", status: "incomplete", source: "todoist" },
            { id: "done", title: "Done", due_date: "2026-05-10", status: "complete", source: "todoist" },
          ],
        },
      },
    });

    expect(result.itemsByDate["2026-05-10"].activeItems.map((item) => item.id)).toEqual(["active"]);
    expect(result.itemsByDate["2026-05-10"].completedItems.map((item) => item.id)).toEqual(["done"]);
  });
});
