import { describe, expect, it, vi } from "vitest";
import {
  buildBatchCreateItems,
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

  it("builds batch create items from retained draft rows", () => {
    expect(buildBatchCreateItems({
      draft: {
        ...draft,
        allDay: true,
        location: "  Office  ",
        description: "Notes",
      },
      effectiveTitle: "Work",
      batchDrafts: [
        {
          title: "",
          startDate: "2026-05-06",
          endDate: "2026-05-07",
          startTime: "17:00",
          endTime: "17:30",
        },
        {
          title: "Review",
          startDate: "2026-05-08",
          endDate: "2026-05-08",
          startTime: "09:15",
          endTime: "10:00",
        },
      ],
    })).toEqual([
      {
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Work",
        allDay: true,
        startDate: "2026-05-06",
        endDate: "2026-05-07",
        startTime: null,
        endTime: null,
        location: "  Office  ",
        description: "Notes",
      },
      {
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Review",
        allDay: true,
        startDate: "2026-05-08",
        endDate: "2026-05-08",
        startTime: null,
        endTime: null,
        location: "  Office  ",
        description: "Notes",
      },
    ]);
  });

  it("creates recurring events with a normalized recurrence payload and refresh bounds", async () => {
    const savedEvent = {
      id: "series-created",
      title: "Work",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
    };
    const client = {
      create: vi.fn().mockResolvedValue({ event: savedEvent }),
    };

    const result = await saveCalendarEventAction({
      draft,
      effectiveTitle: "Work",
      recurrenceDraft: {
        frequency: "monthly",
        interval: "2",
        ends: { type: "onDate", untilDate: "2026-06-01" },
      },
      intentMode: "recurring",
    }, client);

    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Work",
      startDate: "2026-05-06",
      endDate: "2026-05-06",
      recurrence: {
        frequency: "monthly",
        interval: 2,
        monthDay: 6,
        ends: { type: "onDate", untilDate: "2026-06-01" },
      },
    }));
    expect(result).toMatchObject({
      kind: "create",
      savedEvent,
      focusDate: "2026-05-06",
      shouldRefresh: true,
      shouldUpsert: false,
      bounds: { start: "2026-05-06", end: "2026-05-06" },
    });
  });

  it("creates single events with the draft payload and optimistic upsert result", async () => {
    const savedEvent = {
      id: "event-equal-time",
      title: "Hold",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      allDay: false,
    };
    const client = {
      create: vi.fn().mockResolvedValue({ event: savedEvent }),
    };

    const result = await saveCalendarEventAction({
      draft: {
        ...draft,
        title: "Ignored draft title",
        startTime: "09:00",
        endTime: "09:00",
      },
      effectiveTitle: "Hold",
      intentMode: "single",
    }, client);

    expect(client.create).toHaveBeenCalledWith({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Hold",
      allDay: false,
      startDate: "2026-05-06",
      endDate: "2026-05-06",
      startTime: "09:00",
      endTime: "09:00",
      location: "Office",
      description: "Notes",
    });
    expect(result).toMatchObject({
      kind: "create",
      savedEvent,
      focusDate: "2026-05-06",
      shouldRefresh: false,
      shouldUpsert: true,
      bounds: { start: "2026-05-06", end: "2026-05-06" },
    });
  });

  it("updates events with a new target calendar while preserving source metadata", async () => {
    const editingEvent = {
      id: "event-move",
      etag: '"etag-move"',
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const savedEvent = {
      ...editingEvent,
      calendarId: "school",
    };
    const client = {
      update: vi.fn().mockResolvedValue({ event: savedEvent }),
    };

    const result = await saveCalendarEventAction({
      draft: {
        ...draft,
        calendarId: "school",
      },
      effectiveTitle: "Planning",
      editingEvent,
      intentMode: "single",
    }, client);

    expect(client.update).toHaveBeenCalledWith("event-move", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "school",
      sourceAccountId: "gmail-main",
      sourceCalendarId: "primary",
      etag: '"etag-move"',
    }));
    expect(result).toMatchObject({
      kind: "update",
      savedEvent,
      focusDate: "2026-05-06",
      shouldRefresh: false,
      shouldUpsert: true,
      bounds: { start: "2026-05-06", end: "2026-05-06" },
    });
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
