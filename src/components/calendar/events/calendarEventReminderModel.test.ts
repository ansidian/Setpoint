import { describe, expect, it } from "vitest";
import {
  buildEventReminderCreatePayload,
  createEventReminderDraftFromCustom,
  createEventReminderDraftFromOffset,
  eventReminderSourceFromEvent,
  formatEventReminderLabel,
  getEventReminderPresetState,
  projectEventReminderChips,
} from "./calendarEventReminderModel";

describe("calendarEventReminderModel", () => {
  const draft = {
    accountId: "gmail-main",
    calendarId: "primary",
    allDay: false,
    startDate: "2026-05-10",
    startTime: "10:00",
  };

  it("converts event reminder presets and custom date/time selections into offsets from event start", () => {
    expect(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes: -30,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({
      offsetMinutes: -30,
      remindAt: "2026-05-10T16:30:00.000Z",
      blocked: false,
    });

    expect(createEventReminderDraftFromCustom({
      draft,
      reminderDate: "2026-05-10",
      reminderTime: "09:15",
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({
      offsetMinutes: -45,
      remindAt: "2026-05-10T16:15:00.000Z",
      blocked: false,
    });
  });

  it("blocks duplicate and past reminders against existing chips", () => {
    const existingReminders = [{ offsetMinutes: -30, status: "pending" }];

    expect(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes: -30,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders,
    })).toMatchObject({ blocked: true, blockReason: "duplicate" });

    expect(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes: -180,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({ blocked: true, blockReason: "past" });
  });

  it("projects disabled preset state for duplicate offsets and past reminder times", () => {
    expect(getEventReminderPresetState({
      draft,
      offsetMinutes: -30,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [{ offsetMinutes: -30, status: "pending" }],
    })).toMatchObject({
      disabled: true,
      reason: "duplicate",
      remindAt: "2026-05-10T16:30:00.000Z",
    });

    expect(getEventReminderPresetState({
      draft,
      offsetMinutes: -180,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({
      disabled: true,
      reason: "past",
      remindAt: "2026-05-10T14:00:00.000Z",
    });

    expect(getEventReminderPresetState({
      draft,
      offsetMinutes: -10,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({
      disabled: false,
      reason: null,
      remindAt: "2026-05-10T16:50:00.000Z",
    });
  });

  it("builds source payloads for single and recurring event occurrences", () => {
    const single = eventReminderSourceFromEvent({
      id: "event-1",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse("2026-05-10T17:00:00.000Z"),
      title: "Dentist",
      htmlLink: "https://calendar.example/event-1",
      color: "#89b4fa",
    });
    const recurring = eventReminderSourceFromEvent({
      id: "event-recurring",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse("2026-05-10T17:00:00.000Z"),
      isRecurring: true,
      originalStartTime: "2026-05-10T17:00:00.000Z",
    });

    expect(single).toMatchObject({
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      sourceOccurrenceId: null,
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      payloadSnapshot: {
        title: "Dentist",
        url: "https://calendar.example/event-1",
        color: "#89b4fa",
      },
    });
    expect(recurring.sourceOccurrenceId).toBe("2026-05-10T17:00:00.000Z");
  });

  it("formats chips and creates reminder payloads from saved events", () => {
    const event = {
      id: "event-1",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse("2026-05-10T17:00:00.000Z"),
      title: "Dentist",
    };
    const draftReminder = createEventReminderDraftFromOffset({
      draft,
      offsetMinutes: -60,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    });

    expect(formatEventReminderLabel(draftReminder)).toBe("1 hour before");
    expect(buildEventReminderCreatePayload({
      event,
      reminder: draftReminder,
    })).toMatchObject({
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -60,
    });
    expect(projectEventReminderChips([
      { id: "sent", status: "sent", offset_minutes: -60 },
      { clientId: "pending", status: "pending", offsetMinutes: -30 },
    ])).toEqual([
      expect.objectContaining({ key: "sent", label: "1 hour before", sent: true }),
      expect.objectContaining({ key: "pending", label: "30 minutes before", sent: false }),
    ]);
  });
});
