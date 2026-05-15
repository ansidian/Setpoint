import { describe, expect, it } from "vitest";

import {
  applyDeadlineComplete,
  applyDeadlineCompleting,
  applyDeadlineDelete,
  applyDeadlineUpsert,
  clearDeadlineCompleting,
  deadlineMatches,
} from "./dashboardTaskProjection.js";

const now = new Date("2026-05-07T12:00:00.000Z");

describe("dashboard task projection", () => {
  it("matches deadline ids without provider sections", () => {
    expect(deadlineMatches({ id: "1" }, "1")).toBe(true);
    expect(deadlineMatches({ id: "1", source: "todoist" }, "1")).toBe(true);
    expect(deadlineMatches({ id: "1", _tombstone: true }, "1")).toBe(false);
  });

  it("upserts and deletes deadlines with local stats", () => {
    const root = {
      upcoming: [{ id: "old", due_date: "2026-05-07", status: "incomplete" }],
      stats: null,
    };

    const added = applyDeadlineUpsert(root, {
      id: "new",
      due_date: "2026-05-08",
      status: "incomplete",
    }, { now });

    expect(added.upcoming.map((task) => task.id)).toEqual(["old", "new"]);
    expect(added.stats).toMatchObject({ incomplete: 2, dueToday: 1, dueThisWeek: 2 });

    const deleted = applyDeadlineDelete(added, "old", { now });
    expect(deleted.upcoming.map((task) => task.id)).toEqual(["new"]);
    expect(deleted.stats).toMatchObject({ incomplete: 1, dueToday: 0, dueThisWeek: 1 });
  });

  it("marks a deadline completing and then complete", () => {
    const root = {
      upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete" }],
      stats: null,
    };

    const completing = applyDeadlineCompleting(root, "shared");
    expect(completing.upcoming[0]._completing).toBe(true);

    const cleared = clearDeadlineCompleting(completing, "shared");
    expect(cleared.upcoming[0]._completing).toBeUndefined();

    const complete = applyDeadlineComplete(completing, "shared", { now });
    expect(complete.upcoming[0]).toMatchObject({ status: "complete" });
    expect(complete.upcoming[0]._completing).toBeUndefined();
    expect(complete.stats).toMatchObject({ incomplete: 0, dueToday: 1, dueThisWeek: 1 });
  });
});
