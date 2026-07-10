import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getGmailAuthUrl, listReminders } from "@/api";
import {
  deleteCalendarEventAction,
  formatCalendarEditorError,
  saveCalendarEventAction,
} from "./calendarEventEditorActions";
import {
  ensureChrono,
  isChronoReady,
  parseCalendarTitle,
  subscribeChronoReady,
} from "./parseCalendarTitle";
import useCalendarLocationSuggestions from "./useCalendarLocationSuggestions";
import useCalendarSources from "./useCalendarSources";
import useEventReminderDrafts from "./useEventReminderDrafts";
import useEventRecurrenceDraft from "./useEventRecurrenceDraft";
import {
  eventReminderSourceFromEvent,
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
  const [batchDrafts, setBatchDrafts] = useState([]);
  const [recurringEditScope, setRecurringEditScope] = useState(null);
  const [createSeedDraft, setCreateSeedDraft] = useState(() => defaultDraft(null));
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef("");
  const titleDebounceRef = useRef(null);
  const pendingSaveRef = useRef(false);
  // Synchronous in-flight guard (P1-1). `saving` state updates asynchronously
  // and the Cmd/Ctrl+Enter hotkey bypasses the Save button's disabled state, so
  // a ref is the only thing that can block a second synchronous save() before
  // the first one's await resolves. Distinct from pendingSaveRef (debounce-flush
  // re-fire), which is not a concurrency guard.
  const savingRef = useRef(false);
  const [titleInputPending, setTitleInputPending] = useState(false);
  const [titleInputKey, setTitleInputKey] = useState(0);
  const [titleParseNow, setTitleParseNow] = useState(() => Date.now());
  // chrono-node is lazily imported (parseCalendarTitle keeps it out of the
  // calendar-open payload). Warm it on the first non-empty title keystroke and
  // bump this tick when it lands so the title-assist memo re-parses with the
  // full natural-language result. Until then the parse degrades gracefully to
  // the synchronous regex paths.
  const [chronoReadyTick, setChronoReadyTick] = useState(() => (isChronoReady() ? 1 : 0));
  const [manualOverrides, setManualOverrides] = useState(() => createManualOverrides());
  const [editingEvent, setEditingEvent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
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
  const [touchedFields, setTouchedFields] = useState({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const editorHistoryTokenRef = useRef(null);
  const editorRequestIdRef = useRef(0);
  const selectLocationRef = useRef(null);
  // The parsed @token query a Places resolution has already answered. The
  // title rewrite that consumes the token is debounced, so without this the
  // draft-sync effect re-applies the stale token text over the resolved place.
  const lastCommittedLocationQueryRef = useRef("");
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
  useEffect(() => {
    if (!titleInput || isChronoReady()) return undefined;
    ensureChrono();
    const unsubscribe = subscribeChronoReady(() => setChronoReadyTick((tick) => tick + 1));
    return unsubscribe;
  }, [titleInput]);
  const parsedTitleAssist = useMemo(() => parseCalendarTitle(titleInput, {
    now: titleParseNow,
    baseDate: createSeedDraft.startDate,
    defaultStartTime: createSeedDraft.startTime,
    defaultEndTime: createSeedDraft.endTime,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-parse once chrono lands
  }), [createSeedDraft.endTime, createSeedDraft.startDate, createSeedDraft.startTime, titleInput, titleParseNow, chronoReadyTick]);
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

  // Pass recurrenceDraft into the batch validator so a recurrence-then-batch
  // sequence blocks the save instead of silently dropping recurrence.
  const validationMessage = useMemo(() => {
    if (isEditingRecurring && !recurringEditScope) {
      return "Choose whether to edit all events, upcoming only, or just this one.";
    }
    if (!isEditing && intentState.mode === "batch") {
      return validateBatchDrafts({ draft, batchDrafts, effectiveTitle, recurrenceDraft });
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
      titleInputRef.current = "";
      if (titleDebounceRef.current) {
        clearTimeout(titleDebounceRef.current);
        titleDebounceRef.current = null;
      }
      setEventReminders([]);
      setRemovedReminderIds([]);
      setReminderError(null);
      setCustomReminder({ date: "", time: "" });
      resetLocationSuggestions();
    }
  }, [open, resetLocationSuggestions, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds, view]);

  useEffect(() => {
    if (mode !== "editor") return;
    if (isEditing && !touchedFields.title) return;
    if (!titleAssist.locationQuery) lastCommittedLocationQueryRef.current = "";
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
      if (titleAssist.locationQuery && titleAssist.locationQuery !== lastCommittedLocationQueryRef.current) next.location = titleAssist.locationQuery;
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
    titleInputRef.current = "";
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = null;
    }
    setEventReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    setCustomReminder({ date: "", time: "" });
    resetLocationSuggestions();
  }, [resetLocationSuggestions, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds]);

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
    titleInputRef.current = "";
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = null;
    }
    setTitleInputKey((k) => k + 1);
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
  }, [editable, ensureSources, resetLocationSuggestions, seedDefaultCalendar, selectedDate, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds, sourceGroupsRef]);

  const openEdit = useCallback(async (event) => {
    if (!editable || !event?.writable) return;
    const groups = await ensureSources();
    const nextDraft = seedDefaultCalendar(draftFromEvent(event), groups);
    setDraft(nextDraft);
    setCreateSeedDraft(nextDraft);
    setTitleInput(nextDraft.title);
    titleInputRef.current = nextDraft.title;
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = null;
    }
    setTitleInputKey((k) => k + 1);
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
  }, [editable, ensureSources, resetLocationSuggestions, seedDefaultCalendar, setCustomReminder, setEventReminders, setManualRecurrenceOverride, setRecurrenceDraft, setReminderError, setRemovedReminderIds]);

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
  }, [draft, editingEvent, setManualRecurrenceOverride, setRecurrenceDraft]);

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
    titleInputRef.current = nextTitle;
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = null;
    }
    setTitleInput(nextTitle);
    setTitleInputKey((k) => k + 1);
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

  const TITLE_DEBOUNCE_MS = 120;

  const handleTitleInputChange = useCallback((value) => {
    titleInputRef.current = value;
    setError(null);
    setErrorCode(null);
    setTitleInputPending(true);

    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(() => {
      titleDebounceRef.current = null;
      setTitleInputPending(false);
      setTitleInput(value);
      setTouchedFields((current) => (current.title ? current : { ...current, title: true }));
      if (isEditing) {
        setDraft((current) => {
          if (current.title === value) return current;
          return { ...current, title: value };
        });
      }
    }, TITLE_DEBOUNCE_MS);
  }, [isEditing]);

  // Cancel the pending title-input debounce on unmount so the timer cannot
  // fire into an unmounted hook.
  useEffect(() => () => {
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
  }, []);

  const save = useCallback(async () => {
    if (!editable) return;
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = null;
      setTitleInput(titleInputRef.current);
      setTouchedFields((current) => (current.title ? current : { ...current, title: true }));
      if (isEditing) {
        setDraft((current) => {
          if (current.title === titleInputRef.current) return current;
          return { ...current, title: titleInputRef.current };
        });
      }
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
      savingRef.current = false;
      setSaving(false);
    }
  }, [acceptActiveLocationSuggestion, batchDrafts, draft, editable, editingEvent, effectiveTitle, eventReminders, intentState.mode, isEditing, isEditingRecurring, onFocusDate, onSaved, recurrenceDraft, recurringEditScope, refreshRange, removedReminderIds, setEventReminders, setRemovedReminderIds, titleAssist.locationQuery, upsertEvents, validationMessage]);

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
      setError(err.message || "Failed to delete event.");
      setErrorCode(err.code || null);
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
