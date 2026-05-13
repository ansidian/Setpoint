import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getGmailAuthUrl, listReminders } from "@/api";
import {
  deleteCalendarEventAction,
  formatCalendarEditorError,
  saveCalendarEventAction,
} from "./calendarEventEditorActions";
import { parseCalendarTitle } from "./parseCalendarTitle";
import useCalendarLocationSuggestions from "./useCalendarLocationSuggestions";
import useCalendarSources from "./useCalendarSources";
import {
  createEventReminderDraftFromCustom,
  createEventReminderDraftFromOffset,
  EVENT_REMINDER_PRESETS,
  eventReminderSourceFromEvent,
  getEventReminderPresetState,
} from "./calendarEventReminderModel";
import {
  coerceEditingTitleAssist,
  createManualOverrides,
  defaultDraft,
  draftFromEvent,
  flattenWritableCalendars,
  inferNoWritableReason,
  normalizeBatchDrafts,
  normalizeDraftForDirty,
  normalizeRecurrenceDraft,
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
  const [manualRecurrenceOverride, setManualRecurrenceOverride] = useState(false);
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
  const [eventReminders, setEventReminders] = useState([]);
  const [removedReminderIds, setRemovedReminderIds] = useState([]);
  const [reminderError, setReminderError] = useState(null);
  const [customReminder, setCustomReminder] = useState({ date: "", time: "" });
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
    const hasActiveRecurrence = !!recurrenceDraft && (!isEditingRecurring || recurringEditScope !== "one");
    if ((intentState.mode === "recurring" || hasActiveRecurrence) && (!isEditingRecurring || recurringEditScope !== "one")) {
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
      setBatchDrafts([]);
      setRecurrenceDraft(null);
      setManualRecurrenceOverride(false);
      setRecurringEditScope(null);
      setTitleInput("");
      setEventReminders([]);
      setRemovedReminderIds([]);
      setReminderError(null);
      setCustomReminder({ date: "", time: "" });
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
      if (manualRecurrenceOverride) return;
      setManualRecurrenceOverride(false);
      setRecurrenceDraft(normalizeRecurrenceDraft(intentState.recurrenceDraft, draftRef.current));
      return;
    }
    if (!isEditingRecurring && !manualRecurrenceOverride) {
      setRecurrenceDraft((current) => (current ? null : current));
    }
  }, [intentState.mode, intentState.recurrenceDraft, isEditingRecurring, manualRecurrenceOverride, mode, recurringEditScope]);

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
    setEventReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    setCustomReminder({ date: "", time: "" });
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
      colorId: nextDraft.colorId || preferred.defaultEventColorId || null,
      sourceColor: preferred.color || null,
      sourceColorId: preferred.defaultEventColorId || null,
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
    setManualRecurrenceOverride(false);
    setRecurringEditScope(null);
    setEditingEvent(event);
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
      const source = eventReminderSourceFromEvent(event);
      const result = await listReminders({
        sourceType: source.sourceType,
        sourceItemId: source.sourceItemId,
        sourceOccurrenceId: source.sourceOccurrenceId,
      });
      setEventReminders(result.reminders || []);
    } catch (err) {
      setReminderError(err.message || "Failed to load reminders.");
    }
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

  const updateCustomReminder = useCallback((patch) => {
    setCustomReminder((current) => ({ ...current, ...patch }));
    setReminderError(null);
  }, []);

  const addReminderDraft = useCallback((nextReminder) => {
    if (nextReminder.blocked) {
      setReminderError(nextReminder.blockReason === "duplicate"
        ? "That reminder is already on this event."
        : nextReminder.blockReason === "past"
          ? "Choose a future reminder time."
          : "Choose an event start before adding a reminder.");
      return;
    }
    setEventReminders((current) => [...current, nextReminder]);
    setReminderError(null);
  }, []);

  const addEventReminderPreset = useCallback((offsetMinutes) => {
    addReminderDraft(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes,
      existingReminders: eventReminders,
    }));
  }, [addReminderDraft, draft, eventReminders]);

  const addCustomEventReminder = useCallback((selection = null) => {
    const reminderSelection = selection || customReminder;
    addReminderDraft(createEventReminderDraftFromCustom({
      draft,
      reminderDate: reminderSelection.date,
      reminderTime: reminderSelection.time,
      existingReminders: eventReminders,
    }));
  }, [addReminderDraft, customReminder, draft, eventReminders]);

  const eventReminderPresetStates = useMemo(() => {
    return Object.fromEntries(EVENT_REMINDER_PRESETS.map((preset) => [
      preset.offsetMinutes,
      getEventReminderPresetState({
        draft,
        offsetMinutes: preset.offsetMinutes,
        existingReminders: eventReminders,
      }),
    ]));
  }, [draft, eventReminders]);

  const removeEventReminder = useCallback((reminder) => {
    if (reminder?.id) {
      setRemovedReminderIds((current) => (
        current.includes(reminder.id) ? current : [...current, reminder.id]
      ));
    }
    setEventReminders((current) => current.filter((entry) => {
      if (reminder?.id) return entry.id !== reminder.id;
      return entry.clientId !== reminder?.clientId;
    }));
    setReminderError(null);
  }, []);

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
    setManualRecurrenceOverride(false);
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

  const exitBatchMode = useCallback(() => {
    if (intentState.mode !== "batch") return;
    const singleDraft = titleAssist.singleDraft || batchDrafts[0] || null;
    const nextTitle = titleAssist.cleanTitle || singleDraft?.title || effectiveTitle || titleInput;
    setTitleInput(nextTitle);
    setTitleParseNow(Date.now());
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
  }, [batchDrafts, effectiveTitle, intentState.mode, titleAssist.cleanTitle, titleAssist.singleDraft, titleInput]);

  const updateRecurrenceDraft = useCallback((field, value) => {
    setManualRecurrenceOverride(true);
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

  const selectRecurrencePreset = useCallback((frequency) => {
    setManualRecurrenceOverride(true);
    if (!frequency) {
      setRecurrenceDraft(null);
      setError(null);
      setErrorCode(null);
      return;
    }
    setRecurrenceDraft((current) => normalizeRecurrenceDraft({
      ...current,
      frequency,
      interval: current?.interval || 1,
      ends: current?.ends || { type: "never" },
    }, draft));
    setError(null);
    setErrorCode(null);
  }, [draft]);

  const toggleRecurrenceWeekday = useCallback((weekday) => {
    setManualRecurrenceOverride(true);
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

    try {
      const result = await saveCalendarEventAction({
        draft,
        batchDrafts,
        effectiveTitle,
        recurrenceDraft,
        editingEvent,
        isEditingRecurring,
        recurringEditScope,
        intentMode: intentState.mode !== "batch" && recurrenceDraft ? "recurring" : intentState.mode,
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
      setErrorCode(err.code || null);
    } finally {
      setSaving(false);
    }
  }, [batchDrafts, draft, editable, editingEvent, effectiveTitle, eventReminders, intentState.mode, isEditingRecurring, onFocusDate, onSaved, recurrenceDraft, recurringEditScope, refreshRange, removedReminderIds, upsertEvents, validationMessage]);

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
