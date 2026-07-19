import { describe, expect, it } from "vitest";
import { defaultDraft } from "./calendarEventEditorModel";
import {
  applyCalendarTitleAssistToDraft,
  projectCalendarEventEditorValidation,
  updateCalendarEventBatchDraft,
  seedCalendarEventDraftFromSources,
} from "./calendarEventEditorSessionModel";

describe("projectCalendarEventEditorValidation", () => {
  it("requires an edit scope before a recurring event can be saved", () => {
    const result = projectCalendarEventEditorValidation({
      draft: defaultDraft("2026-07-14"),
      effectiveTitle: "Weekly planning",
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: { frequency: "WEEKLY", interval: 1 },
      isEditing: true,
      isEditingRecurring: true,
      recurringEditScope: null,
      touchedTitle: true,
      saveAttempted: false,
      editable: true,
      saving: false,
      deleting: false,
    });

    expect(result).toEqual({
      validationMessage: "Choose whether to edit all events, upcoming only, or just this one.",
      visibleValidationMessage: "Choose whether to edit all events, upcoming only, or just this one.",
      canSave: false,
    });
  });

  it("hides an untouched required-title error until save is attempted", () => {
    const base = {
      draft: defaultDraft("2026-07-14"),
      effectiveTitle: "",
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: null,
      isEditing: false,
      isEditingRecurring: false,
      recurringEditScope: null,
      touchedTitle: false,
      editable: true,
      saving: false,
      deleting: false,
    };

    expect(projectCalendarEventEditorValidation({ ...base, saveAttempted: false })).toMatchObject({
      validationMessage: "Title is required.",
      visibleValidationMessage: null,
      canSave: false,
    });
    expect(projectCalendarEventEditorValidation({ ...base, saveAttempted: true })).toMatchObject({
      visibleValidationMessage: "Title is required.",
    });
  });
});

describe("updateCalendarEventBatchDraft", () => {
  it("keeps an edited batch event's end date from preceding its start date", () => {
    const result = updateCalendarEventBatchDraft([
      { id: "batch-1", startDate: "2026-07-14", endDate: "2026-07-15" },
    ], "batch-1", "startDate", "2026-07-20");

    expect(result[0]).toMatchObject({
      startDate: "2026-07-20",
      endDate: "2026-07-20",
    });
  });
});

describe("seedCalendarEventDraftFromSources", () => {
  it("selects the primary writable calendar when the draft has no source", () => {
    const draft = defaultDraft("2026-07-14");
    const result = seedCalendarEventDraftFromSources(draft, [
      {
        accountId: "gmail-1",
        calendars: [
          { id: "secondary", writable: true, primary: false, backgroundColor: "#123456" },
          { id: "primary", writable: true, primary: true, backgroundColor: "#654321" },
        ],
      },
    ]);

    expect(result).toMatchObject({
      accountId: "gmail-1",
      calendarId: "primary",
      sourceColor: "#654321",
    });
  });
});

describe("applyCalendarTitleAssistToDraft", () => {
  it("applies parsed schedule fields while preserving manual overrides", () => {
    const draft = {
      ...defaultDraft("2026-07-14"),
      title: "Old title",
      startTime: "15:00",
      endTime: "16:00",
      location: "Old place",
    };

    const result = applyCalendarTitleAssistToDraft({
      draft,
      titleAssist: {
        cleanTitle: "Planning",
        singleDraft: {
          startDate: "2026-07-20",
          endDate: "2026-07-20",
          startTime: "09:00",
          endTime: "10:00",
        },
        parsedDateTime: null,
        locationQuery: "Room 2",
      },
      manualOverrides: {
        startDate: false,
        endDate: false,
        startTime: true,
        endTime: true,
        location: false,
      },
      createSeedDraft: defaultDraft("2026-07-14"),
      lastCommittedLocationQuery: "",
    });

    expect(result).toMatchObject({
      title: "Planning",
      startDate: "2026-07-20",
      endDate: "2026-07-20",
      startTime: "15:00",
      endTime: "16:00",
      location: "Room 2",
    });
  });
});
