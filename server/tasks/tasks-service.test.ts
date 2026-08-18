import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement } from "@libsql/client";
import type { DeadlineMutationRequest } from "../../shared/types/tasks.ts";
import {
  createCompletedTasksTestDb,
  listCompletedTasks,
  seedCompletedTask,
} from "../test-utils/completed-tasks-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

// test-architecture: allow-boundary-mock -- Completion claims run against a migrated ephemeral database redirected through the shared production connection seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement | string) => testState.db.current.execute(statement),
    batch: (statements: InStatement[]) => testState.db.current.batch(statements),
  },
}));
// test-architecture: allow-boundary-mock -- Todoist task mutation is the outbound provider boundary; the deadline use case controls provider successes/failures while asserting results and durable claims.
vi.mock("./todoist.ts", () => ({
  completeTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
  fetchTodoistProjects: vi.fn(),
  fetchTodoistLabels: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
}));
type TestMock = ReturnType<typeof vi.fn>;
const todoist = await import("./todoist.ts") as unknown as {
  completeTodoistTask: TestMock;
  deleteTodoistTask: TestMock;
  fetchTodoistProjects: TestMock;
  fetchTodoistLabels: TestMock;
  fetchTodoistTasksAll: TestMock;
  createTodoistTask: TestMock;
  updateTodoistTask: TestMock;
};
const {
  completeDeadlineOccurrence,
  createDeadline,
  deleteDeadline,
  updateDeadline,
} = await import("./tasks-service.ts");

beforeEach(async () => {
  testState.db.current = await createCompletedTasksTestDb();
  Object.values(todoist).forEach((fn) => fn.mockReset?.());
  todoist.fetchTodoistTasksAll.mockResolvedValue([]);
});

async function seedReminder({
  id = "rem-1",
  sourceItemId = "td-1",
  status = "pending",
  offsetMinutes = 60,
}: {
  id?: string;
  sourceItemId?: string;
  status?: "pending" | "sent";
  offsetMinutes?: number;
} = {}) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_reminders
            (id, user_id, source_type, source_item_id, anchor_kind, anchor_at,
             offset_minutes, remind_at, status)
          VALUES (?, 'u1', 'todoist_task', ?, 'todoist_due_datetime', ?, ?, ?, ?)`,
    args: [
      id,
      sourceItemId,
      "2026-05-11T17:00:00.000Z",
      offsetMinutes,
      "2026-05-11T16:00:00.000Z",
      status,
    ],
  });
}

async function listReminders(sourceItemId = "td-1") {
  const result = await testState.db.current.execute({
    sql: `SELECT id, anchor_kind, anchor_at, remind_at, status
          FROM ea_reminders
          WHERE user_id = 'u1' AND source_item_id = ?
          ORDER BY id`,
    args: [sourceItemId],
  });
  return result.rows;
}

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null as unknown as Client;
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
    // test-architecture: allow-boundary-interaction -- Todoist create is an outbound provider write; its exact domain-to-provider payload is the compatibility contract.
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
    const legacyPayload = { content: "Old shape" } as unknown as DeadlineMutationRequest;
    await expect(createDeadline("u1", legacyPayload)).rejects.toMatchObject({
      message: "Use deadline-domain fields instead of content",
      status: 400,
    });

    // test-architecture: allow-boundary-interaction -- Invalid legacy input must never issue an outbound Todoist create request.
    expect(todoist.createTodoistTask).not.toHaveBeenCalled();
  });

  it("updates Todoist-backed deadlines through domain fields only", async () => {
    todoist.updateTodoistTask.mockResolvedValueOnce({ id: "td-1", title: "Renamed", due_date: null });

    await updateDeadline("u1", "td-1", {
      title: "Renamed",
      dueString: "tomorrow at 9am",
      labelIds: [],
    });

    // test-architecture: allow-boundary-interaction -- Todoist update is an outbound provider write; the translated partial payload is its compatibility contract.
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

    // test-architecture: allow-boundary-interaction -- A blank title must fail before any outbound Todoist update can erase provider data.
    expect(todoist.updateTodoistTask).not.toHaveBeenCalled();
  });

  it("deletes Todoist-backed deadlines and local reminders", async () => {
    await seedReminder();
    await deleteDeadline("u1", "td-1");

    // test-architecture: allow-boundary-interaction -- Todoist delete is an outbound provider write and must target the exact owner/task identity.
    expect(todoist.deleteTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(await listReminders()).toEqual([]);
  });

  it("requires an explicit ISO occurrence date before reading Todoist state", async () => {
    await expect(completeDeadlineOccurrence("u1", "td-1", "05/12/2026")).rejects.toMatchObject({
      message: "Deadline occurrence date must be YYYY-MM-DD",
      status: 400,
    });

    // test-architecture: allow-boundary-interaction -- Invalid occurrence dates must fail before the provider-backed Todoist read boundary.
    expect(todoist.fetchTodoistTasksAll).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- Invalid occurrence dates must never issue an outbound Todoist close.
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
    // test-architecture: allow-boundary-interaction -- A durable completion claim must short-circuit before a provider-backed Todoist read.
    expect(todoist.fetchTodoistTasksAll).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- Idempotent durable completion must never duplicate the outbound Todoist close.
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

    // test-architecture: allow-boundary-interaction -- A mismatched active occurrence must never issue an outbound Todoist close.
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
    const failingReminderCleanup = vi.fn(async () => { throw new Error("disk I/O error"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12", {
      deleteReminders: failingReminderCleanup as never,
    });

    // The remote close already happened, so the completion must not be lost.
    expect(result).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    // test-architecture: allow-boundary-interaction -- Todoist close is the outbound provider commit point; it must target the claimed recurring task exactly once.
    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-rec", "2026-05-12");
    // The pre-close claim persisted the completion row, so the occurrence is
    // recorded even though the post-close reminder cleanup threw.
    expect(await listCompletedTasks(testState.db.current, "u1")).toHaveLength(1);
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
    const failingReminderCleanup = vi.fn(async () => { throw new Error("reminders down"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeDeadlineOccurrence("u1", "td-rec", "2026-05-12", {
      deleteReminders: failingReminderCleanup as never,
    });

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
    errorSpy.mockRestore();
  });

  it("completes and stores the matching active occurrence", async () => {
    await seedReminder({ id: "pending", sourceItemId: "td-rec", status: "pending" });
    await seedReminder({ id: "sent", sourceItemId: "td-rec", status: "sent" });
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
    // test-architecture: allow-boundary-interaction -- Todoist close is the outbound provider commit point and must target the active claimed occurrence.
    expect(todoist.completeTodoistTask).toHaveBeenCalledWith("u1", "td-rec", "2026-05-12");
    expect(await listCompletedTasks(testState.db.current, "u1")).toMatchObject([
      { todoist_id: "td-rec", due_date: "2026-05-12" },
    ]);
    expect(await listReminders("td-rec")).toEqual([
      expect.objectContaining({ id: "sent", status: "sent" }),
    ]);
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
    // test-architecture: allow-boundary-interaction -- Todoist close is an outbound write; the durable atomic claim must admit exactly one close under concurrency.
    expect(todoist.completeTodoistTask).toHaveBeenCalledTimes(1);
    expect([a.alreadyCompleted, b.alreadyCompleted].sort()).toEqual([false, true]);
    expect(await listCompletedTasks(testState.db.current, "u1")).toMatchObject([
      { todoist_id: "td-rec", due_date: "2026-05-12" },
    ]);
  });
});

describe("updateDeadline", () => {
  it("recomputes unsent Todoist reminders when the due date changes through EA", async () => {
    await seedReminder();
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: "2026-09-12",
      due_time: "10:00 AM",
      class_name: "Inbox",
    });

    const task = await updateDeadline("u1", "td-1", { dueString: "2026-09-12 at 10:00 AM" });

    expect(task.id).toBe("td-1");
    expect(await listReminders()).toEqual([
      expect.objectContaining({
        anchor_kind: "todoist_due_datetime",
        anchor_at: "2026-09-12T17:00:00.000Z",
      }),
    ]);
  });

  it("deletes unsent reminders when the task no longer has a due anchor", async () => {
    await seedReminder({ id: "pending", status: "pending" });
    await seedReminder({ id: "sent", status: "sent" });
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: null,
      due_time: null,
    });

    await updateDeadline("u1", "td-1", { dueString: "" });

    expect(await listReminders()).toEqual([
      expect.objectContaining({ id: "sent", status: "sent" }),
    ]);
  });

  it("anchors date-only Todoist reminders at 9 AM Pacific", async () => {
    await seedReminder();
    todoist.updateTodoistTask.mockResolvedValueOnce({
      id: "td-1",
      title: "Follow up",
      due_date: "2026-09-12",
      due_time: null,
    });

    await updateDeadline("u1", "td-1", { dueString: "2026-09-12" });

    expect(await listReminders()).toEqual([
      expect.objectContaining({
        anchor_kind: "todoist_date_9am_pacific",
        anchor_at: "2026-09-12T16:00:00.000Z",
      }),
    ]);
  });
});

describe("deleteDeadline", () => {
  it("deletes local reminders when deleting a Todoist task through EA", async () => {
    await seedReminder();
    await deleteDeadline("u1", "td-1");

    // test-architecture: allow-boundary-interaction -- Todoist delete is the outbound provider write for this deadline identity.
    expect(todoist.deleteTodoistTask).toHaveBeenCalledWith("u1", "td-1");
    expect(await listReminders()).toEqual([]);
  });
});
