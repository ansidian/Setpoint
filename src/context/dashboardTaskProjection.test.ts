import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDeadlineComplete,
  applyDeadlineCompleting,
  applyDeadlineDelete,
  applyDeadlineUpsert,
  clearDeadlineCompleting,
  deadlineMatches,
} from "./dashboardTaskProjection";

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
    expect(replaced.upcoming[0]!.content).toBeUndefined();
    expect(replaced.upcoming[0]!.priority).toBeUndefined();
  });

  it("non-merge upsert skips tombstoned entries: re-adds a fresh live deadline alongside the tombstone (e.g. handleAddTask)", () => {
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
      { now },
    );

    // The tombstone is not matched, so the new entry is appended rather than merged onto it.
    expect(upserted.upcoming).toHaveLength(2);
    expect(upserted.upcoming[0]).toMatchObject({ id: "task", _tombstone: true });
    const live = upserted.upcoming[1];
    expect(live).toMatchObject({ id: "task", due_date: "2026-05-08", status: "incomplete" });
    expect(live!._tombstone).toBeUndefined();

    // Stats exclude the tombstone and count only the live entry.
    expect(upserted.stats).toMatchObject({ incomplete: 1, dueToday: 0, dueThisWeek: 1 });

    // deadlineMatches resolves the live entry (tombstone is skipped).
    expect(deadlineMatches(upserted.upcoming[0], "task")).toBe(false);
    expect(deadlineMatches(upserted.upcoming[1], "task")).toBe(true);
  });

  it("merge upsert onto a tombstone-only match returns the same root unchanged (nothing live to merge onto)", () => {
    const root = {
      upcoming: [
        {
          id: "task",
          due_date: "2026-05-07",
          status: "complete",
          _tombstone: true,
        },
      ],
      stats: null,
    };

    // e.g. handleUpdateTask/handleMoveTask saving edits against a task whose
    // only cache entry is a completed-occurrence tombstone (its live sibling
    // occurrence, if any, isn't in the cached range) — a merge means "update
    // the existing live entry", and there is none to update.
    const result = applyDeadlineUpsert(
      root,
      { id: "task", due_date: "2026-05-08", status: "incomplete" },
      { merge: true, now },
    );

    expect(result).toBe(root);
    expect(result.upcoming).toHaveLength(1);
  });

  it("marks a deadline completing and then complete", () => {
    const root = {
      upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete" }],
      stats: null,
    };

    const completing = applyDeadlineCompleting(root, "shared");
    expect(completing.upcoming[0]!._completing).toBe(true);

    const cleared = clearDeadlineCompleting(completing, "shared");
    expect(cleared.upcoming[0]!._completing).toBeUndefined();

    const complete = applyDeadlineComplete(completing, "shared", { now });
    expect(complete.upcoming[0]).toMatchObject({ status: "complete" });
    expect(complete.upcoming[0]!._completing).toBeUndefined();
    expect(complete.stats).toMatchObject({ incomplete: 0, dueToday: 1, dueThisWeek: 1 });
  });

  it("applyDeadlineComplete is an identity no-op when the deadline is absent", () => {
    const root = {
      upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete" }],
      stats: null,
    };

    const result = applyDeadlineComplete(root, "missing-id", { now });
    expect(result).toBe(root);
  });

  it("clearDeadlineCompleting is an identity no-op when the deadline is absent", () => {
    const root = {
      upcoming: [{ id: "shared", due_date: "2026-05-07", status: "incomplete", _completing: true }],
      stats: null,
    };

    const result = clearDeadlineCompleting(root, "missing-id");
    expect(result).toBe(root);
  });

  describe("deadline stats: single semantic matching the server", () => {
    const pinnedNow = new Date("2026-07-08T18:00:00.000Z"); // 2026-07-08 in America/Los_Angeles (PDT)

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sums totalPoints from points_possible, including completed deadlines", () => {
      const root = {
        upcoming: [{ id: "a", due_date: "2026-07-08", status: "complete", points_possible: 5 }],
        stats: null,
      };

      // applyDeadlineDelete of a non-matching id leaves `upcoming` untouched
      // but still recomputes `stats`, giving a clean way to assert on stats
      // for a preset root without an extra mutation.
      const result = applyDeadlineDelete(root, "missing-id", { now: pinnedNow });

      expect(result.stats!.totalPoints).toBe(5);
    });

    it("matches the server's computeDeadlineStats fixture exactly (tombstones excluded, a client-cache-only concern the server never sees)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(pinnedNow);

      const completeDueToday = {
        id: "a",
        due_date: "2026-07-08",
        status: "complete",
        points_possible: 5,
      };
      const incompleteDueToday = {
        id: "b",
        due_date: "2026-07-08",
        status: "incomplete",
        points_possible: 3,
      };
      const incompleteNextWeek = {
        id: "c",
        due_date: "2026-07-12",
        status: "incomplete",
        points_possible: 2,
      };
      const tombstone = {
        id: "d",
        due_date: "2026-07-08",
        status: "complete",
        points_possible: 99,
        _tombstone: true,
      };

      const serverStats = { incomplete: 2, dueToday: 2, dueThisWeek: 3, totalPoints: 10 };

      const root = {
        upcoming: [completeDueToday, incompleteDueToday, incompleteNextWeek, tombstone],
        stats: null,
      };
      const clientResult = applyDeadlineDelete(root, "missing-id", { now: pinnedNow });

      expect(clientResult.stats).toEqual(serverStats);
      expect(serverStats).toEqual({ incomplete: 2, dueToday: 2, dueThisWeek: 3, totalPoints: 10 });
    });

    it("computes a DST-safe due-this-week window via calendar-day math, not now+168h", () => {
      // 2026-03-07 23:30 PST (the night before spring-forward). now + 7*86400000ms
      // lands at 2026-03-15 00:30 PDT, so a fixed-ms shift would wrongly include
      // 2026-03-15 (an 8-day window). Calendar-day math must exclude it.
      const dstNow = new Date("2026-03-08T07:30:00.000Z");
      const root = {
        upcoming: [
          { id: "in", due_date: "2026-03-14", status: "incomplete" },
          { id: "out", due_date: "2026-03-15", status: "incomplete" },
        ],
        stats: null,
      };

      const result = applyDeadlineDelete(root, "missing-id", { now: dstNow });

      expect(result.stats!.dueThisWeek).toBe(1);
    });
  });
});
