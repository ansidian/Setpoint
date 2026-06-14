import { describe, expect, it, vi } from "vitest";
import { applyTodoistReminderMutations } from "./applyTodoistReminderMutations.js";

const savedTask = {
  id: "task-1",
  title: "Pay invoice",
  due_date: "2026-05-12",
  due_time: "10:00 AM",
  class_name: "Errands",
};

const unsaved = (clientId, offsetMinutes) => ({
  clientId,
  offsetMinutes,
  remindAt: "2026-05-12T16:30:00.000Z",
  status: "pending",
});

describe("applyTodoistReminderMutations", () => {
  it("creates unsaved reminders and deletes removed ones, reporting counts", async () => {
    const createReminder = vi.fn().mockResolvedValue({});
    const deleteReminder = vi.fn().mockResolvedValue({});

    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [unsaved("c1", -30), unsaved("c2", -60)],
      removedReminderIds: ["r9"],
      createReminder,
      deleteReminder,
    });

    expect(createReminder).toHaveBeenCalledTimes(2);
    expect(deleteReminder).toHaveBeenCalledWith("r9");
    expect(result).toMatchObject({ created: 2, deleted: 1, errors: [] });
    expect(result.appliedReminders).toHaveLength(2);
  });

  it("collects a failed create without aborting and excludes it from applied state", async () => {
    const createReminder = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("boom"));
    const deleteReminder = vi.fn().mockResolvedValue({});

    const first = unsaved("c1", -30);
    const second = unsaved("c2", -60);
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [first, second],
      removedReminderIds: [],
      createReminder,
      deleteReminder,
    });

    // Second create failed but the loop continued and still returned state.
    expect(createReminder).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ op: "create", reminder: second, message: "boom" }),
    ]);
    // Failed create is not live on the server, so it is excluded from projection.
    expect(result.appliedReminders).toEqual([first]);
  });

  it("collects a failed delete without aborting the create that follows it", async () => {
    const createReminder = vi.fn().mockResolvedValue({});
    const deleteReminder = vi.fn().mockRejectedValue(new Error("nope"));

    const draft = unsaved("c1", -30);
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [draft],
      removedReminderIds: ["r1"],
      createReminder,
      deleteReminder,
    });

    // Delete failed, but the create still ran and the helper still returned.
    expect(createReminder).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(0);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ op: "delete", id: "r1", message: "nope" }),
    ]);
    expect(result.appliedReminders).toEqual([draft]);
  });

  it("keeps already-saved reminders in applied state without re-creating them", async () => {
    const createReminder = vi.fn().mockResolvedValue({});
    const deleteReminder = vi.fn().mockResolvedValue({});

    const savedReminder = { id: "saved-1", offsetMinutes: -10, status: "pending" };
    const result = await applyTodoistReminderMutations({
      savedTask,
      todoistReminders: [savedReminder, unsaved("c1", -30)],
      removedReminderIds: [],
      createReminder,
      deleteReminder,
    });

    expect(createReminder).toHaveBeenCalledTimes(1);
    expect(result.appliedReminders).toContain(savedReminder);
  });
});
