import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listReminders } from "@/api";
import type {
  CalendarRecurrenceScope,
  NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import { getCalendarEditorErrorDetails } from "./calendarEventEditorErrors";
import { eventReminderSourceFromEvent, type EventReminderLike } from "./calendarEventReminderModel";
import { seedCalendarEventDraftFromSources } from "./calendarEventEditorSessionModel";
import {
  createManualOverrides,
  defaultDraft,
  draftFromEvent,
  flattenWritableCalendars,
  inferNoWritableReason,
  normalizeDraftForDirty,
  normalizeRecurrenceDraft,
  type CalendarBatchDraft,
  type CalendarEventDraft,
  type CalendarManualOverrides,
  type CalendarRecurrenceDraft,
  type CalendarSourceGroup,
} from "./calendarEventEditorModel";

type EditorMode = "detail" | "editor";
type StateSetter<T> = Dispatch<SetStateAction<T>>;
type TouchedCalendarFields = Partial<Record<keyof CalendarEventDraft, boolean>>;

export interface CalendarEventEditorInput extends Omit<Partial<NormalizedCalendarEvent>, "id" | "startMs" | "endMs"> {
  id?: string | number | null;
  startMs?: number | null;
  endMs?: number | null;
}

interface CalendarEventEditorSessionSetters {
  setMode: StateSetter<EditorMode>;
  setDraft: StateSetter<CalendarEventDraft>;
  setCreateSeedDraft: StateSetter<CalendarEventDraft>;
  setManualOverrides: StateSetter<CalendarManualOverrides>;
  setBatchDrafts: StateSetter<CalendarBatchDraft[]>;
  setRecurrenceDraft: StateSetter<CalendarRecurrenceDraft | null>;
  setManualRecurrenceOverride: StateSetter<boolean>;
  setRecurringEditScope: StateSetter<CalendarRecurrenceScope | null>;
  setEditingEvent: StateSetter<NormalizedCalendarEvent | null>;
  setConfirmDelete: StateSetter<boolean>;
  setTouchedFields: StateSetter<TouchedCalendarFields>;
  setSaveAttempted: StateSetter<boolean>;
  setEventReminders: StateSetter<EventReminderLike[]>;
  setRemovedReminderIds: StateSetter<Array<string | number>>;
  setReminderError: StateSetter<string | null>;
  setCustomReminder: StateSetter<{ date: string; time: string }>;
  setError: StateSetter<string | null>;
  setErrorCode: StateSetter<string | null>;
}

interface UseCalendarEventEditorSessionOptions {
  editable: boolean;
  selectedDate: string | null;
  requestIdRef: MutableRefObject<number>;
  sourceGroupsRef: MutableRefObject<CalendarSourceGroup[]>;
  ensureSources: () => Promise<CalendarSourceGroup[]>;
  seedTitleInput: (value: unknown) => void;
  resetLocationSuggestions: () => void;
  captureDirtyBaseline: (snapshot: string) => void;
  setters: CalendarEventEditorSessionSetters;
}

export default function useCalendarEventEditorSession({
  editable,
  selectedDate,
  requestIdRef,
  sourceGroupsRef,
  ensureSources,
  seedTitleInput,
  resetLocationSuggestions,
  captureDirtyBaseline,
  setters,
}: UseCalendarEventEditorSessionOptions) {
  const {
    setMode,
    setDraft,
    setCreateSeedDraft,
    setManualOverrides,
    setBatchDrafts,
    setRecurrenceDraft,
    setManualRecurrenceOverride,
    setRecurringEditScope,
    setEditingEvent,
    setConfirmDelete,
    setTouchedFields,
    setSaveAttempted,
    setEventReminders,
    setRemovedReminderIds,
    setReminderError,
    setCustomReminder,
    setError,
    setErrorCode,
  } = setters;

  const openCreate = useCallback(async () => {
    if (!editable) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const nextDraft = seedCalendarEventDraftFromSources(defaultDraft(selectedDate), sourceGroupsRef.current);
    setDraft(nextDraft);
    setCreateSeedDraft(nextDraft);
    seedTitleInput("");
    setManualOverrides(createManualOverrides());
    setRecurrenceDraft(null);
    setManualRecurrenceOverride(false);
    setRecurringEditScope(null);
    setEditingEvent(null);
    setConfirmDelete(false);
    setTouchedFields({});
    setSaveAttempted(false);
    setEventReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    setCustomReminder({ date: nextDraft.startDate, time: nextDraft.startTime || "09:00" });
    resetLocationSuggestions();
    setMode("editor");
    setError(null);
    setErrorCode(null);
    captureDirtyBaseline(normalizeDraftForDirty({
      draft: nextDraft,
      effectiveTitle: "",
      titleInput: "",
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: null,
      recurringEditScope: null,
    }));

    const groups = await ensureSources();
    if (requestIdRef.current !== requestId) return;

    setDraft((current) => {
      const seeded = seedCalendarEventDraftFromSources(current, groups);
      captureDirtyBaseline(normalizeDraftForDirty({
        draft: seeded,
        effectiveTitle: "",
        titleInput: "",
        intentMode: "single",
        batchDrafts: [],
        recurrenceDraft: null,
        recurringEditScope: null,
      }));
      return seeded;
    });
    setCreateSeedDraft((current) => seedCalendarEventDraftFromSources(current, groups));
    if (!flattenWritableCalendars(groups).length) {
      const reason = inferNoWritableReason(groups);
      setError(reason === "calendar_reauth_required"
        ? "Reconnect this Gmail account to edit calendar events."
        : "No writable calendar sources are connected.");
      setErrorCode(reason);
      return;
    }
    setError(null);
    setErrorCode(null);
  }, [captureDirtyBaseline, editable, ensureSources, requestIdRef, resetLocationSuggestions, seedTitleInput, selectedDate, setConfirmDelete, setCreateSeedDraft, setCustomReminder, setDraft, setEditingEvent, setError, setErrorCode, setEventReminders, setManualOverrides, setManualRecurrenceOverride, setMode, setRecurrenceDraft, setRecurringEditScope, setReminderError, setRemovedReminderIds, setSaveAttempted, setTouchedFields, sourceGroupsRef]);

  const openEdit = useCallback(async (event: CalendarEventEditorInput) => {
    if (
      !editable
      || !event?.writable
      || event.id == null
      || !Number.isFinite(event.startMs)
      || !Number.isFinite(event.endMs)
    ) return;
    const normalizedEvent = event as NormalizedCalendarEvent;
    const groups = await ensureSources();
    const nextDraft = seedCalendarEventDraftFromSources(draftFromEvent(normalizedEvent), groups);
    setDraft(nextDraft);
    setCreateSeedDraft(nextDraft);
    seedTitleInput(nextDraft.title);
    setManualOverrides(createManualOverrides());
    setBatchDrafts([]);
    const nextRecurrence = normalizedEvent.isRecurring && normalizedEvent.recurrence
      ? normalizeRecurrenceDraft(normalizedEvent.recurrence, nextDraft)
      : null;
    setRecurrenceDraft(nextRecurrence);
    setManualRecurrenceOverride(false);
    setRecurringEditScope(null);
    setEditingEvent(normalizedEvent);
    setConfirmDelete(false);
    setTouchedFields({});
    setSaveAttempted(false);
    setEventReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    setCustomReminder({ date: nextDraft.startDate, time: nextDraft.startTime || "09:00" });
    resetLocationSuggestions();
    setMode("editor");
    setError(null);
    setErrorCode(null);
    try {
      const source = eventReminderSourceFromEvent(normalizedEvent);
      const result = await listReminders({
        sourceType: source.sourceType,
        sourceItemId: source.sourceItemId,
        sourceOccurrenceId: source.sourceOccurrenceId,
      });
      setEventReminders(result.reminders || []);
    } catch (error) {
      setReminderError(getCalendarEditorErrorDetails(error, "Failed to load reminders.").message);
    }
    captureDirtyBaseline(normalizeDraftForDirty({
      draft: nextDraft,
      effectiveTitle: nextDraft.title,
      titleInput: nextDraft.title,
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: nextRecurrence,
      recurringEditScope: null,
    }));
  }, [captureDirtyBaseline, editable, ensureSources, resetLocationSuggestions, seedTitleInput, setBatchDrafts, setConfirmDelete, setCreateSeedDraft, setCustomReminder, setDraft, setEditingEvent, setError, setErrorCode, setEventReminders, setManualOverrides, setManualRecurrenceOverride, setMode, setRecurrenceDraft, setRecurringEditScope, setReminderError, setRemovedReminderIds, setSaveAttempted, setTouchedFields]);

  return { openCreate, openEdit };
}
