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

  it("does not treat dated completed occurrences as active Todoist completion ids", async () => {
    await seedCompletedTask(testState.db.current, {
      todoist_id: "done-1",
      due_date: "2026-04-18",
      snapshot_json: JSON.stringify({ id: "done-1", title: "Done" }),
    });

    const ids = await loadCompletedTaskIds("user-1", []);

    expect(ids).toEqual(new Set());
  });

  it("does not delete dated completed occurrences when the live task id reappears", async () => {
    await seedCompletedTask(testState.db.current, {
      todoist_id: "done-a",
      due_date: "2026-04-18",
      snapshot_json: JSON.stringify({ id: "done-a", title: "Done" }),
    });

    const ids = await loadCompletedTaskIds("user-1", [
      { id: "done-a" },
    ]);
    const rows = await listCompletedTasks(testState.db.current);

    expect(ids).toEqual(new Set());
    expect(rows.map((row) => row.todoist_id)).toEqual(["done-a"]);
    expect(rows[0].due_date).toBe("2026-04-18");
  });
});
