import { describe, expect, it } from "vitest";
import { defaultDraft } from "./calendarEventEditorModel";
import {
  applyCalendarTitleAssistToDraft,
  projectCalendarEventEditorValidation,
  normalizeCalendarEventCreateSeed,
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

  const sourceGroups = [
    {
      accountId: "gmail-1",
      calendars: [
        { id: "primary", summary: "Personal", writable: true, primary: true, backgroundColor: "#654321" },
        { id: "work", summary: "Work", writable: true, primary: false, backgroundColor: "#123456" },
      ],
    },
    {
      accountId: "gmail-2",
      calendars: [
        { id: "team", summary: "Team", writable: true, primary: false, backgroundColor: "#abcdef" },
      ],
    },
  ];

  it("normalizes all-day, multi-day, location, and description seed fields", () => {
    expect(normalizeCalendarEventCreateSeed({
      title: "Conference",
      allDay: true,
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      location: "Convention Center",
      description: "Bring badge",
    }, sourceGroups)).toMatchObject({
      title: "Conference",
      allDay: true,
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      location: "Convention Center",
      description: "Bring badge",
      accountId: "gmail-1",
      calendarId: "primary",
    });
  });

  it("uses the existing 30-minute create default when a timed seed omits its end", () => {
    expect(normalizeCalendarEventCreateSeed({
      title: "Late call",
      allDay: false,
      startDate: "2026-09-10",
      startTime: "23:45",
    }, sourceGroups)).toMatchObject({
      startDate: "2026-09-10",
      startTime: "23:45",
      endDate: "2026-09-11",
      endTime: "00:15",
    });
  });

  it("accepts only one exact writable resolved source pair", () => {
    expect(normalizeCalendarEventCreateSeed({
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      startTime: "10:00",
      endTime: "10:30",
      source: { kind: "resolved", accountId: "gmail-2", calendarId: "team" },
    }, sourceGroups)).toMatchObject({ accountId: "gmail-2", calendarId: "team" });

    expect(normalizeCalendarEventCreateSeed({
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      source: { kind: "resolved", accountId: "gmail-2", calendarId: "missing" },
    }, sourceGroups)).toMatchObject({ accountId: "", calendarId: "" });
  });

  it("resolves a requested name only when one exact normalized writable match exists", () => {
    expect(normalizeCalendarEventCreateSeed({
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      source: { kind: "requested", calendarName: "  work " },
    }, sourceGroups)).toMatchObject({ accountId: "gmail-1", calendarId: "work" });

    expect(normalizeCalendarEventCreateSeed({
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      source: { kind: "requested", calendarName: "Missing" },
    }, sourceGroups)).toMatchObject({ accountId: "", calendarId: "" });

    expect(normalizeCalendarEventCreateSeed({
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      source: { kind: "requested", calendarName: "Team" },
    }, [
      ...sourceGroups,
      { accountId: "gmail-3", calendars: [{ id: "team-2", summary: "team", writable: true }] },
    ])).toMatchObject({ accountId: "", calendarId: "" });
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

  it("does not replace explicitly seeded location or all-day state", () => {
    const draft = {
      ...defaultDraft("2026-07-14"),
      allDay: true,
      location: "Seeded place",
    };

    expect(applyCalendarTitleAssistToDraft({
      draft,
      titleAssist: {
        cleanTitle: "Planning",
        singleDraft: { allDay: false },
        parsedDateTime: null,
        locationQuery: "Parsed place",
      },
      manualOverrides: { location: true, allDay: true },
      createSeedDraft: draft,
    })).toMatchObject({ allDay: true, location: "Seeded place" });
  });
});
