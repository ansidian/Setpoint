import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createCalendarEvent,
  createCalendarEventsBatch,
  deleteCalendarEvent,
  getGmailAuthUrl,
  updateCalendarEvent,
} from "@/api";
import { parseCalendarTitle } from "./parseCalendarTitle";
import useCalendarLocationSuggestions from "./useCalendarLocationSuggestions";
import useCalendarSources from "./useCalendarSources";
import {
  buildRecurrencePayload,
  coerceEditingTitleAssist,
  createManualOverrides,
  defaultDraft,
  draftBounds,
  draftFromEvent,
  eventBounds,
  flattenWritableCalendars,
  inferNoWritableReason,
  mergeBounds,
  normalizeBatchDrafts,
  normalizeBatchDraftsWithErrors,
  normalizeDraftForDirty,
  normalizeRecurrenceDraft,
  pacificYMD,
  parsePositiveInt,
  todayYmd,
  validateBatchDrafts,
  validateRecurrenceDraft,
  validateSingleDraft,
  ymdFromView,
} from "./calendarEventEditorModel";

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
}) {
  const [mode, setMode] = useState("detail");
  const [draft, setDraft] = useState(() => defaultDraft(null));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [batchDrafts, setBatchDrafts] = useState([]);
  const [recurrenceDraft, setRecurrenceDraft] = useState(null);
  const [recurringEditScope, setRecurringEditScope] = useState(null);
  const [createSeedDraft, setCreateSeedDraft] = useState(() => defaultDraft(null));
  const [titleInput, setTitleInput] = useState("");
  const [titleParseNow, setTitleParseNow] = useState(() => Date.now());
  const [manualOverrides, setManualOverrides] = useState(() => createManualOverrides());
  const [editingEvent, setEditingEvent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [touchedFields, setTouchedFields] = useState({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const editorHistoryTokenRef = useRef(null);
  const editorRequestIdRef = useRef(0);
  const selectLocationRef = useRef(null);
  const handleSourcesLoadStart = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);
  const handleSourcesLoadError = useCallback((err) => {
    setError(err.message || "Failed to load calendar sources.");
    setErrorCode(err.code || null);
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
  const handleLocationSelect = useCallback((location) => {
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
  const parsedTitleAssist = useMemo(() => parseCalendarTitle(titleInput, {
    now: titleParseNow,
    baseDate: createSeedDraft.startDate,
    defaultStartTime: createSeedDraft.startTime,
    defaultEndTime: createSeedDraft.endTime,
  }), [createSeedDraft.endTime, createSeedDraft.startDate, createSeedDraft.startTime, titleInput, titleParseNow]);
  const titleAssist = useMemo(() => (
    isEditing
      ? coerceEditingTitleAssist(parsedTitleAssist, {
          active: !!touchedFields.title,
          fallbackTitle: draft.title,
          isEditingRecurring,
          recurringEditScope,
        })
      : parsedTitleAssist
  ), [draft.title, isEditing, isEditingRecurring, parsedTitleAssist, recurringEditScope, touchedFields.title]);
  const intentState = useMemo(() => ({
    mode: titleAssist.mode || "single",
    singleDraft: titleAssist.singleDraft || null,
    batchDrafts: titleAssist.batchDrafts || [],
    recurrenceDraft: titleAssist.recurrenceDraft || null,
  }), [titleAssist.batchDrafts, titleAssist.mode, titleAssist.recurrenceDraft, titleAssist.singleDraft]);
  const effectiveTitle = useMemo(
    () => String(titleAssist.cleanTitle || "").trim(),
    [titleAssist.cleanTitle],
  );

  const validationMessage = useMemo(() => {
    if (isEditingRecurring && !recurringEditScope) {
      return "Choose whether to edit all events, upcoming only, or just this one.";
    }
    if (!isEditing && intentState.mode === "batch") {
      return validateBatchDrafts({ draft, batchDrafts, effectiveTitle });
    }
    const baseValidation = validateSingleDraft({ draft, effectiveTitle });
    if (baseValidation) return baseValidation;
    if (intentState.mode === "recurring" && (!isEditingRecurring || recurringEditScope !== "one")) {
      return validateRecurrenceDraft({ recurrenceDraft, draft });
    }
    return null;
  }, [batchDrafts, draft, effectiveTitle, intentState.mode, isEditing, isEditingRecurring, recurrenceDraft, recurringEditScope]);
  const visibleValidationMessage = useMemo(() => {
    if (!validationMessage) return null;
    if (validationMessage === "Title is required." && !touchedFields.title && !saveAttempted) {
      return null;
    }
    return validationMessage;
  }, [saveAttempted, touchedFields.title, validationMessage]);
  const canSave = editable && !saving && !deleting && !validationMessage;
  const dirtyBaselineRef = useRef(null);

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
      setRecurringEditScope(null);
      setTitleInput("");
      resetLocationSuggestions();
    }
  }, [open, resetLocationSuggestions, view]);

  useEffect(() => {
    if (mode !== "editor") return;
    if (isEditing && !touchedFields.title) return;
    setDraft((current) => {
      const next = {
        ...current,
        title: titleAssist.cleanTitle,
      };

      const parsed = titleAssist.parsedDateTime;
      const derivedDraft = titleAssist.singleDraft;
      if (!manualOverrides.startDate) next.startDate = derivedDraft?.startDate || parsed?.startDate || createSeedDraft.startDate;
      if (!manualOverrides.endDate) next.endDate = derivedDraft?.endDate || parsed?.endDate || createSeedDraft.endDate;
      if (!manualOverrides.startTime) next.startTime = derivedDraft?.startTime || parsed?.startTime || createSeedDraft.startTime;
      if (!manualOverrides.endTime) next.endTime = derivedDraft?.endTime || parsed?.endTime || createSeedDraft.endTime;
      if (titleAssist.locationQuery) next.location = titleAssist.locationQuery;
      else if (!manualOverrides.location) next.location = createSeedDraft.location;

      if (
        next.title === current.title
        && next.startDate === current.startDate
        && next.endDate === current.endDate
        && next.startTime === current.startTime
        && next.endTime === current.endTime
        && next.location === current.location
      ) {
        return current;
      }

      return next;
    });
  }, [createSeedDraft, isEditing, manualOverrides.endDate, manualOverrides.endTime, manualOverrides.location, manualOverrides.startDate, manualOverrides.startTime, mode, titleAssist, touchedFields.title]);

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
    if (intentState.mode === "recurring") {
      if (isEditingRecurring && recurringEditScope === "one") return;
      setRecurrenceDraft(normalizeRecurrenceDraft(intentState.recurrenceDraft, draftRef.current));
      return;
    }
    if (!isEditingRecurring) {
      setRecurrenceDraft((current) => (current ? null : current));
    }
  }, [intentState.mode, intentState.recurrenceDraft, isEditingRecurring, mode, recurringEditScope]);

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
    setRecurringEditScope(null);
    resetLocationSuggestions();
  }, [resetLocationSuggestions]);

  const seedDefaultCalendar = useCallback((nextDraft, groups) => {
    if (nextDraft.accountId && nextDraft.calendarId) return nextDraft;
    const writable = flattenWritableCalendars(groups);
    const preferred = writable.find((entry) => entry.primary) || writable[0];
    if (!preferred) return nextDraft;
    return {
      ...nextDraft,
      accountId: preferred.accountId,
      calendarId: preferred.calendarId,
    };
  }, []);

  const openCreate = useCallback(async () => {
    if (!editable) return;
    const requestId = editorRequestIdRef.current + 1;
    editorRequestIdRef.current = requestId;
    const initialGroups = sourceGroupsRef.current;
    const nextDraft = seedDefaultCalendar(defaultDraft(selectedDate), initialGroups);
    setDraft(nextDraft);
    setCreateSeedDraft(nextDraft);
    setTitleInput("");
    setTitleParseNow(Date.now());
    setManualOverrides(createManualOverrides());
    setRecurrenceDraft(null);
    setRecurringEditScope(null);
    setEditingEvent(null);
    setConfirmDelete(false);
    setTouchedFields({});
    setSaveAttempted(false);
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
      const seeded = seedDefaultCalendar(current, groups);
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
    setCreateSeedDraft((current) => seedDefaultCalendar(current, groups));
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
  }, [editable, ensureSources, resetLocationSuggestions, seedDefaultCalendar, selectedDate, sourceGroupsRef]);

  const openEdit = useCallback(async (event) => {
    if (!editable || !event?.writable) return;
    const groups = await ensureSources();
    const nextDraft = seedDefaultCalendar(draftFromEvent(event), groups);
    setDraft(nextDraft);
    setCreateSeedDraft(nextDraft);
    setTitleInput(nextDraft.title);
    setTitleParseNow(Date.now());
    setManualOverrides(createManualOverrides());
    setBatchDrafts([]);
    setRecurrenceDraft(event?.isRecurring && event?.recurrence ? normalizeRecurrenceDraft(event.recurrence, nextDraft) : null);
    setRecurringEditScope(null);
    setEditingEvent(event);
    setConfirmDelete(false);
    setTouchedFields({});
    setSaveAttempted(false);
    resetLocationSuggestions();
    setMode("editor");
    setError(null);
    setErrorCode(null);
    dirtyBaselineRef.current = normalizeDraftForDirty({
      draft: nextDraft,
      effectiveTitle: nextDraft.title,
      titleInput: nextDraft.title,
      intentMode: "single",
      batchDrafts: [],
      recurrenceDraft: event?.isRecurring && event?.recurrence ? normalizeRecurrenceDraft(event.recurrence, nextDraft) : null,
      recurringEditScope: null,
    });
  }, [editable, ensureSources, resetLocationSuggestions, seedDefaultCalendar]);

  const closeEditor = useCallback(() => {
    clearEditorState();
  }, [clearEditorState]);

  const selectRecurringEditScope = useCallback((scope) => {
    setRecurringEditScope(scope);
    setConfirmDelete(false);
    if (scope === "one") {
      setRecurrenceDraft(null);
    } else if (editingEvent?.recurrence) {
      setRecurrenceDraft(normalizeRecurrenceDraft(editingEvent.recurrence, draft));
    }
    setError(null);
    setErrorCode(null);
  }, [draft, editingEvent]);

  const updateField = useCallback((field, value, options = {}) => {
    const { markTouched = true, markOverride = true } = options;
    setDraft((current) => ({ ...current, [field]: value }));
    if (markTouched) {
      setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
    }
    if (markOverride && Object.prototype.hasOwnProperty.call(createManualOverrides(), field)) {
      setManualOverrides((current) => (current[field] ? current : { ...current, [field]: true }));
    }
    if (field === "location") {
      clearLocationSuggestionsError();
    }
    setError(null);
    setErrorCode(null);
  }, [clearLocationSuggestionsError]);

  useLayoutEffect(() => {
    selectLocationRef.current = (location) => {
      updateField("location", location, {
        markTouched: true,
        markOverride: true,
      });
    };
    return () => {
      selectLocationRef.current = null;
    };
  }, [updateField]);

  const updateBatchDraft = useCallback((draftId, field, value) => {
    setBatchDrafts((current) => current.map((item) => {
      if (item.id !== draftId) return item;
      const next = { ...item, [field]: value };
      if (field === "startDate" && next.endDate && next.endDate < value) {
        next.endDate = value;
      }
      return next;
    }));
    setError(null);
    setErrorCode(null);
  }, []);

  const removeBatchDraft = useCallback((draftId) => {
    setBatchDrafts((current) => current.filter((item) => item.id !== draftId));
    setError(null);
    setErrorCode(null);
  }, []);

  const updateRecurrenceDraft = useCallback((field, value) => {
    setRecurrenceDraft((current) => {
      const existing = normalizeRecurrenceDraft(current, draft);
      if (field === "frequency") {
        return normalizeRecurrenceDraft({
          ...existing,
          frequency: value,
          weekdays: value === "weekly" ? existing.weekdays : [],
        }, draft);
      }
      if (field === "interval") {
        return {
          ...existing,
          interval: parsePositiveInt(value, 1),
        };
      }
      if (field === "endsType") {
        return normalizeRecurrenceDraft({
          ...existing,
          ends: value === "onDate"
            ? { type: "onDate", untilDate: draft.startDate || todayYmd() }
            : value === "afterCount"
              ? { type: "afterCount", count: 1 }
              : { type: "never" },
        }, draft);
      }
      if (field === "untilDate") {
        return {
          ...existing,
          ends: { type: "onDate", untilDate: value },
        };
      }
      if (field === "count") {
        return {
          ...existing,
          ends: { type: "afterCount", count: parsePositiveInt(value, 1) },
        };
      }
      return existing;
    });
    setError(null);
    setErrorCode(null);
  }, [draft]);

  const toggleRecurrenceWeekday = useCallback((weekday) => {
    setRecurrenceDraft((current) => {
      const existing = normalizeRecurrenceDraft(current, draft);
      const weekdays = existing.weekdays.includes(weekday)
        ? existing.weekdays.filter((entry) => entry !== weekday)
        : [...existing.weekdays, weekday];
      return {
        ...existing,
        weekdays,
      };
    });
    setError(null);
    setErrorCode(null);
  }, [draft]);

  const handleTitleInputChange = useCallback((value) => {
    setTitleInput(value);
    if (isEditing) {
      setDraft((current) => ({ ...current, title: value }));
    }
    setTouchedFields((current) => (current.title ? current : { ...current, title: true }));
    setError(null);
    setErrorCode(null);
  }, [isEditing]);

  const save = useCallback(async () => {
    if (!editable) return;
    setSaveAttempted(true);
    if (validationMessage) return;
    setSaving(true);
    setError(null);
    setErrorCode(null);

    const payload = {
      accountId: draft.accountId,
      calendarId: draft.calendarId,
      title: effectiveTitle,
      allDay: draft.allDay,
      startDate: draft.startDate,
      endDate: draft.endDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      location: draft.location,
      description: draft.description,
    };
    const shouldSendRecurrence = !!recurrenceDraft && (
      editingEvent
        ? isEditingRecurring
          ? recurringEditScope !== "one"
          : intentState.mode === "recurring"
        : intentState.mode === "recurring"
    );

    try {
      let savedEvent;
      if (!editingEvent && intentState.mode === "batch") {
        const items = batchDrafts.map((item) => ({
          accountId: draft.accountId,
          calendarId: draft.calendarId,
          title: item.title || effectiveTitle,
          allDay: draft.allDay,
          startDate: item.startDate,
          endDate: item.endDate,
          startTime: draft.allDay ? null : item.startTime,
          endTime: draft.allDay ? null : item.endTime,
          location: draft.location,
          description: draft.description,
        }));
        const result = await createCalendarEventsBatch(items);
        const createdEvents = (result?.created || [])
          .map((entry) => entry?.event)
          .filter(Boolean);
        const failed = result?.failed || [];
        const bounds = mergeBounds(...createdEvents.map((event) => eventBounds(event)));
        if (failed.length && bounds) await refreshRange?.(bounds.start, bounds.end);
        else upsertEvents?.(createdEvents);
        if (createdEvents[0]?.startMs) onFocusDate?.(pacificYMD(createdEvents[0].startMs));

        if (failed.length) {
          setBatchDrafts(normalizeBatchDraftsWithErrors(failed));
          setError(
            createdEvents.length
              ? `Created ${createdEvents.length} event${createdEvents.length === 1 ? "" : "s"}, but ${failed.length} still need review.`
              : failed[0]?.message || "Failed to create batch events.",
          );
          setErrorCode(failed[0]?.code || "calendar_batch_partial_failed");
          return;
        }

        setMode("detail");
        setEditingEvent(null);
        setConfirmDelete(false);
        setBatchDrafts([]);
        onSaved?.(createdEvents[0] || null, {
          kind: "batch-create",
          createdEvents,
        });
        return;
      }

      if (!editingEvent && intentState.mode === "recurring") {
        const result = await createCalendarEvent({
          ...payload,
          recurrence: buildRecurrencePayload(recurrenceDraft, draft),
        });
        savedEvent = result.event;
      } else if (editingEvent) {
        const result = await updateCalendarEvent(editingEvent.id, {
          ...payload,
          sourceAccountId: editingEvent.accountId,
          sourceCalendarId: editingEvent.calendarId,
          etag: editingEvent.etag,
          scope: isEditingRecurring ? recurringEditScope : undefined,
          recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
          originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
          recurrence: shouldSendRecurrence
            ? buildRecurrencePayload(recurrenceDraft, draft)
            : undefined,
        });
        savedEvent = result.event;
      } else {
        const result = await createCalendarEvent(payload);
        savedEvent = result.event;
      }

      const bounds = mergeBounds(eventBounds(editingEvent), draftBounds(draft), eventBounds(savedEvent));
      if ((!editingEvent && intentState.mode === "recurring") || (editingEvent && (isEditingRecurring || shouldSendRecurrence))) {
        if (bounds) await refreshRange?.(bounds.start, bounds.end);
      } else {
        upsertEvents?.(savedEvent);
      }
      onFocusDate?.(pacificYMD(savedEvent.startMs));
      setMode("detail");
      setEditingEvent(null);
      setConfirmDelete(false);
      onSaved?.(savedEvent, {
        kind: editingEvent ? "update" : "create",
      });
    } catch (err) {
      setError(err.message || "Failed to save event.");
      setErrorCode(err.code || null);
    } finally {
      setSaving(false);
    }
  }, [batchDrafts, draft, editable, editingEvent, effectiveTitle, intentState.mode, isEditingRecurring, onFocusDate, onSaved, recurrenceDraft, recurringEditScope, refreshRange, upsertEvents, validationMessage]);

  const reconnect = useCallback(async () => {
    try {
      const { url } = await getGmailAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message || "Failed to start Gmail reconnect.");
      setErrorCode(err.code || null);
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
    setDeleting(true);
    setError(null);
    setErrorCode(null);
    try {
      await deleteCalendarEvent(editingEvent.id, {
        accountId: editingEvent.accountId,
        calendarId: editingEvent.calendarId,
        etag: editingEvent.etag,
        scope: isEditingRecurring ? recurringEditScope : undefined,
        recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
        originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
      });
      const bounds = eventBounds(editingEvent);
      if (isEditingRecurring) {
        if (bounds) await refreshRange?.(bounds.start, bounds.end);
      } else {
        removeEvent?.(editingEvent.id);
      }
      onDeleted?.(editingEvent);
      closeEditor();
    } catch (err) {
      setError(err.message || "Failed to delete event.");
      setErrorCode(err.code || null);
    } finally {
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
    && dirtyBaselineRef.current !== dirtySnapshot;

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
    titleAssist,
    intentState,
    batchDrafts,
    recurrenceDraft,
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
    updateRecurrenceDraft,
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
