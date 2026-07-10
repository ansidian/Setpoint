import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canNavigateBack,
  compute,
  deadlineAccentFor,
  getDeadlineSelectionId,
} from "./deadlinesModel.js";

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

  it("groups completed deadline history with active deadlines from the domain payload", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        upcoming: [
          { id: "active", title: "Active", due_date: "2026-05-10", status: "incomplete" },
          { id: "done", title: "Done", due_date: "2026-05-10", status: "complete" },
        ],
      },
    });

    expect(result.itemsByDate["2026-05-10"].activeItems.map((item) => item.id)).toEqual(["active"]);
    expect(result.itemsByDate["2026-05-10"].completedItems.map((item) => item.id)).toEqual(["done"]);
  });

  it("uses deadline occurrence identity for every deadline row", () => {
    expect(getDeadlineSelectionId({
      id: "repeat-1",
      due_date: "2026-05-10",
      is_recurring: true,
    })).toBe("deadline:repeat-1:2026-05-10");

    expect(getDeadlineSelectionId({
      id: "one-off",
      due_date: "2026-05-11",
    })).toBe("deadline:one-off:2026-05-11");
  });

  it("uses Todoist red as the deadline source accent fallback", () => {
    expect(deadlineAccentFor({ id: "todo-1", title: "Mop and Clean" })).toBe("#e44332");
    expect(deadlineAccentFor({ id: "custom", color: "#89b4fa" })).toBe("#89b4fa");
  });

  describe("overdue classification in Pacific time", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 2026-07-06T05:30:00Z is still 2026-07-05 in Pacific (America/Los_Angeles, UTC-7 in July).
      vi.setSystemTime(new Date("2026-07-06T05:30:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not treat a task due today (Pacific) as overdue", () => {
      const result = compute({
        viewYear: 2026,
        viewMonth: 6,
        data: {
          upcoming: [
            { id: "due-today", title: "Due today", due_date: "2026-07-05", status: "incomplete" },
          ],
        },
      });

      expect(result.earliestOverdue).toBeNull();
    });

    it("treats a task due yesterday (Pacific) as overdue", () => {
      const result = compute({
        viewYear: 2026,
        viewMonth: 6,
        data: {
          upcoming: [
            { id: "due-today", title: "Due today", due_date: "2026-07-05", status: "incomplete" },
            { id: "overdue", title: "Overdue", due_date: "2026-07-04", status: "incomplete" },
          ],
        },
      });

      expect(result.earliestOverdue).not.toBeNull();
      expect(result.earliestOverdue.getDate()).toBe(4);
    });
  });
});
