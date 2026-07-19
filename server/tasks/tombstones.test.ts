import { afterEach, beforeEach, describe, expect, vi, it } from "vitest";
import type { Client, InStatement } from "@libsql/client";
import {
  createCompletedTasksTestDb,
  listCompletedTasks,
  seedCompletedTask,
} from "../test-utils/completed-tasks-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement | string) => testState.db.current.execute(statement),
  },
}));

const { buildSnapshot, hydrateRecurringTombstones } =
  await import("./tombstones.ts");

describe("buildSnapshot", () => {
  it("captures fields needed to rehydrate a completed recurring Todoist row", () => {
    const task = {
      id: "td-1",
      title: "Empty dishwasher",
      due_date: "2026-04-18",
      due_time: "8:00 AM",
      class_name: "Home",
      class_color: "#884dff",
      url: "https://app.todoist.com/app/task/empty-dishwasher-td-1",
      priority: 2,
      labels: ["chore"],
      description: "",
      source: "todoist",
      is_recurring: true,
    };
    const snap = buildSnapshot(task);
    expect(snap).toEqual({
      id: "td-1",
      title: "Empty dishwasher",
      due_date: "2026-04-18",
      due_time: "8:00 AM",
      class_name: "Home",
      class_color: "#884dff",
      url: "https://app.todoist.com/app/task/empty-dishwasher-td-1",
      priority: 2,
      labels: ["chore"],
      description: "",
      source: "todoist",
      is_recurring: true,
    });
  });

  it("drops transient runtime fields like _completing", () => {
    const task = {
      id: "td-1",
      title: "X",
      due_date: "2026-04-18",
      due_time: null,
      class_name: "Inbox",
      class_color: "#cba6da",
      url: "u",
      priority: null,
      labels: [],
      description: "",
      source: "todoist",
      is_recurring: true,
      _completing: true,
      status: "complete",
    };
    const snap = buildSnapshot(task);
    expect("_completing" in snap).toBe(false);
    expect("status" in snap).toBe(false);
  });
});

describe("hydrateRecurringTombstones", () => {
  beforeEach(async () => {
    testState.db.current = await createCompletedTasksTestDb();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await testState.db.current?.close?.();
    testState.db.current = null as unknown as Client;
  });

  it("returns visible completed occurrences and leaves older history stored", async () => {
    await seedCompletedTask(testState.db.current, {
      todoist_id: "live-1",
      due_date: "2099-01-01",
      snapshot_json: JSON.stringify({
        id: "live-1",
        title: "Future",
        due_date: "2099-01-01",
        source: "todoist",
        is_recurring: true,
      }),
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "expired-1",
      due_date: "1999-01-01",
      snapshot_json: JSON.stringify({ id: "expired-1", title: "Old" }),
    });

    const out = await hydrateRecurringTombstones("user-1");
    const rows = await listCompletedTasks(testState.db.current);

    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("live-1");
    expect(out[0]!.status).toBe("complete");
    expect(out[0]!._tombstone).toBe(true);
    expect(rows.map((row) => row.todoist_id)).toEqual(["expired-1", "live-1"]);
  });

  it("gracefully skips rows with malformed snapshot_json", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedCompletedTask(testState.db.current, {
      todoist_id: "bad",
      due_date: "2099-01-01",
      snapshot_json: "{not json",
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "good",
      due_date: "2099-01-01",
      snapshot_json: JSON.stringify({ id: "good", title: "Valid", source: "todoist" }),
    });

    const out = await hydrateRecurringTombstones("user-1");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("good");
  });

  it("returns empty array and issues no DELETE when table is empty", async () => {
    const out = await hydrateRecurringTombstones("user-1");
    const rows = await listCompletedTasks(testState.db.current);

    expect(out).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("prunes tombstones whose task id is absent from the live Todoist set", async () => {
    await seedCompletedTask(testState.db.current, {
      todoist_id: "still-there",
      due_date: "2099-01-01",
      snapshot_json: JSON.stringify({ id: "still-there", title: "Kept", source: "todoist", is_recurring: true }),
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "deleted-in-todoist",
      due_date: "2099-01-01",
      snapshot_json: JSON.stringify({ id: "deleted-in-todoist", title: "Gone", source: "todoist", is_recurring: true }),
    });

    const liveIds = new Set(["still-there"]);
    const out = await hydrateRecurringTombstones("user-1", liveIds);
    const rows = await listCompletedTasks(testState.db.current);

    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("still-there");
    expect(rows.map((row) => row.todoist_id)).toEqual(["still-there"]);
  });

  it("retains yesterday's tombstone but filters per view: today hides it, yesterday shows it", async () => {
    // Pin clock so "today" / "yesterday" are stable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T16:00:00Z")); // midday Pacific on 2026-04-18

    await seedCompletedTask(testState.db.current, {
      todoist_id: "yesterday-task",
      due_date: "2026-04-17",
      snapshot_json: JSON.stringify({ id: "yesterday-task", title: "Y", source: "todoist", is_recurring: false }),
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "today-task",
      due_date: "2026-04-18",
      snapshot_json: JSON.stringify({ id: "today-task", title: "T", source: "todoist", is_recurring: false }),
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "two-days-ago",
      due_date: "2026-04-16",
      snapshot_json: JSON.stringify({ id: "two-days-ago", title: "Old", source: "todoist" }),
    });

    // Deadlines view: today gate. Older history is filtered in memory, not deleted.
    const deadlinesOut = await hydrateRecurringTombstones("user-1", null, { viewBoundary: "today" });
    const afterDeadlinesRows = await listCompletedTasks(testState.db.current);

    expect(deadlinesOut.map((t) => t.id)).toEqual(["today-task"]);
    expect(afterDeadlinesRows.map((row) => row.todoist_id)).toEqual([
      "today-task",
      "two-days-ago",
      "yesterday-task",
    ]);

    // Calendar view: yesterday gate. Sees both today AND yesterday.
    const calendarOut = await hydrateRecurringTombstones("user-1", null, { viewBoundary: "yesterday" });
    expect(calendarOut.map((t) => t.id).sort()).toEqual(["today-task", "yesterday-task"]);
  });

  it("returns historical completed occurrences inside an explicit calendar range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T16:00:00Z"));

    await seedCompletedTask(testState.db.current, {
      todoist_id: "two-days-ago",
      due_date: "2026-04-16",
      snapshot_json: JSON.stringify({ id: "two-days-ago", title: "Old", source: "todoist" }),
    });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "yesterday-task",
      due_date: "2026-04-17",
      snapshot_json: JSON.stringify({ id: "yesterday-task", title: "Y", source: "todoist" }),
    });

    const out = await hydrateRecurringTombstones("user-1", null, {
      start: "2026-04-16",
      end: "2026-04-16",
    });
    const rows = await listCompletedTasks(testState.db.current);

    expect(out.map((task) => task.id)).toEqual(["two-days-ago"]);
    expect(rows.map((row) => row.todoist_id)).toEqual(["two-days-ago", "yesterday-task"]);
  });

  it("skips orphan pruning when liveTodoistIds is null (can't verify)", async () => {
    await seedCompletedTask(testState.db.current, {
      todoist_id: "td-1",
      due_date: "2099-01-01",
      snapshot_json: JSON.stringify({ id: "td-1", title: "X", source: "todoist" }),
    });

    // Explicit null — callers pass this when Todoist fetch failed, so we
    // must not wipe tombstones just because we couldn't check them.
    const out = await hydrateRecurringTombstones("user-1", null);
    const rows = await listCompletedTasks(testState.db.current);

    expect(out).toHaveLength(1);
    expect(rows.map((row) => row.todoist_id)).toEqual(["td-1"]);
  });
});
