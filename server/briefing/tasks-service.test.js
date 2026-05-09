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
  updateCTMEventStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./reminder-service.js", () => ({
  deleteSourceReminders: vi.fn(),
  recomputeUnsentRemindersForSource: vi.fn(),
}));

const todoist = await import("./todoist.js");
const ctm = await import("./ctm.js");
const reminderService = await import("./reminder-service.js");
const { completeTask, deleteTask, updateCTMStatus, updateTask } = await import("./tasks-service.js");

beforeEach(async () => {
  testState.db.current = await createCompletedTasksTestDb();
  Object.values(todoist).forEach((fn) => fn.mockReset?.());
  ctm.updateCTMEventStatus.mockClear();
  Object.values(reminderService).forEach((fn) => fn.mockReset?.());
  todoist.fetchTodoistTasksAll.mockResolvedValue([]);
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("completeTask", () => {
  it("does not complete CTM-only tasks through the Todoist completion endpoint", async () => {
    await completeTask("u1", "42");

    expect(ctm.updateCTMEventStatus).not.toHaveBeenCalled();
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

  it("deletes unsent reminders after completing a Todoist task", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([
      { id: "td-1", title: "One off", due_date: "2026-04-18", source: "todoist" },
    ]);

    await completeTask("u1", "td-1");

    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
      unsentOnly: true,
    });
  });

  it("updates CTM status without closing or tombstoning a Todoist task", async () => {
    await updateCTMStatus("u1", "42", "complete");

    expect(ctm.updateCTMEventStatus).toHaveBeenCalledWith("42", "complete");
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
    expect(await listCompletedTasks(testState.db.current, "u1")).toEqual([]);
  });

  it("preserves string CTM event ids when updating status", async () => {
    await updateCTMStatus("u1", "canvas-assignment-42", "complete");

    expect(ctm.updateCTMEventStatus).toHaveBeenCalledWith("canvas-assignment-42", "complete");
  });

  it("rejects invalid CTM statuses", async () => {
    await expect(updateCTMStatus("u1", "42", "blocked")).rejects.toMatchObject({
      message: "Invalid status",
      status: 400,
    });
    expect(ctm.updateCTMEventStatus).not.toHaveBeenCalled();
  });

  it("skips tombstone row when matching a Todoist-only completion", async () => {
    await completeTask("u1", "td-1");

    // No live row → no Todoist close call
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
    expect(await listCompletedTasks(testState.db.current, "u1")).toEqual([]);
  });
});

describe("updateTask", () => {
  it("recomputes unsent Todoist reminders when the due date changes through EA", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: "2026-05-12",
      due_time: "10:00 AM",
      class_name: "Inbox",
    });

    const task = await updateTask("u1", "td-1", { due_string: "2026-05-12 at 10:00 AM" });

    expect(task.id).toBe("td-1");
    expect(reminderService.recomputeUnsentRemindersForSource).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-12T17:00:00.000Z",
    });
  });

  it("deletes unsent reminders when the task no longer has a due anchor", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: null,
      due_time: null,
    });

    await updateTask("u1", "td-1", { due_string: "" });

    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
      unsentOnly: true,
    });
  });

  it("anchors date-only Todoist reminders at 9 AM Pacific", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: "2026-05-12",
      due_time: null,
    });

    await updateTask("u1", "td-1", { due_string: "2026-05-12" });

    expect(reminderService.recomputeUnsentRemindersForSource).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: "2026-05-12T16:00:00.000Z",
    });
  });
});

describe("deleteTask", () => {
  it("deletes local reminders when deleting a Todoist task through EA", async () => {
    await deleteTask("u1", "td-1");

    expect(todoist.deleteTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
    });
  });
});
