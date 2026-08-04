import { describe, expect, it, vi } from "vitest";
import { submitAddTaskFlow } from "./submitAddTaskFlow";
import type { TodoistTask } from "../../../../shared/types/tasks";
import type { ParsedTodoistTokens } from "./types";

function parsedTokens(overrides: Partial<ParsedTodoistTokens> = {}): ParsedTodoistTokens {
  return {
    priority: null,
    project: null,
    labels: [],
    datePhrase: null,
    dateDueString: null,
    dateFormatted: null,
    duePreview: null,
    recurrenceDraft: null,
    recurrenceSummary: null,
    recurringDueString: null,
    stripped: "Call dentist",
    ...overrides,
  };
}

function task(overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: "new-1",
    title: "Call dentist",
    due_date: null,
    due_time: null,
    class_name: "Inbox",
    class_color: "",
    points_possible: null,
    source: "todoist",
    description: "",
    url: null,
    priority: 4,
    labels: [],
    is_recurring: false,
    ...overrides,
  };
}

function baseArgs(overrides = {}) {
  const operations = {
    creates: [] as unknown[],
    updates: [] as Array<{ id: string; payload: unknown }>,
    parsedInputs: [] as unknown[][],
  };
  return {
    parsed: parsedTokens(),
    resolvedDue: "tomorrow 9am",
    overrides: { due: false },
    input: "Call dentist tomorrow 9am",
    projects: [],
    labels: [],
    seededNlpDueDate: null,
    seededCreateDue: null,
    description: "",
    resolvedProject: null,
    resolvedPriority: null,
    resolvedLabels: [],
    isEdit: false,
    editingTask: null,
    todoistReminders: [],
    removedReminderIds: [],
    committedTask: null,
    createDeadline: async (payload: unknown) => { operations.creates.push(payload); return task(); },
    updateDeadline: async (id: string, payload: unknown) => { operations.updates.push({ id, payload }); return task({ id: "upd-1" }); },
    createReminder: vi.fn(),
    deleteReminder: vi.fn(),
    parseTokensWithChrono: async (...args: unknown[]) => { operations.parsedInputs.push(args); return parsedTokens(); },
    isChronoReady: vi.fn(() => true),
    operations,
    ...overrides,
  };
}

describe("submitAddTaskFlow routing", () => {
  it("creates a new task and returns it as the committed task", async () => {
    const args = baseArgs();
    const result = await submitAddTaskFlow(args);

    expect(args.operations.creates).toEqual([expect.objectContaining({
      title: "Call dentist",
      dueString: "tomorrow 9am",
    })]);
    expect(args.operations.updates).toEqual([]);
    expect(args.operations.parsedInputs).toEqual([]);
    expect(result.committedTask).toMatchObject({ id: "new-1", title: "Call dentist" });
    // No reminders => projected task is the saved task untouched.
    expect(result.projectedTask).toBe(result.savedTask);
    expect(result.errors).toEqual([]);
  });

  it("updates the existing task in edit mode and merges over editingTask", async () => {
    const editingTask = { id: "todo-1", title: "Old", description: "" };
    const args = baseArgs({ isEdit: true, editingTask });
    const result = await submitAddTaskFlow(args);

    expect(args.operations.updates).toEqual([{ id: "todo-1", payload: expect.objectContaining({ title: "Call dentist" }) }]);
    expect(args.operations.creates).toEqual([]);
    expect(result.savedTask).toMatchObject({ id: "todo-1", title: "Call dentist" });
    // Edit never sets the committed-create marker.
    expect(result.committedTask).toBeNull();
  });

  it("updates the already-committed task on retry (no duplicate create)", async () => {
    const committedTask = task();
    const args = baseArgs({ committedTask });
    const result = await submitAddTaskFlow(args);

    expect(args.operations.creates).toEqual([]);
    expect(args.operations.updates).toEqual([{ id: "new-1", payload: expect.objectContaining({ title: "Call dentist" }) }]);
    expect(result.committedTask).toBe(committedTask);
  });

  it("propagates a deadline-create failure (does not swallow)", async () => {
    const args = baseArgs({ createDeadline: vi.fn().mockRejectedValue(new Error("Todoist unavailable")) });
    await expect(submitAddTaskFlow(args)).rejects.toThrow("Todoist unavailable");
  });
});

describe("submitAddTaskFlow chrono re-parse gate", () => {
  it("re-parses recurring input with chrono when chrono is cold, and persists the recomputed due", async () => {
    const args = baseArgs({
      overrides: { due: false },
      parsed: parsedTokens({ stripped: "Water plants", recurrenceDraft: { some: "draft" } }),
      input: "Water plants every weekday at 9am",
      resolvedDue: null,
      isChronoReady: vi.fn(() => false),
      parseTokensWithChrono: async (...callArgs: unknown[]) => {
        argsForChrono.push(callArgs);
        return parsedTokens({
        stripped: "Water plants",
        recurringDueString: "every weekday at 9am",
        });
      },
    });

    const argsForChrono: unknown[][] = [];

    await submitAddTaskFlow(args);

    expect(argsForChrono).toEqual([[
      "Water plants every weekday at 9am",
      [],
      [],
      { seededDueDate: null },
    ]]);
    expect(args.operations.creates).toEqual([expect.objectContaining({
      title: "Water plants",
      dueString: "every weekday at 9am",
    })]);
  });

  it("skips the chrono re-parse when chrono is already warm", async () => {
    const args = baseArgs({
      parsed: parsedTokens({ stripped: "Water plants", recurrenceDraft: { some: "draft" }, recurringDueString: "every weekday" }),
      input: "Water plants every weekday",
      resolvedDue: "every weekday",
      isChronoReady: vi.fn(() => true),
    });

    await submitAddTaskFlow(args);

    expect(args.operations.parsedInputs).toEqual([]);
    expect(args.operations.creates).toEqual([expect.objectContaining({ dueString: "every weekday" })]);
  });

  it("skips the chrono re-parse for non-recurring input even when chrono is cold", async () => {
    const args = baseArgs({
      parsed: parsedTokens(),
      isChronoReady: vi.fn(() => false),
    });

    await submitAddTaskFlow(args);

    expect(args.operations.parsedInputs).toEqual([]);
  });
});

describe("submitAddTaskFlow reminder mutations", () => {
  it("creates pending reminder drafts after the deadline, counts them, and projects reminder state", async () => {
    const reminderPayloads: unknown[] = [];
    const args = baseArgs({
      todoistReminders: [{ clientId: "c1", status: "pending", offsetMinutes: -30 }],
      createReminder: async (payload: unknown) => { reminderPayloads.push(payload); return { reminder: { id: "rem-1" } }; },
    });

    const result = await submitAddTaskFlow(args);

    expect(reminderPayloads).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual([]);
    // shouldProjectReminderState gate fired => projection applied (a fresh object
    // carrying reminderState), not the bare savedTask.
    expect(result.projectedTask).not.toBe(result.savedTask);
    expect(result.projectedTask.reminderState).toBeDefined();
  });

  it("collects a reminder-create failure without throwing or abandoning the committed task", async () => {
    const createReminder = vi.fn().mockRejectedValue(new Error("Reminder service down"));
    const args = baseArgs({
      todoistReminders: [{ clientId: "c1", status: "pending", offsetMinutes: -30 }],
      createReminder,
    });

    const result = await submitAddTaskFlow(args);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.op).toBe("create");
    // The deadline create still committed and is returned for the no-duplicate retry.
    expect(result.committedTask).toMatchObject({ id: "new-1", title: "Call dentist" });
  });

});
