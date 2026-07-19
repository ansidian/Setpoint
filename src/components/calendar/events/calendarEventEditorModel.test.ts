import { describe, expect, it } from "vitest";
import {
  buildRecurrencePayload,
  draftFromEvent,
  flattenWritableCalendars,
  normalizeDraftForDirty,
  normalizeRecurrenceDraft,
  validateBatchDrafts,
  validateRecurrenceDraft,
  validateSingleDraft,
} from "./calendarEventEditorModel";

describe("calendarEventEditorModel", () => {
  it("normalizes recurrence drafts with safe defaults and positive counts", () => {
    const draft = { startDate: "2026-05-06" };

    expect(normalizeRecurrenceDraft({ interval: "0" }, draft)).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["WE"],
      ends: { type: "never" },
    });

    expect(normalizeRecurrenceDraft({
      frequency: "weekly",
      interval: "2",
      weekdays: ["MO", "MO", "FR"],
      ends: { type: "afterCount", count: "3" },
    }, draft)).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO", "FR"],
      ends: { type: "afterCount", count: 3 },
    });
  });

  it("builds recurrence payloads for weekly, monthly, and yearly events", () => {
    const draft = { startDate: "2026-05-06" };

    expect(buildRecurrencePayload({
      frequency: "weekly",
      interval: "2",
      weekdays: ["MO", "WE"],
      ends: { type: "onDate", untilDate: "2026-06-01" },
    }, draft)).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO", "WE"],
      ends: { type: "onDate", untilDate: "2026-06-01" },
    });

    expect(buildRecurrencePayload({
      frequency: "monthly",
      interval: 1,
      ends: { type: "never" },
    }, draft)).toEqual({
      frequency: "monthly",
      interval: 1,
      monthDay: 6,
      ends: { type: "never" },
    });

    expect(buildRecurrencePayload({
      frequency: "yearly",
      interval: 1,
      ends: { type: "afterCount", count: "4" },
    }, draft)).toEqual({
      frequency: "yearly",
      interval: 1,
      monthDay: 6,
      month: 5,
      ends: { type: "afterCount", count: 4 },
    });
  });

  it("normalizes dirty snapshots by trimming text and stripping batch-only metadata", () => {
    const snapshot = JSON.parse(normalizeDraftForDirty({
      draft: {
        allDay: false,
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        startTime: "09:00",
        endTime: "09:30",
        accountId: "gmail-main",
        calendarId: "primary",
        location: "  Office  ",
        description: "  Notes  ",
      },
      effectiveTitle: "  Standup  ",
      titleInput: "  Standup tomorrow  ",
      intentMode: "batch",
      batchDrafts: [
        {
          id: "batch:1",
          title: "  First  ",
          startDate: "2026-05-06",
          endDate: "2026-05-06",
          startTime: "09:00",
          endTime: "09:30",
          error: "ignored",
        },
      ],
      recurrenceDraft: null,
      recurringEditScope: null,
    }));

    expect(snapshot).toEqual({
      title: "Standup",
      titleInput: "Standup tomorrow",
      allDay: false,
      startDate: "2026-05-06",
      endDate: "2026-05-06",
      startTime: "09:00",
      endTime: "09:30",
      accountId: "gmail-main",
      calendarId: "primary",
      location: "Office",
      description: "Notes",
      intentMode: "batch",
      batchDrafts: [
        {
          title: "First",
          startDate: "2026-05-06",
          endDate: "2026-05-06",
          startTime: "09:00",
          endTime: "09:30",
        },
      ],
      recurrenceDraft: null,
      recurringEditScope: null,
    });
  });

  it("maps Google calendar source colors onto event color ids for new and existing events", () => {
    expect(flattenWritableCalendars([
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        calendars: [
          {
            id: "work",
            summary: "Work",
            writable: true,
            backgroundColor: "#4285f4",
          },
        ],
      },
    ])).toEqual([
      expect.objectContaining({
        calendarId: "work",
        color: "#4285f4",
        defaultEventColorId: "9",
      }),
    ]);

    expect(draftFromEvent({
      id: "event-source-color",
      title: "Work",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-05-06T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T16:30:00.000Z").getTime(),
      allDay: false,
      colorId: null,
      sourceColorId: "3",
    })).toMatchObject({
      colorId: "3",
      sourceColorId: "3",
    });
  });

  it("validates single, batch, and recurring drafts", () => {
    const draft = {
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: false,
      startDate: "2026-05-06",
      endDate: "2026-05-06",
      startTime: "10:00",
      endTime: "09:30",
    };

    expect(validateSingleDraft({ draft, effectiveTitle: "Standup" }))
      .toBe("End time must be on or after start time.");

    expect(validateSingleDraft({
      draft: { ...draft, endTime: "10:00" },
      effectiveTitle: "Standup",
    })).toBeNull();

    expect(validateBatchDrafts({
      draft: { ...draft, endTime: "10:30" },
      effectiveTitle: "Standup",
      batchDrafts: [{ startDate: "2026-05-07", endDate: "2026-05-06", startTime: "09:00", endTime: "09:30" }],
    })).toBe("Batch event 1 ends before it starts.");

    expect(validateRecurrenceDraft({
      draft,
      recurrenceDraft: { frequency: "weekly", interval: 1, weekdays: [], ends: { type: "never" } },
    })).toBe("Choose at least one weekday for weekly recurrence.");

    expect(validateRecurrenceDraft({
      draft,
      recurrenceDraft: { frequency: "weekly", interval: 1, weekdays: ["WE"], ends: { type: "never" } },
    })).toBeNull();
  });

  it("blocks a batch save when a recurrence draft is still active (P3-9)", () => {
    const draft = {
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: false,
    };
    const batchDrafts = [
      { startDate: "2026-05-06", endDate: "2026-05-06", startTime: "09:00", endTime: "09:30" },
      { startDate: "2026-05-13", endDate: "2026-05-13", startTime: "09:00", endTime: "09:30" },
    ];

    // An otherwise-valid batch passes when no recurrence is attached.
    expect(validateBatchDrafts({ draft, batchDrafts, effectiveTitle: "Standup" })).toBeNull();

    // A recurrence-then-batch sequence leaves recurrenceDraft set; the batch must be
    // blocked rather than silently dropping the recurrence and creating one-offs.
    expect(validateBatchDrafts({
      draft,
      batchDrafts,
      effectiveTitle: "Standup",
      recurrenceDraft: { frequency: "weekly", interval: 1, weekdays: ["WE"], ends: { type: "never" } },
    })).toBe("Recurrence cannot be combined with a multi-date batch.");
  });

  it("allows a timed single draft whose end equals its start", () => {
    // Equal start and end is a valid zero-length hold, not an error. Validation
    // only rejects an end that is strictly before the start.
    const draft = {
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: false,
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "09:00",
      endTime: "09:00",
    };

    expect(validateSingleDraft({ draft, effectiveTitle: "Hold" })).toBeNull();

    // One minute earlier on the same day is rejected.
    expect(validateSingleDraft({
      draft: { ...draft, endTime: "08:59" },
      effectiveTitle: "Hold",
    })).toBe("End time must be on or after start time.");
  });
});
