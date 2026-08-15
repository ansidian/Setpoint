import {
  flattenWritableCalendars,
  defaultDraft,
  type CalendarBatchDraft,
  type CalendarEventDraft,
  type CalendarManualOverrides,
  type CalendarRecurrenceDraftInput,
  type CalendarSourceGroup,
  type CalendarTitleAssist,
  validateBatchDrafts,
  validateRecurrenceDraft,
  validateSingleDraft,
} from "./calendarEventEditorModel";
import type { CalendarRecurrenceScope } from "../../../../shared/types/calendar";
import type {
  CalendarEventCreateSeed,
  CalendarEventCreateSourceIntent,
} from "../../../../shared/types/calendar";
import { addMinutesToDraftDateTime } from "./calendarEditorUtils";

export function updateCalendarEventBatchDraft(
  batchDrafts: CalendarBatchDraft[],
  draftId: string,
  field: keyof Pick<CalendarBatchDraft, "title" | "startDate" | "endDate" | "startTime" | "endTime">,
  value: string,
) {
  return batchDrafts.map((item) => {
    if (item.id !== draftId) return item;
    const next = { ...item, [field]: value };
    if (field === "startDate" && next.endDate && next.endDate < value) {
      next.endDate = value;
    }
    return next;
  });
}

export function removeCalendarEventBatchDraft(batchDrafts: CalendarBatchDraft[], draftId: string) {
  return batchDrafts.filter((item) => item.id !== draftId);
}

export function seedCalendarEventDraftFromSources(
  draft: CalendarEventDraft,
  sourceGroups: CalendarSourceGroup[] | null | undefined,
  sourceIntent?: CalendarEventCreateSourceIntent | null,
) {
  const writable = flattenWritableCalendars(sourceGroups);
  let preferred = null;

  if (sourceIntent?.kind === "resolved") {
    const matches = writable.filter((entry) => (
      entry.accountId === sourceIntent.accountId
      && entry.calendarId === sourceIntent.calendarId
    ));
    preferred = matches.length === 1 ? matches[0]! : null;
  } else if (sourceIntent?.kind === "requested") {
    const requestedName = sourceIntent.calendarName.trim().toLocaleLowerCase();
    const matches = requestedName
      ? writable.filter((entry) => entry.summary.trim().toLocaleLowerCase() === requestedName)
      : [];
    preferred = matches.length === 1 ? matches[0]! : null;
  } else {
    if (draft.accountId && draft.calendarId) return draft;
    preferred = writable.find((entry) => entry.primary) || writable[0] || null;
  }

  if (!preferred && sourceIntent) {
    return {
      ...draft,
      accountId: "",
      calendarId: "",
      colorId: null,
      sourceColor: null,
      sourceColorId: null,
    };
  }
  if (!preferred) return draft;
  return {
    ...draft,
    accountId: preferred.accountId,
    calendarId: preferred.calendarId,
    colorId: draft.colorId || preferred.defaultEventColorId || null,
    sourceColor: preferred.color || null,
    sourceColorId: preferred.defaultEventColorId || null,
  };
}

export function normalizeCalendarEventCreateSeed(
  seed: CalendarEventCreateSeed,
  sourceGroups: CalendarSourceGroup[] | null | undefined,
) {
  const startDate = seed.startDate;
  const base = defaultDraft(startDate);
  const startTime = seed.startTime || base.startTime;
  const defaultEnd = addMinutesToDraftDateTime(startDate, startTime, 30);
  const allDay = !!seed.allDay;
  const endDate = allDay
    ? seed.endDate || startDate
    : seed.endTime
      ? seed.endDate || startDate
      : defaultEnd.date;
  const endTime = allDay
    ? base.endTime
    : seed.endTime || defaultEnd.time;

  return seedCalendarEventDraftFromSources({
    ...base,
    title: String(seed.title || ""),
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    location: String(seed.location || ""),
    description: String(seed.description || ""),
  }, sourceGroups, seed.source);
}

export function applyCalendarTitleAssistToDraft({
  draft,
  titleAssist,
  manualOverrides,
  createSeedDraft,
  lastCommittedLocationQuery,
}: {
  draft: CalendarEventDraft;
  titleAssist: Pick<CalendarTitleAssist, "cleanTitle"> & Partial<CalendarTitleAssist>;
  manualOverrides: Partial<CalendarManualOverrides>;
  createSeedDraft: CalendarEventDraft;
  lastCommittedLocationQuery?: string | null;
}) {
  const next = {
    ...draft,
    title: titleAssist.cleanTitle,
  };

  const parsed = titleAssist.parsedDateTime;
  const derivedDraft = titleAssist.singleDraft;
  if (!manualOverrides.startDate) {
    next.startDate = derivedDraft?.startDate || parsed?.startDate || createSeedDraft.startDate;
  }
  if (!manualOverrides.endDate) {
    next.endDate = derivedDraft?.endDate || parsed?.endDate || createSeedDraft.endDate;
  }
  if (!manualOverrides.startTime) {
    next.startTime = derivedDraft?.startTime || parsed?.startTime || createSeedDraft.startTime;
  }
  if (!manualOverrides.endTime) {
    next.endTime = derivedDraft?.endTime || parsed?.endTime || createSeedDraft.endTime;
  }
  if (!manualOverrides.location && titleAssist.locationQuery && titleAssist.locationQuery !== lastCommittedLocationQuery) {
    next.location = titleAssist.locationQuery;
  } else if (!manualOverrides.location) {
    next.location = createSeedDraft.location;
  }
  if (!manualOverrides.allDay) {
    next.allDay = derivedDraft?.allDay ?? parsed?.allDay ?? createSeedDraft.allDay;
  }

  if (
    next.title === draft.title
    && next.startDate === draft.startDate
    && next.endDate === draft.endDate
    && next.startTime === draft.startTime
    && next.endTime === draft.endTime
    && next.location === draft.location
    && next.allDay === draft.allDay
  ) {
    return draft;
  }

  return next;
}

export function projectCalendarEventEditorValidation({
  draft,
  effectiveTitle,
  intentMode,
  batchDrafts,
  recurrenceDraft,
  isEditing,
  isEditingRecurring,
  recurringEditScope,
  touchedTitle,
  saveAttempted,
  editable,
  saving,
  deleting,
}: {
  draft: CalendarEventDraft;
  effectiveTitle?: string | null;
  intentMode: string;
  batchDrafts: CalendarBatchDraft[];
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
  isEditing: boolean;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarRecurrenceScope | null;
  touchedTitle: boolean;
  saveAttempted: boolean;
  editable: boolean;
  saving: boolean;
  deleting: boolean;
}) {
  let validationMessage = null;

  if (isEditingRecurring && !recurringEditScope) {
    validationMessage = "Choose whether to edit all events, upcoming only, or just this one.";
  } else if (!isEditing && intentMode === "batch") {
    validationMessage = validateBatchDrafts({
      draft,
      batchDrafts,
      effectiveTitle,
      recurrenceDraft,
    });
  } else {
    validationMessage = validateSingleDraft({ draft, effectiveTitle });
    const hasActiveRecurrence = !!recurrenceDraft
      && (!isEditingRecurring || recurringEditScope !== "one");
    if (
      !validationMessage
      && (intentMode === "recurring" || hasActiveRecurrence)
      && (!isEditingRecurring || recurringEditScope !== "one")
    ) {
      validationMessage = validateRecurrenceDraft({ recurrenceDraft, draft });
    }
  }

  const visibleValidationMessage = validationMessage === "Title is required."
    && !touchedTitle
    && !saveAttempted
    ? null
    : validationMessage;

  return {
    validationMessage,
    visibleValidationMessage,
    canSave: editable && !saving && !deleting && !validationMessage,
  };
}
