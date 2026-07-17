import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompletedTasksTestDb,
  listCompletedTasks,
  seedCompletedTask,
} from "../test-utils/completed-tasks-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.ts", () => ({
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
vi.mock("../reminders/reminder-service.js", () => ({
  deleteSourceReminders: vi.fn(),
  recomputeUnsentRemindersForSource: vi.fn(),
}));

const todoist = await import("./todoist.js");
const reminderService = await import("../reminders/reminder-service.js");
const {
  completeDeadlineOccurrence,
  createDeadline,
  deleteDeadline,
  updateDeadline,
} = await import("./tasks-service.js");

beforeEach(async () => {
  testState.db.current = await createCompletedTasksTestDb();
  Object.values(todoist).forEach((fn) => fn.mockReset?.());
  Object.values(reminderService).forEach((fn) => fn.mockReset?.());
  todoist.fetchTodoistTasksAll.mockResolvedValue([]);
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("deadline-domain mutations", () => {
  it("creates Todoist-backed deadlines from domain fields", async () => {
    todoist.createTodoistTask.mockResolvedValueOnce({ id: "td-new", title: "Pay invoice" });

    const result = await createDeadline("u1", {
      title: "Pay invoice",
      description: "Attach receipt",
      dueDate: "2026-05-20",
      dueTime: "3:00 PM",
      projectId: "project-1",
      labelIds: ["finance"],
      priority: 2,
    });

    expect(result).toMatchObject({ id: "td-new" });
    expect(todoist.createTodoistTask).toHaveBeenCalledWith("u1", {
      content: "Pay invoice",
      description: "Attach receipt",
      due_string: "2026-05-20 3:00 PM",
      labels: ["finance"],
      priority: 2,
      project_id: "project-1",
    });
  });

  it("rejects legacy Todoist payload fields on deadline creation", async () => {
    await expect(createDeadline("u1", { content: "Old shape" })).rejects.toMatchObject({
      message: "Use deadline-domain fields instead of content",
      status: 400,
    });

    expect(todoist.createTodoistTask).not.toHaveBeenCalled();
  });

  it("updates Todoist-backed deadlines through domain fields only", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({ id: "td-1", title: "Renamed", due_date: null });

    await updateDeadline("u1", "td-1", {
      title: "Renamed",
      dueString: "tomorrow at 9am",
      labelIds: [],
    });

    expect(todoist.updateTodoistTask).toHaveBeenCalledWith("u1", "td-1", {
      content: "Renamed",
      due_string: "tomorrow at 9am",
      labels: [],
    });
  });

  it("rejects an explicit empty title on update instead of blanking the Todoist title", async () => {
    await expect(updateDeadline("u1", "td-1", { title: "   " })).rejects.toMatchObject({
      message: "Deadline title is required",
      status: 400,
    });

    expect(todoist.updateTodoistTask).not.toHaveBeenCalled();
  });

  it("deletes Todoist-backed deadlines and local reminders", async () => {
    await deleteDeadline("u1", "td-1");

    expect(todoist.deleteTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
    });
  });

  it("requires an explicit ISO occurrence date before reading Todoist state", async () => {
    await expect(completeDeadlineOccurrence("u1", "td-1", "05/12/2026")).rejects.toMatchObject({
      message: "Deadline occurrence date must be YYYY-MM-DD",
      status: 400,
    });

    expect(todoist.fetchTodoistTasksAll).not.toHaveBeenCalled();
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
  });

  it("treats an existing completed occurrence as idempotent", async () => {
    await seedCompletedTask(testState.db.current, {
      user_id: "u1",
      todoist_id: "td-rec",
      due_date: "2026-05-12",
    });

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12");

    expect(result).toEqual({
      completed: true,
      alreadyCompleted: true,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    expect(todoist.fetchTodoistTasksAll).not.toHaveBeenCalled();
    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
  });

  it("rejects completing a date that is not the active Todoist occurrence", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-rec",
      title: "Daily review",
      due_date: "2026-05-13",
      status: "incomplete",
    }]);

    await expect(completeDeadlineOccurrence("u1", "td-rec", "2026-05-12")).rejects.toMatchObject({
      message: "Deadline occurrence is not active for that date",
      status: 409,
    });

    expect(todoist.completeTodoistTask).not.toHaveBeenCalled();
    expect(await listCompletedTasks(testState.db.current, "u1")).toEqual([]);
  });

  it("does not discard a completed close when post-close reminder cleanup fails (P2-30 claim + P3-64 commit-point)", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-rec",
      title: "Daily review",
      due_date: "2026-05-12",
      status: "incomplete",
      is_recurring: true,
    }]);

    // The completion is recorded by the pre-close atomic claim (P2-30). The remote
    // /close then succeeds, but the post-close reminder cleanup throws (P3-64's
    // "/close is the commit point" failure window). The completion must survive.
    reminderService.deleteSourceReminders.mockRejectedValueOnce(new Error("disk I/O error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12");

    // The remote close already happened, so the completion must not be lost.
    expect(result).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-rec");
    // The pre-close claim persisted the completion row, so the occurrence is
    // recorded even though the post-close reminder cleanup threw.
    expect(await listCompletedTasks(testState.db.current, "u1")).toHaveLength(1);
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-rec",
      unsentOnly: true,
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not discard a completed close when reminder cleanup fails after /close", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-rec",
      title: "Daily review",
      due_date: "2026-05-12",
      status: "incomplete",
      is_recurring: true,
    }]);
    reminderService.deleteSourceReminders.mockRejectedValueOnce(new Error("reminders down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12");

    expect(result).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    // The tombstone is still durably recorded despite the reminder failure.
    expect(await listCompletedTasks(testState.db.current, "u1")).toMatchObject([
      { todoist_id: "td-rec", due_date: "2026-05-12" },
    ]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("completes and stores the matching active occurrence", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-rec",
      title: "Daily review",
      due_date: "2026-05-12",
      due_time: "9:00 AM",
      status: "incomplete",
      is_recurring: true,
    }]);

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12");

    expect(result).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-rec");
    expect(await listCompletedTasks(testState.db.current, "u1")).toMatchObject([
      { todoist_id: "td-rec", due_date: "2026-05-12" },
    ]);
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-rec",
      unsentOnly: true,
    });
  });

  it("does not double-close a recurring occurrence under concurrent completion (P2-30)", async () => {
    todoist.fetchTodoistTasksAll.mockResolvedValue([{
      id: "td-rec",
      title: "Daily review",
      due_date: "2026-05-12",
      due_time: "9:00 AM",
      status: "incomplete",
      is_recurring: true,
    }]);

    const [a, b] = await Promise.all([
      completeDeadlineOccurrence("u1", "td-rec", "2026-05-12"),
      completeDeadlineOccurrence("u1", "td-rec", "2026-05-12"),
    ]);

    // Exactly one request closes the Todoist task (which advances the recurrence);
    // the other loses the atomic claim and short-circuits as alreadyCompleted.
    expect(todoist.completeTodoistTask).toHaveBeenCalledTimes(1);
    expect([a.alreadyCompleted, b.alreadyCompleted].sort()).toEqual([false, true]);
    expect(await listCompletedTasks(testState.db.current, "u1")).toMatchObject([
      { todoist_id: "td-rec", due_date: "2026-05-12" },
    ]);
  });
});

describe("updateDeadline", () => {
  it("recomputes unsent Todoist reminders when the due date changes through EA", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: "2026-05-12",
      due_time: "10:00 AM",
      class_name: "Inbox",
    });

    const task = await updateDeadline("u1", "td-1", { dueString: "2026-05-12 at 10:00 AM" });

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

    await updateDeadline("u1", "td-1", { dueString: "" });

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

    await updateDeadline("u1", "td-1", { dueString: "2026-05-12" });

    expect(reminderService.recomputeUnsentRemindersForSource).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: "2026-05-12T16:00:00.000Z",
    });
  });
});

describe("deleteDeadline", () => {
  it("deletes local reminders when deleting a Todoist task through EA", async () => {
    await deleteDeadline("u1", "td-1");

    expect(todoist.deleteTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith({
      userId: "u1",
      sourceType: "todoist_task",
      sourceItemId: "td-1",
    });
  });
});
