import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompletedTasksTestDb,
  listCompletedTasks,
  seedCompletedTask,
} from "../test-utils/completed-tasks-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));

const { loadCompletedTaskIds } = await import("./deadline-helpers.js");

describe("loadCompletedTaskIds", () => {
  beforeEach(async () => {
    testState.db.current = await createCompletedTasksTestDb();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("returns only ids from legacy dedupe rows", async () => {
    await seedCompletedTask(testState.db.current, { todoist_id: "legacy-1" });
    await seedCompletedTask(testState.db.current, { todoist_id: "legacy-2" });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "tombstone-1",
      due_date: "2026-04-18",
      snapshot_json: JSON.stringify({ id: "tombstone-1", title: "Done" }),
    });

    const ids = await loadCompletedTaskIds("user-1", []);

    expect(ids).toEqual(new Set(["legacy-1", "legacy-2"]));
  });

  it("reconciles un-completed tasks by removing only legacy rows, not tombstones", async () => {
    await seedCompletedTask(testState.db.current, { todoist_id: "legacy-a" });
    await seedCompletedTask(testState.db.current, { todoist_id: "legacy-b" });
    await seedCompletedTask(testState.db.current, {
      todoist_id: "tombstone-a",
      due_date: "2026-04-18",
      snapshot_json: JSON.stringify({ id: "tombstone-a", title: "Done" }),
    });

    const ids = await loadCompletedTaskIds("user-1", [
      { id: "legacy-a" },
      { id: "tombstone-a" },
    ]);
    const rows = await listCompletedTasks(testState.db.current);

    expect(ids).toEqual(new Set(["legacy-b"]));
    expect(rows.map((row) => row.todoist_id)).toEqual(["legacy-b", "tombstone-a"]);
    expect(rows.find((row) => row.todoist_id === "tombstone-a").due_date).toBe("2026-04-18");
  });
});
