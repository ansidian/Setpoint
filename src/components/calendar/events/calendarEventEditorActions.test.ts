import { describe, expect, it, vi } from "vitest";
import {
  buildCalendarEventPayload,
  buildBatchCreateItems,
  deleteCalendarEventAction,
  formatCalendarEditorError,
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

  it("formats calendar editor errors without leaking raw provider bodies", () => {
    expect(formatCalendarEditorError({
      code: "calendar_event_conflict",
      message: "This event changed elsewhere. Reload and try again.",
    })).toBe("This event changed in Google Calendar. Refresh the calendar and try again.");

    expect(formatCalendarEditorError({
      code: "calendar_google_error",
      message: "{\"error\":{\"code\":409,\"message\":\"The requested identifier already exists.\"}}",
    })).toBe("Google Calendar could not save this event. Refresh the calendar and try again.");

    expect(formatCalendarEditorError({
      code: "calendar_google_error",
      message: "Google Calendar already has this event in the target calendar. Refreshing will show the latest copy.",
    })).toBe("Google Calendar already has this event in the target calendar. Refreshing will show the latest copy.");
  });

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

    // test-architecture: allow-boundary-interaction -- The injected client is the outbound Calendar HTTP boundary; the batch request shape is not present in the returned domain result.
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

  it("includes default event color ids on single and batch create payloads", () => {
    const coloredDraft = { ...draft, colorId: "3" };
    const single = buildCalendarEventPayload({ draft: coloredDraft, effectiveTitle: "Work" });
    const batch = buildBatchCreateItems({
      draft: coloredDraft,
      effectiveTitle: "Work",
      batchDrafts: [
        {
          title: "",
          startDate: "2026-05-06",
          endDate: "2026-05-06",
          startTime: "17:00",
          endTime: "17:30",
        },
      ],
    });

    expect([single.colorId, batch[0]?.colorId]).toEqual(["3", "3"]);
  });

  it("flushes pending event reminders only after provider event creation succeeds", async () => {
    const savedEvent = {
      id: "event-with-reminder",
      title: "Hold",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2099-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2099-05-06T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const client = {
      create: vi.fn().mockResolvedValue({ event: savedEvent }),
      createReminder: vi.fn().mockResolvedValue({ reminder: { id: "reminder-1" } }),
    };

    const result = await saveCalendarEventAction({
      draft,
      effectiveTitle: "Hold",
      intentMode: "single",
      eventReminders: {
        items: [{
          clientId: "draft-1",
          offsetMinutes: -30,
          remindAt: "2099-05-06T15:30:00.000Z",
          status: "pending",
        }],
        removedIds: [],
      },
    }, client);

    // test-architecture: allow-boundary-interaction -- The provider event must be created exactly once before reminders are written; the result cannot prove duplicate outbound writes did not occur.
    expect(client.create).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Reminder anchoring is an outbound reminders API contract whose payload is not returned by the action facade.
    expect(client.createReminder).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "calendar_event",
      sourceItemId: "event-with-reminder",
      anchorKind: "event_start",
      anchorAt: "2099-05-06T16:00:00.000Z",
      offsetMinutes: -30,
    }));
    expect(result).toMatchObject({
      reminderCreates: 1,
      reminderDeletes: 0,
      savedEvent: {
        hasUpcomingReminder: true,
        upcomingReminderCount: 1,
        nextReminderAt: "2099-05-06T15:30:00.000Z",
        reminderState: {
          hasUpcomingReminder: true,
          upcomingCount: 1,
          nextReminderAt: "2099-05-06T15:30:00.000Z",
        },
      },
    });
  });

  it("does not flush pending event reminders when provider creation fails", async () => {
    const client = {
      create: vi.fn().mockRejectedValue(new Error("Google Calendar failed")),
      createReminder: vi.fn(),
    };

    await expect(saveCalendarEventAction({
      draft,
      effectiveTitle: "Hold",
      intentMode: "single",
      eventReminders: {
        items: [{ clientId: "draft-1", offsetMinutes: -30, status: "pending" }],
        removedIds: [],
      },
    }, client)).rejects.toThrow("Google Calendar failed");

    // test-architecture: allow-boundary-interaction -- A failed provider create must not emit the separate outbound reminder write; no result exists on this rejection path.
    expect(client.createReminder).not.toHaveBeenCalled();
  });

  it("creates a Time-to-Leave reminder from the authoritative saved occurrence after the event update", async () => {
    const order: string[] = [];
    const editingEvent = {
      id: "event-1",
      etag: '"etag-1"',
      title: "Old appointment",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2099-05-05T16:00:00.000Z").getTime(),
      endMs: new Date("2099-05-05T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const savedEvent = {
      ...editingEvent,
      title: "Dentist",
      location: "500 Pine Street",
      startMs: new Date("2099-05-06T18:00:00.000Z").getTime(),
      endMs: new Date("2099-05-06T18:30:00.000Z").getTime(),
    };
    const client = {
      update: vi.fn().mockImplementation(async () => {
        order.push("event");
        return { event: savedEvent };
      }),
      createReminder: vi.fn().mockImplementation(async () => {
        order.push("reminder");
        return { reminder: { id: "ttl-1" } };
      }),
    };

    await saveCalendarEventAction({
      draft: { ...draft, location: "500 Pine Street" },
      effectiveTitle: "Dentist",
      editingEvent,
      intentMode: "single",
      eventReminders: {
        items: [{
          clientId: "ttl-draft",
          reminder_kind: "time_to_leave",
          arrival_buffer_minutes: 30,
          status: "pending",
        }],
        removedIds: [],
      },
    }, client);

    expect(order).toEqual(["event", "reminder"]);
    // test-architecture: allow-boundary-interaction -- Time to Leave must anchor to the provider-returned occurrence, and that outbound reminders payload is not included in the action result.
    expect(client.createReminder).toHaveBeenCalledWith({
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "gmail-main",
      sourceCalendarId: "primary",
      sourceItemId: "event-1",
      sourceOccurrenceId: null,
      eventStart: "2099-05-06T18:00:00.000Z",
      eventLocation: "500 Pine Street",
      isAllDay: false,
      isRecurring: false,
      arrivalBufferMinutes: 30,
      payloadSnapshot: {
        title: "Dentist",
        context: "Calendar",
        url: null,
        color: null,
        location: "500 Pine Street",
      },
    });
  });

  it("does not create Time to Leave when the provider event update fails", async () => {
    const editingEvent = {
      id: "event-1",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2099-05-05T16:00:00.000Z").getTime(),
      endMs: new Date("2099-05-05T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const client = {
      update: vi.fn().mockRejectedValue(new Error("Google Calendar failed")),
      createReminder: vi.fn(),
    };

    await expect(saveCalendarEventAction({
      draft: { ...draft, location: "500 Pine Street" },
      effectiveTitle: "Dentist",
      editingEvent,
      intentMode: "single",
      eventReminders: {
        items: [{
          clientId: "ttl-draft",
          reminder_kind: "time_to_leave",
          arrival_buffer_minutes: 15,
          status: "pending",
        }],
        removedIds: [],
      },
    }, client)).rejects.toThrow("Google Calendar failed");

    // test-architecture: allow-boundary-interaction -- A rejected provider update must not emit the separate outbound Time-to-Leave write; no action result exists on this path.
    expect(client.createReminder).not.toHaveBeenCalled();
  });

  it("deletes removed reminder chips after an event update succeeds", async () => {
    const editingEvent = {
      id: "event-1",
      etag: '"etag-1"',
      title: "Old work",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-05T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const savedEvent = {
      ...editingEvent,
      title: "Work",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
    };
    const client = {
      update: vi.fn().mockResolvedValue({ event: savedEvent }),
      deleteReminder: vi.fn().mockResolvedValue({ success: true }),
    };

    const result = await saveCalendarEventAction({
      draft,
      effectiveTitle: "Work",
      editingEvent,
      intentMode: "single",
      eventReminders: {
        items: [{ id: "kept", offset_minutes: -30, status: "pending" }],
        removedIds: ["removed-1"],
      },
    }, client);

    // test-architecture: allow-boundary-interaction -- Deleting the persisted reminder is an outbound API side effect not represented in the saved event projection.
    expect(client.deleteReminder).toHaveBeenCalledWith("removed-1");
    expect(result.savedEvent).toMatchObject({
      hasUpcomingReminder: false,
      upcomingReminderCount: 0,
      nextReminderAt: null,
      reminderState: {
        hasUpcomingReminder: false,
        upcomingCount: 0,
        nextReminderAt: null,
      },
    });
  });

  it("projects retained event reminders from the saved event anchor after a time edit", async () => {
    const editingEvent = {
      id: "event-1",
      etag: '"etag-1"',
      title: "Old work",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2099-05-05T16:00:00.000Z").getTime(),
      endMs: new Date("2099-05-05T16:30:00.000Z").getTime(),
      allDay: false,
    };
    const savedEvent = {
      ...editingEvent,
      title: "Work",
      startMs: new Date("2099-05-06T18:00:00.000Z").getTime(),
      endMs: new Date("2099-05-06T18:30:00.000Z").getTime(),
    };
    const client = {
      update: vi.fn().mockResolvedValue({ event: savedEvent }),
    };

    const result = await saveCalendarEventAction({
      draft,
      effectiveTitle: "Work",
      editingEvent,
      intentMode: "single",
      eventReminders: {
        items: [{ id: "kept", offset_minutes: -30, remind_at: "2099-05-05T15:30:00.000Z", status: "pending" }],
        removedIds: ["removed-1"],
      },
    }, client);

    expect(result.savedEvent).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2099-05-06T17:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2099-05-06T17:30:00.000Z",
      },
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
      recurringEditScope: "following",
      recurrenceDraft: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["WE"],
        ends: { type: "never" },
      },
      intentMode: "single",
    }, client);

    // test-architecture: allow-boundary-interaction -- Recurrence scope and optimistic-concurrency metadata are outbound Google Calendar request requirements absent from the returned event.
    expect(client.update).toHaveBeenCalledWith("event-1", expect.objectContaining({
      title: "Work",
      sourceAccountId: "gmail-main",
      sourceCalendarId: "primary",
      etag: '"etag-1"',
      scope: "following",
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

    // test-architecture: allow-boundary-interaction -- Recurring deletion scope and etag are outbound Google Calendar request requirements with no durable client-side state to inspect.
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
