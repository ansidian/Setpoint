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

  it("merges an upsert: supplied fields overwrite, untouched fields survive", () => {
    const root = {
      upcoming: [
        {
          id: "task",
          due_date: "2026-05-07",
          status: "incomplete",
          content: "Original title",
          priority: 4,
        },
      ],
      stats: null,
    };

    const merged = applyDeadlineUpsert(
      root,
      { id: "task", status: "complete", content: "New title" },
      { merge: true, now },
    );

    expect(merged.upcoming).toHaveLength(1);
    expect(merged.upcoming[0]).toEqual({
      id: "task",
      due_date: "2026-05-07",
      status: "complete",
      content: "New title",
      priority: 4,
    });
  });

  it("replaces an upsert (merge:false): non-supplied fields are dropped", () => {
    const root = {
      upcoming: [
        {
          id: "task",
          due_date: "2026-05-07",
          status: "incomplete",
          content: "Original title",
          priority: 4,
        },
      ],
      stats: null,
    };

    const replaced = applyDeadlineUpsert(
      root,
      { id: "task", due_date: "2026-05-09", status: "incomplete" },
      { now },
    );

    expect(replaced.upcoming).toHaveLength(1);
    expect(replaced.upcoming[0]).toEqual({
      id: "task",
      due_date: "2026-05-09",
      status: "incomplete",
    });
    expect(replaced.upcoming[0].content).toBeUndefined();
    expect(replaced.upcoming[0].priority).toBeUndefined();
  });

  it("upsert skips tombstoned entries: re-adds a fresh live deadline alongside the tombstone", () => {
    const root = {
      upcoming: [
        {
          id: "task",
          due_date: "2026-05-07",
          status: "incomplete",
          _tombstone: true,
        },
      ],
      stats: null,
    };

    const upserted = applyDeadlineUpsert(
      root,
      { id: "task", due_date: "2026-05-08", status: "incomplete" },
      { merge: true, now },
    );

    // The tombstone is not matched, so the new entry is appended rather than merged onto it.
    expect(upserted.upcoming).toHaveLength(2);
    expect(upserted.upcoming[0]).toMatchObject({ id: "task", _tombstone: true });
    const live = upserted.upcoming[1];
    expect(live).toMatchObject({ id: "task", due_date: "2026-05-08", status: "incomplete" });
    expect(live._tombstone).toBeUndefined();

    // Stats exclude the tombstone and count only the live entry.
    expect(upserted.stats).toMatchObject({ incomplete: 1, dueToday: 0, dueThisWeek: 1 });

    // deadlineMatches resolves the live entry (tombstone is skipped).
    expect(deadlineMatches(upserted.upcoming[0], "task")).toBe(false);
    expect(deadlineMatches(upserted.upcoming[1], "task")).toBe(true);
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
