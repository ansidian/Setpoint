import { describe, expect, it, vi } from "vitest";
import {
  deleteCalendarEventAction,
  saveCalendarEventAction,
} from "./calendarEventEditorActions";

describe("calendarEventEditorActions", () => {
  const draft = {
    accountId: "gmail-main",
    calendarId: "primary",
    title: "Ignored draft title",
    allDay: false,
    startDate: "2026-05-06",
    endDate: "2026-05-06",
    startTime: "09:00",
    endTime: "09:30",
    location: "Office",
    description: "Notes",
  };

  it("builds batch create requests and reports partial failures for review", async () => {
    const createdEvent = {
      id: "created-1",
      title: "Work",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const failedEntry = {
      input: {
        title: "Work",
        startDate: "2026-05-07",
        endDate: "2026-05-07",
        startTime: "09:00",
        endTime: "09:30",
      },
      code: "calendar_conflict",
      message: "That slot is unavailable.",
    };
    const client = {
      createBatch: vi.fn().mockResolvedValue({
        created: [{ event: createdEvent }],
        failed: [failedEntry],
      }),
    };

    const result = await saveCalendarEventAction({
      draft,
      batchDrafts: [
        {
          title: "",
          startDate: "2026-05-06",
          endDate: "2026-05-06",
          startTime: "09:00",
          endTime: "09:30",
        },
        failedEntry.input,
      ],
      effectiveTitle: "Work",
      intentMode: "batch",
    }, client);

    expect(client.createBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Work",
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        startTime: "09:00",
        endTime: "09:30",
      }),
      expect.objectContaining({
        title: "Work",
        startDate: "2026-05-07",
      }),
    ]);
    expect(result).toMatchObject({
      kind: "batch-create",
      createdEvents: [createdEvent],
      failed: [failedEntry],
      focusDate: "2026-05-06",
      shouldRefresh: true,
      shouldUpsert: false,
      errorCode: "calendar_conflict",
      errorMessage: "Created 1 event, but 1 still need review.",
    });
    expect(result.failedDrafts).toEqual([
      expect.objectContaining({
        title: "Work",
        startDate: "2026-05-07",
        error: "That slot is unavailable.",
      }),
    ]);
  });

  it("updates recurring events with scope metadata and asks the caller to refresh bounds", async () => {
    const editingEvent = {
      id: "event-1",
      etag: '"etag-1"',
      title: "Old work",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-05T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T16:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-05-05T16:00:00.000Z",
    };
    const savedEvent = {
      ...editingEvent,
      title: "Work",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
    };
    const client = {
      update: vi.fn().mockResolvedValue({ event: savedEvent }),
    };

    const result = await saveCalendarEventAction({
      draft,
      effectiveTitle: "Work",
      editingEvent,
      isEditingRecurring: true,
      recurringEditScope: "future",
      recurrenceDraft: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["WE"],
        ends: { type: "never" },
      },
      intentMode: "single",
    }, client);

    expect(client.update).toHaveBeenCalledWith("event-1", expect.objectContaining({
      title: "Work",
      sourceAccountId: "gmail-main",
      sourceCalendarId: "primary",
      etag: '"etag-1"',
      scope: "future",
      recurringEventId: "series-1",
      originalStartTime: "2026-05-05T16:00:00.000Z",
      recurrence: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["WE"],
        ends: { type: "never" },
      },
    }));
    expect(result).toMatchObject({
      kind: "update",
      savedEvent,
      focusDate: "2026-05-06",
      shouldRefresh: true,
      shouldUpsert: false,
      bounds: { start: "2026-05-05", end: "2026-05-06" },
    });
  });

  it("deletes recurring events with scope metadata and refresh bounds", async () => {
    const editingEvent = {
      id: "event-delete",
      etag: '"etag-delete"',
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-08T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-08T16:30:00.000Z").getTime(),
      allDay: false,
      recurringEventId: "series-delete",
      originalStartTime: "2026-05-08T16:00:00.000Z",
    };
    const client = {
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const result = await deleteCalendarEventAction({
      editingEvent,
      isEditingRecurring: true,
      recurringEditScope: "all",
    }, client);

    expect(client.remove).toHaveBeenCalledWith("event-delete", {
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-delete"',
      scope: "all",
      recurringEventId: "series-delete",
      originalStartTime: "2026-05-08T16:00:00.000Z",
    });
    expect(result).toEqual({
      deletedEvent: editingEvent,
      bounds: { start: "2026-05-08", end: "2026-05-08" },
      shouldRefresh: true,
      shouldRemove: false,
    });
  });
});
