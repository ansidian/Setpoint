import {
  flattenWritableCalendars,
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
) {
  if (draft.accountId && draft.calendarId) return draft;
  const writable = flattenWritableCalendars(sourceGroups);
  const preferred = writable.find((entry) => entry.primary) || writable[0];
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
  if (titleAssist.locationQuery && titleAssist.locationQuery !== lastCommittedLocationQuery) {
    next.location = titleAssist.locationQuery;
  } else if (!manualOverrides.location) {
    next.location = createSeedDraft.location;
  }

  if (
    next.title === draft.title
    && next.startDate === draft.startDate
    && next.endDate === draft.endDate
    && next.startTime === draft.startTime
    && next.endTime === draft.endTime
    && next.location === draft.location
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
