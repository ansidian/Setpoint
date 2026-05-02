import { describe, expect, it } from "vitest";
import {
  buildRecurrencePayload,
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
});
