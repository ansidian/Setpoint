import { describe, expect, it } from "vitest";

import {
  applyTaskComplete,
  applyTaskCompleting,
  applyTaskStatus,
  applyTodoistTaskDelete,
  applyTodoistTaskUpsert,
  dismissTodoistTombstone,
  taskMatches,
} from "./dashboardTaskProjection.js";

const now = new Date("2026-05-07T12:00:00.000Z");

describe("dashboard task projection", () => {
  it("matches task ids within source sections", () => {
    expect(taskMatches({ id: "1", source: "todoist" }, "1", "todoist")).toBe(true);
    expect(taskMatches({ id: "1", source: "canvas" }, "1", "ctm")).toBe(true);
    expect(taskMatches({ id: "1", source: "todoist" }, "1", "ctm")).toBe(false);
    expect(taskMatches({ id: "1", source: "todoist", _tombstone: true }, "1", "todoist")).toBe(false);
  });

  it("upserts and deletes Todoist tasks with local stats", () => {
    const root = {
      ctm: { upcoming: [], stats: null },
      todoist: {
        upcoming: [{ id: "old", due_date: "2026-05-07", status: "incomplete", source: "todoist" }],
        stats: null,
      },
    };

    const added = applyTodoistTaskUpsert(root, {
      id: "new",
      due_date: "2026-05-08",
      status: "incomplete",
      source: "todoist",
    }, { now });

    expect(added.todoist.upcoming.map((task) => task.id)).toEqual(["old", "new"]);
    expect(added.todoist.stats).toMatchObject({ incomplete: 2, dueToday: 1, dueThisWeek: 2 });

    const deleted = applyTodoistTaskDelete(added, "old", { now });
    expect(deleted.todoist.upcoming.map((task) => task.id)).toEqual(["new"]);
    expect(deleted.todoist.stats).toMatchObject({ incomplete: 1, dueToday: 0, dueThisWeek: 1 });
  });

  it("marks a task completing and then complete in the requested section only", () => {
    const root = {
      ctm: {
        upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete", source: "canvas" }],
        stats: null,
      },
      todoist: {
        upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete", source: "todoist" }],
        stats: null,
      },
    };

    const completing = applyTaskCompleting(root, "shared", "ctm");
    expect(completing.ctm.upcoming[0]._completing).toBe(true);
    expect(completing.todoist.upcoming[0]._completing).toBeUndefined();

    const complete = applyTaskComplete(completing, "shared", "ctm", { now });
    expect(complete.ctm.upcoming[0]).toMatchObject({ status: "complete" });
    expect(complete.ctm.upcoming[0]._completing).toBeUndefined();
    expect(complete.todoist.upcoming[0].status).toBe("incomplete");
    expect(complete.ctm.stats).toMatchObject({ incomplete: 0, dueToday: 1, dueThisWeek: 1 });
  });

  it("applies status and tombstone dismissal through projection helpers", () => {
    const root = {
      ctm: {
        upcoming: [{ id: "ctm-1", due_date: "2026-05-07", status: "incomplete", source: "canvas" }],
        stats: null,
      },
      todoist: {
        upcoming: [
          { id: "ghost", due_date: "2026-05-07", status: "complete", source: "todoist", _tombstone: true },
          { id: "todo-1", due_date: "2026-05-08", status: "incomplete", source: "todoist" },
        ],
        stats: null,
      },
    };

    const status = applyTaskStatus(root, "ctm-1", "in_progress", "ctm");
    expect(status.ctm.upcoming[0].status).toBe("in_progress");

    const dismissed = dismissTodoistTombstone(root, "ghost", { now });
    expect(dismissed.todoist.upcoming.map((task) => task.id)).toEqual(["todo-1"]);
    expect(dismissed.todoist.stats).toMatchObject({ incomplete: 1, dueToday: 0, dueThisWeek: 1 });
  });
});
