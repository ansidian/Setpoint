import { describe, expect, it } from "vitest";
import {
  buildTodoistReminderCreatePayload,
  createTodoistReminderDraftFromCustom,
  createTodoistReminderDraftFromOffset,
  formatTodoistReminderLabel,
  getTodoistReminderPresetState,
  projectTodoistReminderChips,
  todoistReminderSourceFromTask,
} from "./todoistReminderModel";

describe("todoistReminderModel", () => {
  it("anchors date-only Todoist tasks to 9 AM Pacific", () => {
    const source = todoistReminderSourceFromTask({
      id: "task-1",
      title: "Submit worksheet",
      due_date: "2026-05-12",
      due_time: null,
      class_name: "School",
    });

    expect(source).toMatchObject({
      sourceType: "todoist_task",
      sourceItemId: "task-1",
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: "2026-05-12T16:00:00.000Z",
      payloadSnapshot: {
        title: "Submit worksheet",
        context: "School",
      },
    });
  });

  it("anchors timed Todoist tasks to their due datetime", () => {
    const source = todoistReminderSourceFromTask({
      id: "task-2",
      title: "Call dentist",
      due_date: "2026-01-08",
      due_time: "7:30 AM",
    });

    expect(source).toMatchObject({
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-01-08T15:30:00.000Z",
    });
  });

  it("creates pending reminders from offsets and blocks duplicate offsets", () => {
    const task = {
      id: "task-3",
      title: "Pay invoice",
      due_date: "2026-05-12",
      due_time: "10:00 AM",
    };
    const first = createTodoistReminderDraftFromOffset({
      task,
      offsetMinutes: -30,
      now: new Date("2026-05-12T15:00:00.000Z"),
    });
    const duplicate = createTodoistReminderDraftFromOffset({
      task,
      offsetMinutes: -30,
      now: new Date("2026-05-12T15:00:00.000Z"),
      existingReminders: [first],
    });

    expect(first).toMatchObject({
      offsetMinutes: -30,
      remindAt: "2026-05-12T16:30:00.000Z",
      status: "pending",
      blocked: false,
    });
    expect(duplicate).toMatchObject({
      offsetMinutes: -30,
      remindAt: "2026-05-12T16:30:00.000Z",
      blocked: true,
      blockReason: "duplicate",
    });
  });

  it("creates a custom reminder offset from the Todoist anchor", () => {
    const reminder = createTodoistReminderDraftFromCustom({
      task: {
        id: "task-4",
        title: "Review report",
        due_date: "2026-05-12",
        due_time: null,
      },
      reminderDate: "2026-05-12",
      reminderTime: "08:15",
      now: new Date("2026-05-11T15:00:00.000Z"),
    });

    expect(reminder).toMatchObject({
      offsetMinutes: -45,
      remindAt: "2026-05-12T15:15:00.000Z",
      blocked: false,
    });
  });

  it("blocks reminder times that are already in the past", () => {
    const reminder = createTodoistReminderDraftFromOffset({
      task: {
        id: "task-5",
        title: "Past reminder",
        due_date: "2026-05-12",
        due_time: "10:00 AM",
      },
      offsetMinutes: -30,
      now: new Date("2026-05-12T16:45:00.000Z"),
    });

    expect(reminder).toMatchObject({
      blocked: true,
      blockReason: "past",
    });
  });

  it("projects disabled preset state for duplicate offsets and past task anchors", () => {
    const task = {
      id: "task-5b",
      title: "Past task",
      due_date: "2026-05-12",
      due_time: "10:00 AM",
    };

    expect(getTodoistReminderPresetState({
      task,
      offsetMinutes: -30,
      now: new Date("2026-05-12T15:00:00.000Z"),
      existingReminders: [{ offsetMinutes: -30, status: "pending" }],
    })).toMatchObject({
      disabled: true,
      reason: "duplicate",
      remindAt: "2026-05-12T16:30:00.000Z",
    });

    expect(getTodoistReminderPresetState({
      task,
      offsetMinutes: -10,
      now: new Date("2026-05-12T17:30:00.000Z"),
      existingReminders: [],
    })).toMatchObject({
      disabled: true,
      reason: "past",
      remindAt: "2026-05-12T16:50:00.000Z",
    });

    expect(getTodoistReminderPresetState({
      task,
      offsetMinutes: -10,
      now: new Date("2026-05-12T15:00:00.000Z"),
      existingReminders: [],
    })).toMatchObject({
      disabled: false,
      reason: null,
      remindAt: "2026-05-12T16:50:00.000Z",
    });
  });

  it("builds create payloads and projects sent reminders as muted chips", () => {
    const task = {
      id: "task-6",
      title: "File receipt",
      due_date: "2026-05-12",
      due_time: "10:00 AM",
      class_name: "Errands",
      url: "https://todoist.example/task-6",
    };
    const reminder = createTodoistReminderDraftFromOffset({
      task,
      offsetMinutes: -60,
      now: new Date("2026-05-12T15:00:00.000Z"),
    });

    expect(buildTodoistReminderCreatePayload({ task, reminder })).toMatchObject({
      sourceType: "todoist_task",
      sourceItemId: "task-6",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-05-12T17:00:00.000Z",
      offsetMinutes: -60,
      payloadSnapshot: {
        title: "File receipt",
        context: "Errands",
        url: "https://todoist.example/task-6",
      },
    });
    expect(formatTodoistReminderLabel({ offsetMinutes: -1440 })).toBe("1 day before");
    expect(projectTodoistReminderChips([
      { id: "sent-1", offset_minutes: -60, status: "sent" },
    ])).toEqual([
      expect.objectContaining({
        key: "sent-1",
        id: "sent-1",
        label: "1 hour before",
        sent: true,
      }),
    ]);
  });
});
