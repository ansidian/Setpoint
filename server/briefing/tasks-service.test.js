import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompletedTasksTestDb,
  listCompletedTasks,
} from "../test-utils/completed-tasks-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("./todoist.js", () => ({
  completeTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
  fetchTodoistProjects: vi.fn(),
  fetchTodoistLabels: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
}));
vi.mock("./ctm.js", () => ({
  fetchCTMDeadlinesAll: vi.fn(),
  updateCTMEventStatus: vi.fn().mockResolvedValue(undefined),
}));

const todoist = await import("./todoist.js");
const ctm = await import("./ctm.js");
const { completeTask } = await import("./tasks-service.js");

beforeEach(async () => {
  testState.db.current = await createCompletedTasksTestDb();
  Object.values(todoist).forEach((fn) => fn.mockReset?.());
  ctm.fetchCTMDeadlinesAll.mockReset().mockResolvedValue([]);
  ctm.updateCTMEventStatus.mockClear();
  todoist.fetchTodoistTasksAll.mockResolvedValue([]);
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("completeTask", () => {
  it("CTM-only: calls updateCTMEventStatus from the domain source", async () => {
    ctm.fetchCTMDeadlinesAll.mockResolvedValueOnce([{ id: 42 }]);
    await completeTask("u1", "42");

    expect(ctm.updateCTMEventStatus).toHaveBeenCalledWith(42, "complete");
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
    expect(await listCompletedTasks(testState.db.current, "u1")).toEqual([]);
  });

  it("Todoist-only non-recurring: closes in Todoist and writes a completed-task snapshot", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([
      { id: "td-1", title: "One off", is_recurring: false, due_date: "2026-04-18", source: "todoist" },
    ]);
    await completeTask("u1", "td-1");

    const rows = await listCompletedTasks(testState.db.current, "u1");

    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      todoist_id: "td-1",
      due_date: "2026-04-18",
    });
    expect(JSON.parse(rows[0].snapshot_json)).toMatchObject({ id: "td-1", title: "One off", is_recurring: false });
  });

  it("Todoist-only recurring: writes completed-task snapshot row", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-1",
      title: "Empty dishwasher",
      is_recurring: true,
      due_date: "2026-04-18",
      due_time: "8:00 AM",
      _completing: true,
    }]);
    await completeTask("u1", "td-1");

    const rows = await listCompletedTasks(testState.db.current, "u1");
    const snapshot = JSON.parse(rows[0].snapshot_json);

    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].todoist_id).toBe("td-1");
    expect(rows[0].due_date).toBe("2026-04-18");
    expect(snapshot).toMatchObject({
      id: "td-1",
      title: "Empty dishwasher",
      due_date: "2026-04-18",
      due_time: "8:00 AM",
      source: "todoist",
      is_recurring: true,
    });
    expect(snapshot._completing).toBeUndefined();
  });

  it("CTM with todoist_id: closes in Todoist, updates CTM, and records dedupe state", async () => {
    ctm.fetchCTMDeadlinesAll.mockResolvedValueOnce([{ id: 42, todoist_id: "td-1" }]);
    await completeTask("u1", "42");

    const rows = await listCompletedTasks(testState.db.current, "u1");

    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(ctm.updateCTMEventStatus).toHaveBeenCalledWith(42, "complete");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      todoist_id: "td-1",
      due_date: null,
      snapshot_json: null,
    });
  });

  it("skips tombstone row when matching a Todoist-only completion", async () => {
    await completeTask("u1", "td-1");

    // No live row → no Todoist close call
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
    expect(await listCompletedTasks(testState.db.current, "u1")).toEqual([]);
  });
});
