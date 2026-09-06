import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compute, getDeadlineSelectionId
} from "./deadlinesModel.ts";

describe("deadlinesModel", () => {
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

    expect(result.itemsByDate["2026-05-10"]!.activeItems.map((item) => item.id)).toEqual(["active"]);
    expect(result.itemsByDate["2026-05-10"]!.completedItems.map((item) => item.id)).toEqual(["done"]);
  });

  it("keeps adjacent-month deadlines addressable only by their full date", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        upcoming: [{
          id: "deadline-apr-30",
          title: "Essay",
          due_date: "2026-04-30",
          status: "incomplete",
        }],
      },
    });

    expect(result.itemsByDay[30]).toBeUndefined();
    expect(result.itemsByDate["2026-04-30"]!.items).toEqual([
      expect.objectContaining({ title: "Essay" }),
    ]);
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
      expect(result.earliestOverdue!.getDate()).toBe(4);
    });
  });
});
