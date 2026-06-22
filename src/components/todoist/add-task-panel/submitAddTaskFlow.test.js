import { describe, expect, it, vi } from "vitest";
import { submitAddTaskFlow } from "./submitAddTaskFlow.js";

function baseArgs(overrides = {}) {
  return {
    parsed: { stripped: "Call dentist", recurrenceDraft: null, recurringDueString: null, dateDueString: null, datePhrase: null },
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
    createDeadline: vi.fn().mockResolvedValue({ id: "new-1", title: "Call dentist" }),
    updateDeadline: vi.fn().mockResolvedValue({ id: "upd-1" }),
    createReminder: vi.fn(),
    deleteReminder: vi.fn(),
    parseTokensWithChrono: vi.fn(),
    isChronoReady: vi.fn(() => true),
    ...overrides,
  };
}

describe("submitAddTaskFlow routing", () => {
  it("creates a new task and returns it as the committed task", async () => {
    const args = baseArgs();
    const result = await submitAddTaskFlow(args);

    expect(args.createDeadline).toHaveBeenCalledTimes(1);
    expect(args.createDeadline).toHaveBeenCalledWith(expect.objectContaining({
      title: "Call dentist",
      dueString: "tomorrow 9am",
    }));
    expect(args.updateDeadline).not.toHaveBeenCalled();
    expect(args.parseTokensWithChrono).not.toHaveBeenCalled();
    expect(result.committedTask).toEqual({ id: "new-1", title: "Call dentist" });
    // No reminders => projected task is the saved task untouched.
    expect(result.projectedTask).toBe(result.savedTask);
    expect(result.errors).toEqual([]);
  });

  it("updates the existing task in edit mode and merges over editingTask", async () => {
    const editingTask = { id: "todo-1", title: "Old", description: "" };
    const args = baseArgs({ isEdit: true, editingTask });
    const result = await submitAddTaskFlow(args);

    expect(args.updateDeadline).toHaveBeenCalledWith("todo-1", expect.objectContaining({ title: "Call dentist" }));
    expect(args.createDeadline).not.toHaveBeenCalled();
    expect(result.savedTask).toMatchObject({ id: "todo-1", title: "Old" });
    // Edit never sets the committed-create marker.
    expect(result.committedTask).toBeNull();
  });

  it("updates the already-committed task on retry (no duplicate create)", async () => {
    const committedTask = { id: "new-1", title: "Call dentist" };
    const args = baseArgs({ committedTask });
    const result = await submitAddTaskFlow(args);

    expect(args.createDeadline).not.toHaveBeenCalled();
    expect(args.updateDeadline).toHaveBeenCalledWith("new-1", expect.objectContaining({ title: "Call dentist" }));
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
      parsed: { stripped: "Water plants", recurrenceDraft: { some: "draft" }, recurringDueString: null, dateDueString: null, datePhrase: null },
      input: "Water plants every weekday at 9am",
      resolvedDue: null,
      isChronoReady: vi.fn(() => false),
      parseTokensWithChrono: vi.fn().mockResolvedValue({
        stripped: "Water plants",
        recurringDueString: "every weekday at 9am",
        dateDueString: null,
        datePhrase: null,
      }),
    });

    await submitAddTaskFlow(args);

    expect(args.parseTokensWithChrono).toHaveBeenCalledTimes(1);
    expect(args.parseTokensWithChrono).toHaveBeenCalledWith(
      "Water plants every weekday at 9am",
      [],
      [],
      { seededDueDate: null },
    );
    expect(args.createDeadline).toHaveBeenCalledWith(expect.objectContaining({
      title: "Water plants",
      dueString: "every weekday at 9am",
    }));
  });

  it("skips the chrono re-parse when chrono is already warm", async () => {
    const args = baseArgs({
      parsed: { stripped: "Water plants", recurrenceDraft: { some: "draft" }, recurringDueString: "every weekday", dateDueString: null, datePhrase: null },
      input: "Water plants every weekday",
      resolvedDue: "every weekday",
      isChronoReady: vi.fn(() => true),
    });

    await submitAddTaskFlow(args);

    expect(args.parseTokensWithChrono).not.toHaveBeenCalled();
    expect(args.createDeadline).toHaveBeenCalledWith(expect.objectContaining({ dueString: "every weekday" }));
  });

  it("skips the chrono re-parse for non-recurring input even when chrono is cold", async () => {
    const args = baseArgs({
      parsed: { stripped: "Call dentist", recurrenceDraft: null, recurringDueString: null, dateDueString: null, datePhrase: null },
      isChronoReady: vi.fn(() => false),
    });

    await submitAddTaskFlow(args);

    expect(args.parseTokensWithChrono).not.toHaveBeenCalled();
  });
});

describe("submitAddTaskFlow reminder mutations", () => {
  it("creates pending reminder drafts after the deadline, counts them, and projects reminder state", async () => {
    const createReminder = vi.fn().mockResolvedValue({ reminder: { id: "rem-1" } });
    const args = baseArgs({
      todoistReminders: [{ clientId: "c1", status: "pending", offsetMinutes: -30 }],
      createReminder,
    });

    const result = await submitAddTaskFlow(args);

    expect(createReminder).toHaveBeenCalledTimes(1);
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
    expect(result.errors[0].op).toBe("create");
    // The deadline create still committed and is returned for the no-duplicate retry.
    expect(result.committedTask).toEqual({ id: "new-1", title: "Call dentist" });
  });

  it("deletes removed reminders, counts them, and still projects (deleted-only change)", async () => {
    const deleteReminder = vi.fn().mockResolvedValue({ success: true });
    const args = baseArgs({ removedReminderIds: ["rem-old"], deleteReminder });

    const result = await submitAddTaskFlow(args);

    expect(deleteReminder).toHaveBeenCalledWith("rem-old");
    expect(result.deleted).toBe(1);
    expect(result.projectedTask).not.toBe(result.savedTask);
  });
});
