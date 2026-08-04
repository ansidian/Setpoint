import { describe, expect, it } from "vitest";
import { applyTodoistReminderMutations } from "./applyTodoistReminderMutations";
import type { TodoistReminderEntry } from "./types";

const savedTask = {
  id: "task-1",
  title: "Pay invoice",
  due_date: "2026-05-12",
  due_time: "10:00 AM",
  class_name: "Errands",
};

const unsaved = (clientId: string, offsetMinutes: number): TodoistReminderEntry => ({
  clientId,
  offsetMinutes,
  remindAt: "2026-05-12T16:30:00.000Z",
  status: "pending",
});

describe("applyTodoistReminderMutations", () => {
  it("creates unsaved reminders and deletes removed ones, reporting counts", async () => {
    const createdPayloads: unknown[] = [];
    const deletedIds: string[] = [];

    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [unsaved("c1", -30), unsaved("c2", -60)],
      removedReminderIds: ["r9"],
      createReminder: async (payload) => { createdPayloads.push(payload); },
      deleteReminder: async (id) => { deletedIds.push(id); },
    });

    expect(createdPayloads).toHaveLength(2);
    expect(deletedIds).toEqual(["r9"]);
    expect(result).toMatchObject({ created: 2, deleted: 1, errors: [] });
    expect(result.appliedReminders).toHaveLength(2);
  });

  it("collects a failed create without aborting and excludes it from applied state", async () => {
    let createAttempt = 0;

    const first = unsaved("c1", -30);
    const second = unsaved("c2", -60);
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [first, second],
      removedReminderIds: [],
      createReminder: async () => {
        createAttempt += 1;
        if (createAttempt === 2) throw new Error("boom");
      },
      deleteReminder: async () => {},
    });

    // Second create failed but the loop continued and still returned state.
    expect(createAttempt).toBe(2);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ op: "create", reminder: second, message: "boom" }),
    ]);
    // Failed create is not live on the server, so it is excluded from projection.
    expect(result.appliedReminders).toEqual([first]);
  });

  it("collects a failed delete without aborting the create that follows it", async () => {
    const createdPayloads: unknown[] = [];

    const draft = unsaved("c1", -30);
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [draft],
      removedReminderIds: ["r1"],
      createReminder: async (payload) => { createdPayloads.push(payload); },
      deleteReminder: async () => { throw new Error("nope"); },
    });

    // Delete failed, but the create still ran and the helper still returned.
    expect(createdPayloads).toHaveLength(1);
    expect(result.deleted).toBe(0);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ op: "delete", id: "r1", message: "nope" }),
    ]);
    expect(result.appliedReminders).toEqual([draft]);
  });

  it("keeps already-saved reminders in applied state without re-creating them", async () => {
    const createdPayloads: unknown[] = [];

  const savedReminder: TodoistReminderEntry = { id: "saved-1", offsetMinutes: -10, status: "pending" };
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [savedReminder, unsaved("c1", -30)],
      removedReminderIds: [],
      createReminder: async (payload) => { createdPayloads.push(payload); },
      deleteReminder: async () => {},
    });

    expect(createdPayloads).toHaveLength(1);
    expect(result.appliedReminders).toContain(savedReminder);
  });
});
