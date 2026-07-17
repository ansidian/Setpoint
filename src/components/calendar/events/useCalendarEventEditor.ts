import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getGmailAuthUrl, listReminders } from "@/api";
import {
  deleteCalendarEventAction,
  formatCalendarEditorError,
  saveCalendarEventAction,
} from "./calendarEventEditorActions";
import useCalendarLocationSuggestions from "./useCalendarLocationSuggestions";
import useCalendarSources from "./useCalendarSources";
import useEventReminderDrafts from "./useEventReminderDrafts";
import useEventRecurrenceDraft from "./useEventRecurrenceDraft";
import useCalendarEventTitleComposer from "./useCalendarEventTitleComposer";
import {
  eventReminderSourceFromEvent,
} from "./calendarEventReminderModel";
import {
  type CalendarBatchDraft,
  type CalendarEventDraft,
  type CalendarManualOverrides,
  createManualOverrides,
  defaultDraft,
  draftFromEvent,
  flattenWritableCalendars,
  inferNoWritableReason,
  normalizeBatchDrafts,
  normalizeDraftForDirty,
  normalizeRecurrenceDraft,
  ymdFromView,
} from "./calendarEventEditorModel";
import type {
  CalendarRecurrenceScope,
  CalendarView,
  NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import {
  applyCalendarTitleAssistToDraft,
  projectCalendarEventEditorValidation,
  removeCalendarEventBatchDraft,
  seedCalendarEventDraftFromSources,
  updateCalendarEventBatchDraft,
} from "./calendarEventEditorSessionModel";

type CalendarEditorMode = "detail" | "editor";
type TouchedCalendarFields = Partial<Record<keyof CalendarEventDraft, boolean>>;

export interface CalendarEventEditorOptions {
  open: boolean;
  view: CalendarView;
  editable?: boolean;
  selectedDay?: number | null;
  selectedDate?: string | null;
  viewYear: number;
  viewMonth: number;
  refreshRange?: (start: string, end: string) => Promise<unknown> | unknown;
  upsertEvents?: (events: NormalizedCalendarEvent | NormalizedCalendarEvent[]) => void;
  removeEvent?: (eventId: string) => void;
  onFocusDate?: (date: string) => void;
  onSaved?: (event: NormalizedCalendarEvent | null, metadata: Record<string, unknown>) => void;
  onDeleted?: (event: NormalizedCalendarEvent) => void;
}

export interface CalendarEventEditorInput extends Omit<Partial<NormalizedCalendarEvent>, "id" | "startMs" | "endMs"> {
  id?: string | number | null;
  startMs?: number | null;
  endMs?: number | null;
}

function editorErrorDetails(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === "string" && candidate.message ? candidate.message : fallback,
      code: typeof candidate.code === "string" ? candidate.code : null,
    };
  }
  return { message: fallback, code: null };
}

export default function useCalendarEventEditor({
  open,
  view,
  editable = true,
  selectedDay,
  selectedDate: selectedDateOverride,
  viewYear,
  viewMonth,
  refreshRange,
  upsertEvents,
  removeEvent,
  onFocusDate,
  onSaved,
  onDeleted,
}: CalendarEventEditorOptions) {
  const [mode, setMode] = useState<CalendarEditorMode>("detail");
  const [draft, setDraft] = useState(() => defaultDraft(null));
  const {
    eventReminders,
    setEventReminders,
    removedReminderIds,
    setRemovedReminderIds,
    reminderError,
    setReminderError,
    customReminder,
    setCustomReminder,
    updateCustomReminder,
    addEventReminderPreset,
    addCustomEventReminder,
    removeEventReminder,
    eventReminderPresetStates,
  } = useEventReminderDrafts({ draft });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [batchDrafts, setBatchDrafts] = useState<CalendarBatchDraft[]>([]);
  const [recurringEditScope, setRecurringEditScope] = useState<CalendarRecurrenceScope | null>(null);
  const [createSeedDraft, setCreateSeedDraft] = useState(() => defaultDraft(null));
  const pendingSaveRef = useRef(false);
  // Synchronous in-flight guard (P1-1). `saving` state updates asynchronously
  // and the Cmd/Ctrl+Enter hotkey bypasses the Save button's disabled state, so
  // a ref is the only thing that can block a second synchronous save() before
  // the first one's await resolves. Distinct from pendingSaveRef (debounce-flush
  // re-fire), which is not a concurrency guard.
  const savingRef = useRef(false);
  const [manualOverrides, setManualOverrides] = useState(() => createManualOverrides());
  const [editingEvent, setEditingEvent] = useState<NormalizedCalendarEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const clearFieldError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);
  const {
    recurrenceDraft,
    setRecurrenceDraft,
    manualRecurrenceOverride,
    setManualRecurrenceOverride,
    updateRecurrenceDraft,
    selectRecurrencePreset,
    toggleRecurrenceWeekday,
  } = useEventRecurrenceDraft({ draft, clearFieldError });
  const [touchedFields, setTouchedFields] = useState<TouchedCalendarFields>({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const editorHistoryTokenRef = useRef<string | null>(null);
  const editorRequestIdRef = useRef(0);
  const selectLocationRef = useRef<((location: string) => void) | null>(null);
  // The parsed @token query a Places resolution has already answered. The
  // title rewrite that consumes the token is debounced, so without this the
  // draft-sync effect re-applies the stale token text over the resolved place.
  const lastCommittedLocationQueryRef = useRef("");
  const handleSourcesLoadStart = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);
  const handleSourcesLoadError = useCallback((err: unknown) => {
    const details = editorErrorDetails(err, "Failed to load calendar sources.");
    setError(details.message);
    setErrorCode(details.code);
  }, []);
  const {
    sourceGroups,
    sourceGroupsRef,
    sourcesLoading,
    ensureSources,
  } = useCalendarSources({
    editable,
    onLoadStart: handleSourcesLoadStart,
    onLoadError: handleSourcesLoadError,
  });
  const handleLocationSelect = useCallback((location: string) => {
    selectLocationRef.current?.(location);
  }, []);
  const {
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    selectLocationSuggestion,
    moveActiveLocationSuggestion,
    acceptActiveLocationSuggestion,
    clearLocationSuggestions,
    clearLocationSuggestionsError,
    resetLocationSuggestions,
  } = useCalendarLocationSuggestions({
    enabled: mode === "editor" && editable,
    query: draft.location,
    onSelectLocation: handleLocationSelect,
  });

  const selectedDate = selectedDateOverride || ymdFromView({ viewYear, viewMonth, selectedDay });
  const writableCalendars = useMemo(
    () => {
      const writable = flattenWritableCalendars(sourceGroups);
      if (!editingEvent?.accountId) return writable;
      return writable.filter((entry) => entry.accountId === editingEvent.accountId);
    },
    [editingEvent?.accountId, sourceGroups],
  );
  const isEditing = !!editingEvent;
  const isEditingRecurring = !!(editingEvent?.isRecurring);
  const commitTitleInput = useCallback((value: string) => {
    setTouchedFields((current) => (current.title ? current : { ...current, title: true }));
    if (!isEditing) return;
    setDraft((current) => {
      if (current.title === value) return current;
      return { ...current, title: value };
    });
  }, [isEditing]);
  const {
    titleInput,
    titleInputRef,
    titleInputKey,
    titleInputPending,
    titleAssist,
    intentState,
    effectiveTitle,
    handleTitleInputChange,
    seedTitleInput,
    clearTitleInput,
    flushPendingTitle,
  } = useCalendarEventTitleComposer({
    createSeedDraft,
    draftTitle: draft.title,
    isEditing,
    isEditingRecurring,
    recurringEditScope,
    touchedTitle: !!touchedFields.title,
    onInputStart: clearFieldError,
    onCommitTitle: commitTitleInput,
  });

  // Pass recurrenceDraft into the batch validator so a recurrence-then-batch
  // sequence blocks the save instead of silently dropping recurrence.
  const {
    validationMessage,
    visibleValidationMessage,
    canSave,
  } = useMemo(() => projectCalendarEventEditorValidation({
    draft,
    effectiveTitle,
    intentMode: intentState.mode,
    batchDrafts,
    recurrenceDraft,
    isEditing,
    isEditingRecurring,
    recurringEditScope,
    touchedTitle: !!touchedFields.title,
    saveAttempted,
    editable,
    saving,
    deleting,
  }), [batchDrafts, deleting, draft, editable, effectiveTitle, intentState.mode, isEditing, isEditingRecurring, recurrenceDraft, recurringEditScope, saveAttempted, saving, touchedFields.title]);
  const dirtyBaselineRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!open || view !== "events") {
      setMode("detail");
      setEditingEvent(null);
      setConfirmDelete(false);
      setError(null);
      setErrorCode(null);
      setTouchedFields({});
      setSaveAttempted(false);
      setManualOverrides(createManualOverrides());
      setBatchDrafts([]);
      setRecurrenceDraft(null);
      setManualRecurrenceOverride(false);
      setRecurringEditScope(null);
      clearTitleInput();
      setEventReminders([]);
      setRemovedReminderIds([]);
      setReminderError(null);
      setCustomReminder({ date: "", time: "" });
      resetLocationSuggestions();
    }
  }, [clearTitleInput, open, resetLocationSuggestions, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds, view]);

  useEffect(() => {
    if (mode !== "editor") return;
    if (isEditing && !touchedFields.title) return;
    if (!titleAssist.locationQuery) lastCommittedLocationQueryRef.current = "";
    setDraft((current) => applyCalendarTitleAssistToDraft({
      draft: current,
      titleAssist,
      manualOverrides: {
        startDate: manualOverrides.startDate,
        endDate: manualOverrides.endDate,
        startTime: manualOverrides.startTime,
        endTime: manualOverrides.endTime,
        location: manualOverrides.location,
        allDay: manualOverrides.allDay,
      },
      createSeedDraft,
      lastCommittedLocationQuery: lastCommittedLocationQueryRef.current,
    }));
  }, [createSeedDraft, isEditing, manualOverrides.allDay, manualOverrides.endDate, manualOverrides.endTime, manualOverrides.location, manualOverrides.startDate, manualOverrides.startTime, mode, titleAssist, touchedFields.title]);

  useEffect(() => {
    if (mode !== "editor" || isEditing) return;
    if (intentState.mode === "batch") {
      setBatchDrafts(normalizeBatchDrafts(intentState.batchDrafts));
      return;
    }
    setBatchDrafts((current) => (current.length ? [] : current));
  }, [intentState.batchDrafts, intentState.mode, isEditing, mode]);

  useEffect(() => {
    if (mode !== "editor") return;
    // P3-9: a batch title cannot carry a recurrence rule (the save path picks one or
    // the other), so drop any active recurrenceDraft on entering batch mode even when
    // manualRecurrenceOverride is set. Without this, a recurrence-then-batch sequence
    // kept the manual override and silently created the batch events as one-offs.
    if (intentState.mode === "batch" && !isEditingRecurring) {
      if (manualRecurrenceOverride) setManualRecurrenceOverride(false);
      setRecurrenceDraft((current) => (current ? null : current));
      return;
    }
    if (intentState.mode === "recurring") {
      if (isEditingRecurring && recurringEditScope === "one") return;
      if (manualRecurrenceOverride) return;
      setManualRecurrenceOverride(false);
      setRecurrenceDraft(normalizeRecurrenceDraft(intentState.recurrenceDraft, draftRef.current));
      return;
    }
    if (!isEditingRecurring && !manualRecurrenceOverride) {
      setRecurrenceDraft((current) => (current ? null : current));
    }
  }, [intentState.mode, intentState.recurrenceDraft, isEditingRecurring, manualRecurrenceOverride, mode, recurringEditScope, setManualRecurrenceOverride, setRecurrenceDraft]);

  const clearEditorState = useCallback(() => {
    editorRequestIdRef.current += 1;
    setMode("detail");
    setEditingEvent(null);
    setConfirmDelete(false);
    setError(null);
    setErrorCode(null);
    setTouchedFields({});
    setSaveAttempted(false);
    setManualOverrides(createManualOverrides());
    setBatchDrafts([]);
    setRecurrenceDraft(null);
    setManualRecurrenceOverride(false);
    setRecurringEditScope(null);
    clearTitleInput();
    setEventReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    setCustomReminder({ date: "", time: "" });
    resetLocationSuggestions();
  }, [clearTitleInput, resetLocationSuggestions, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds]);

  const openCreate = useCallback(async () => {
    if (!editable) return;
    const requestId = editorRequestIdRef.current + 1;
    editorRequestIdRef.current = requestId;
    const initialGroups = sourceGroupsRef.current;
    const nextDraft = seedCalendarEventDraftFromSources(defaultDraft(selectedDate), initialGroups);
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
    dirtyBaselineRef.current = normalizeDraftForDirty({
      draft: nextDraft,
      effectiveTitle: "",
      titleInput: "",
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: null,
      recurringEditScope: null,
    });

    const groups = await ensureSources();
    if (editorRequestIdRef.current !== requestId) return;

    setDraft((current) => {
      const seeded = seedCalendarEventDraftFromSources(current, groups);
      dirtyBaselineRef.current = normalizeDraftForDirty({
        draft: seeded,
        effectiveTitle: "",
        titleInput: "",
        intentMode: "single",
        batchDrafts: [],
        recurrenceDraft: null,
        recurringEditScope: null,
      });
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
  }, [editable, ensureSources, resetLocationSuggestions, seedTitleInput, selectedDate, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds, sourceGroupsRef]);

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
    setRecurrenceDraft(normalizedEvent.isRecurring && normalizedEvent.recurrence ? normalizeRecurrenceDraft(normalizedEvent.recurrence, nextDraft) : null);
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
    } catch (err) {
      setReminderError(editorErrorDetails(err, "Failed to load reminders.").message);
    }
    dirtyBaselineRef.current = normalizeDraftForDirty({
      draft: nextDraft,
      effectiveTitle: nextDraft.title,
      titleInput: nextDraft.title,
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: normalizedEvent.isRecurring && normalizedEvent.recurrence ? normalizeRecurrenceDraft(normalizedEvent.recurrence, nextDraft) : null,
      recurringEditScope: null,
    });
  }, [editable, ensureSources, resetLocationSuggestions, seedTitleInput, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds]);

  const closeEditor = useCallback(() => {
    clearEditorState();
  }, [clearEditorState]);

  const selectRecurringEditScope = useCallback((scope: CalendarRecurrenceScope) => {
    setRecurringEditScope(scope);
    setConfirmDelete(false);
    if (scope === "one") {
      setRecurrenceDraft(null);
    } else if (editingEvent?.recurrence) {
      setRecurrenceDraft(normalizeRecurrenceDraft(editingEvent.recurrence, draft));
    }
    setManualRecurrenceOverride(false);
    setError(null);
    setErrorCode(null);
  }, [draft, editingEvent, setManualRecurrenceOverride, setRecurrenceDraft]);

  const updateField = useCallback(<K extends keyof CalendarEventDraft>(
    field: K,
    value: CalendarEventDraft[K],
    options: { markTouched?: boolean; markOverride?: boolean } = {},
  ) => {
    const { markTouched = true, markOverride = true } = options;
    setDraft((current) => ({ ...current, [field]: value }));
    if (markTouched) {
      setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
    }
    if (markOverride && Object.prototype.hasOwnProperty.call(createManualOverrides(), field)) {
      const overrideField = field as keyof CalendarManualOverrides;
      setManualOverrides((current) => (current[overrideField] ? current : { ...current, [overrideField]: true }));
    }
    if (field === "location") {
      clearLocationSuggestionsError();
    }
    setError(null);
    setErrorCode(null);
  }, [clearLocationSuggestionsError]);

  useLayoutEffect(() => {
    selectLocationRef.current = (location) => {
      // draft.location is the query the suggestion fetch ran with; record it
      // so the draft-sync effect stops re-applying that token over the
      // resolved place while the debounced title rewrite is pending.
      lastCommittedLocationQueryRef.current = draftRef.current?.location || "";
      updateField("location", location, {
        markTouched: true,
        markOverride: true,
      });
    };
    return () => {
      selectLocationRef.current = null;
    };
  }, [updateField]);

  const updateBatchDraft = useCallback((
    draftId: string,
    field: keyof Pick<CalendarBatchDraft, "title" | "startDate" | "endDate" | "startTime" | "endTime">,
    value: string,
  ) => {
    setBatchDrafts((current) => updateCalendarEventBatchDraft(current, draftId, field, value));
    setError(null);
    setErrorCode(null);
  }, []);

  const removeBatchDraft = useCallback((draftId: string) => {
    setBatchDrafts((current) => removeCalendarEventBatchDraft(current, draftId));
    setError(null);
    setErrorCode(null);
  }, []);

  const exitBatchMode = useCallback(() => {
    if (intentState.mode !== "batch") return;
    const singleDraft = titleAssist.singleDraft || batchDrafts[0] || null;
    const nextTitle = titleAssist.cleanTitle || singleDraft?.title || effectiveTitle || titleInput;
    seedTitleInput(nextTitle);
    setDraft((current) => ({
      ...current,
      ...(singleDraft ? {
        startDate: singleDraft.startDate || current.startDate,
        endDate: singleDraft.endDate || current.endDate,
        startTime: singleDraft.startTime || current.startTime,
        endTime: singleDraft.endTime || current.endTime,
        allDay: singleDraft.allDay ?? current.allDay,
      } : null),
      title: nextTitle,
    }));
    setManualOverrides((current) => ({
      ...current,
      startDate: !!singleDraft?.startDate || current.startDate,
      endDate: !!singleDraft?.endDate || current.endDate,
      startTime: !!singleDraft?.startTime || current.startTime,
      endTime: !!singleDraft?.endTime || current.endTime,
      allDay: singleDraft?.allDay != null || current.allDay,
    }));
    setTouchedFields((current) => (current.title ? current : { ...current, title: true }));
    setBatchDrafts([]);
    setError(null);
    setErrorCode(null);
  }, [batchDrafts, effectiveTitle, intentState.mode, seedTitleInput, titleAssist.cleanTitle, titleAssist.singleDraft, titleInput]);

  const save = useCallback(async () => {
    if (!editable) return;
    if (flushPendingTitle()) {
      pendingSaveRef.current = true;
      setSaveAttempted(true);
      return;
    }
    pendingSaveRef.current = false;
    setSaveAttempted(true);
    if (validationMessage) return;
    // Placed AFTER the validation/debounce-flush early-returns so a press
    // blocked by validation (or the deliberate debounce-flush bounce) never
    // latches the ref. Protects the hotkey, button, and pendingSaveRef re-fire.
    if (savingRef.current) return;
    // An @token whose Places suggestion was never explicitly accepted would
    // save the raw token text as the location. Resolve the active suggestion
    // first and bounce the save (same pattern as the title debounce flush) so
    // the re-fired save reads the resolved place from the draft. A dismissed
    // panel (suggestions cleared) or failed details fetch falls through and
    // saves the raw text.
    if (titleAssist.locationQuery && draft.location === titleAssist.locationQuery) {
      savingRef.current = true;
      let resolvedLocation = null;
      try {
        resolvedLocation = await acceptActiveLocationSuggestion();
      } finally {
        savingRef.current = false;
      }
      if (resolvedLocation) {
        pendingSaveRef.current = true;
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setErrorCode(null);

    try {
      const result = await saveCalendarEventAction({
        draft,
        batchDrafts,
        effectiveTitle,
        recurrenceDraft,
        editingEvent,
        isEditingRecurring,
        recurringEditScope,
        intentMode: (intentState.mode !== "batch" && recurrenceDraft
          ? "recurring"
          : intentState.mode) as "single" | "batch" | "recurring",
        eventReminders: {
          items: eventReminders,
          removedIds: removedReminderIds,
        },
      });

      if (result.kind === "batch-create") {
        if (result.shouldRefresh && result.bounds) await refreshRange?.(result.bounds.start, result.bounds.end);
        else if (result.shouldUpsert) upsertEvents?.(result.createdEvents);
        if (result.focusDate) onFocusDate?.(result.focusDate);

        if (result.failed.length) {
          setBatchDrafts(result.failedDrafts);
          setError(result.errorMessage);
          setErrorCode(result.errorCode);
          return;
        }

        setMode("detail");
        setEditingEvent(null);
        setConfirmDelete(false);
        setBatchDrafts([]);
        setEventReminders([]);
        setRemovedReminderIds([]);
        onSaved?.(result.createdEvents[0] || null, {
          kind: "batch-create",
          createdEvents: result.createdEvents,
        });
        return;
      }

      if (result.shouldRefresh && result.bounds) await refreshRange?.(result.bounds.start, result.bounds.end);
      else if (result.shouldUpsert) upsertEvents?.(result.savedEvent);
      if (result.focusDate) onFocusDate?.(result.focusDate);
      setMode("detail");
      setEditingEvent(null);
      setConfirmDelete(false);
      setEventReminders([]);
      setRemovedReminderIds([]);
      onSaved?.(result.savedEvent, {
        kind: result.kind,
      });
    } catch (err) {
      setError(formatCalendarEditorError(err, "Failed to save event."));
      setErrorCode(editorErrorDetails(err, "Failed to save event.").code);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [acceptActiveLocationSuggestion, batchDrafts, draft, editable, editingEvent, effectiveTitle, eventReminders, flushPendingTitle, intentState.mode, isEditingRecurring, onFocusDate, onSaved, recurrenceDraft, recurringEditScope, refreshRange, removedReminderIds, setEventReminders, setRemovedReminderIds, titleAssist.locationQuery, upsertEvents, validationMessage]);

  useEffect(() => {
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;
    save();
  });

  const reconnect = useCallback(async () => {
    try {
      const { url } = await getGmailAuthUrl();
      window.location.href = url;
    } catch (err) {
      const details = editorErrorDetails(err, "Failed to start Gmail reconnect.");
      setError(details.message);
      setErrorCode(details.code);
    }
  }, []);

  const confirmDeleteIntent = useCallback(() => {
    if (isEditingRecurring && !recurringEditScope) return;
    setConfirmDelete(true);
    setError(null);
    setErrorCode(null);
  }, [isEditingRecurring, recurringEditScope]);

  const cancelDelete = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  const remove = useCallback(async () => {
    if (!editingEvent) return;
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    setErrorCode(null);
    try {
      const result = await deleteCalendarEventAction({
        editingEvent,
        isEditingRecurring,
        recurringEditScope,
      });
      if (result.shouldRefresh && result.bounds) {
        await refreshRange?.(result.bounds.start, result.bounds.end);
      } else if (result.shouldRemove) {
        removeEvent?.(editingEvent.id);
      }
      onDeleted?.(editingEvent);
      closeEditor();
    } catch (err) {
      const details = editorErrorDetails(err, "Failed to delete event.");
      setError(details.message);
      setErrorCode(details.code);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [closeEditor, editingEvent, isEditingRecurring, onDeleted, recurringEditScope, refreshRange, removeEvent]);

  const dirtySnapshot = useMemo(() => normalizeDraftForDirty({
    draft,
    effectiveTitle,
    titleInput,
    intentMode: intentState.mode,
    batchDrafts,
    recurrenceDraft,
    recurringEditScope,
  }), [batchDrafts, draft, effectiveTitle, intentState.mode, recurrenceDraft, recurringEditScope, titleInput]);
  const isDirty = mode === "editor"
    && !!dirtyBaselineRef.current
    && (dirtyBaselineRef.current !== dirtySnapshot || titleInputPending);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function handlePopState() {
      if (!editorHistoryTokenRef.current) return;
      editorHistoryTokenRef.current = null;
      clearEditorState();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearEditorState]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (mode === "editor" && open && view === "events") {
      if (editorHistoryTokenRef.current) return;
      const token = `ea-calendar-editor-${Date.now()}`;
      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
      window.history.pushState({ ...currentState, eaCalendarEditorToken: token }, "");
      editorHistoryTokenRef.current = token;
      return;
    }

    const token = editorHistoryTokenRef.current;
    if (!token) return;
    editorHistoryTokenRef.current = null;
    if (window.history.state?.eaCalendarEditorToken === token) {
      window.history.back();
    }
  }, [mode, open, view]);

  return {
    editable,
    mode,
    isEditorOpen: mode === "editor",
    isDirty,
    isEditing,
    isEditingRecurring,
    editingEvent,
    draft,
    titleInput,
    titleInputRef,
    titleInputKey,
    titleAssist,
    intentState,
    batchDrafts,
    recurrenceDraft,
    manualRecurrenceOverride,
    recurringEditScope,
    effectiveTitle,
    writableCalendars,
    sourceGroups,
    sourcesLoading,
    error,
    errorCode,
    validationMessage: visibleValidationMessage,
    canSave,
    saving,
    deleting,
    confirmDelete,
    eventReminders,
    eventReminderPresetStates,
    reminderError,
    customReminder,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    prefetchSources: ensureSources,
    openCreate,
    openEdit,
    closeEditor,
    updateField,
    updateBatchDraft,
    removeBatchDraft,
    exitBatchMode,
    updateRecurrenceDraft,
    updateCustomReminder,
    addEventReminderPreset,
    addCustomEventReminder,
    removeEventReminder,
    selectRecurrencePreset,
    toggleRecurrenceWeekday,
    selectRecurringEditScope,
    handleTitleInputChange,
    selectLocationSuggestion,
    moveActiveLocationSuggestion,
    acceptActiveLocationSuggestion,
    clearLocationSuggestions,
    save,
    reconnect,
    confirmDeleteIntent,
    cancelDelete,
    remove,
  };
}
