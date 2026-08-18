import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useCalendarLocationSuggestions from "./useCalendarLocationSuggestions";
import useCalendarSources from "./useCalendarSources";
import useCalendarEditorHistory from "./useCalendarEditorHistory";
import useCalendarEventEditorSession from "./useCalendarEventEditorSession";
export type { CalendarEventEditorInput } from "./useCalendarEventEditorSession";
import useCalendarEventMutations from "./useCalendarEventMutations";
import useEventReminderDrafts from "./useEventReminderDrafts";
import useEventRecurrenceDraft from "./useEventRecurrenceDraft";
import useCalendarEventTitleComposer from "./useCalendarEventTitleComposer";
import useCalendarEventCreateCoordination from "./useCalendarEventCreateCoordination";
import { getCalendarEditorErrorDetails } from "./calendarEventEditorErrors";
import {
  type CalendarBatchDraft,
  type CalendarEventDraft,
  type CalendarManualOverrides,
  createManualOverrides,
  defaultDraft,
  flattenWritableCalendars,
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
    timeToLeaveReminder, enableTimeToLeave, updateTimeToLeaveBuffer, removeTimeToLeave,
  } = useEventReminderDrafts({ draft });
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [batchDrafts, setBatchDrafts] = useState<CalendarBatchDraft[]>([]);
  const [recurringEditScope, setRecurringEditScope] = useState<CalendarRecurrenceScope | null>(null);
  const [createSeedDraft, setCreateSeedDraft] = useState(() => defaultDraft(null));
  const [structuredCreateSeed, setStructuredCreateSeed] = useState(false);
  const [manualOverrides, setManualOverrides] = useState(() => createManualOverrides());
  const [editingEvent, setEditingEvent] = useState<NormalizedCalendarEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    const details = getCalendarEditorErrorDetails(err, "Failed to load calendar sources.");
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
    [editingEvent, sourceGroups],
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
    suppressAssist: structuredCreateSeed && !touchedFields.title,
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
  useLayoutEffect(() => {
    if (!open || view !== "events") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the local editor session when its owning surface closes
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- title intent is the source of truth for generated batch drafts
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

  const dirtySnapshot = useMemo(() => normalizeDraftForDirty({
    draft,
    effectiveTitle,
    titleInput,
    intentMode: intentState.mode,
    batchDrafts,
    recurrenceDraft,
    recurringEditScope,
  }), [batchDrafts, draft, effectiveTitle, intentState.mode, recurrenceDraft, recurringEditScope, titleInput]);
  const { captureDirtyBaseline, isDirty } = useCalendarEditorHistory({
    open,
    view,
    mode,
    dirtySnapshot,
    titleInputPending,
    onPopState: clearEditorState,
  });

  const { openCreate: openCreateSession, openEdit: openEditSession } = useCalendarEventEditorSession({
    editable,
    selectedDate,
    requestIdRef: editorRequestIdRef,
    sourceGroupsRef,
    ensureSources,
    seedTitleInput,
    resetLocationSuggestions,
    captureDirtyBaseline,
    setters: {
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
    },
  });

  const { clearCreateCoordination, openCreate, openEdit, handleSaved } = useCalendarEventCreateCoordination({
    openCreateSession, openEditSession, setStructuredCreateSeed, onSaved,
  });

  useLayoutEffect(() => {
    if (mode !== "editor" || !open || view !== "events") clearCreateCoordination();
  }, [clearCreateCoordination, mode, open, view]);

  const closeEditor = useCallback(() => {
    clearCreateCoordination();
    clearEditorState();
  }, [clearCreateCoordination, clearEditorState]);

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

  const {
    save,
    reconnect,
    confirmDeleteIntent,
    cancelDelete,
    remove,
  } = useCalendarEventMutations({
    editable,
    state: {
      draft,
      batchDrafts,
      effectiveTitle,
      recurrenceDraft,
      editingEvent,
      isEditingRecurring,
      recurringEditScope,
      intentMode: intentState.mode,
      eventReminders,
      removedReminderIds,
      validationMessage,
      titleLocationQuery: titleAssist.locationQuery,
    },
    setters: {
      setMode,
      setEditingEvent,
      setBatchDrafts,
      setEventReminders,
      setRemovedReminderIds,
      setError,
      setErrorCode,
      setSaveAttempted,
      setSaving,
      setDeleting,
      setConfirmDelete,
    },
    effects: {
      flushPendingTitle,
      acceptActiveLocationSuggestion,
      refreshRange,
      upsertEvents,
      removeEvent,
      onFocusDate,
      onSaved: handleSaved,
      onDeleted,
      closeEditor,
    },
  });

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
    timeToLeaveReminder, enableTimeToLeave, updateTimeToLeaveBuffer, removeTimeToLeave,
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
