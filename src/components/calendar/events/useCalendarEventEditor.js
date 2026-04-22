import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createCalendarEvent,
  createCalendarEventsBatch,
  deleteCalendarEvent,
  getCalendarPlaceDetails,
  getCalendarPlaceSuggestions,
  getCalendarSources,
  getGmailAuthUrl,
  updateCalendarEvent,
} from "@/api";
import { parseCalendarTitle } from "./parseCalendarTitle";

function pacificYMD(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function pacificTime(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function addDaysIso(dateStr, delta) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function defaultDraft(selectedDate) {
  const date = selectedDate || todayYmd();
  return {
    title: "",
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: "09:00",
    endTime: "09:30",
    accountId: "",
    calendarId: "",
    location: "",
    description: "",
  };
}

function draftFromEvent(event) {
  const startDate = pacificYMD(event.startMs);
  const endDate = event.allDay
    ? addDaysIso(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs);

  return {
    title: event.title || "",
    allDay: !!event.allDay,
    startDate,
    endDate,
    startTime: event.allDay ? "09:00" : pacificTime(event.startMs),
    endTime: event.allDay ? "09:30" : pacificTime(event.endMs),
    accountId: event.accountId || "",
    calendarId: event.calendarId || "",
    location: event.location || "",
    description: event.description || "",
  };
}

function eventBounds(event) {
  if (!event) return null;
  const start = pacificYMD(event.startMs);
  const end = event.allDay
    ? addDaysIso(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs);
  return { start, end };
}

function draftBounds(draft) {
  if (!draft?.startDate) return null;
  return { start: draft.startDate, end: draft.endDate || draft.startDate };
}

function mergeBounds(...allBounds) {
  const bounds = allBounds.filter(Boolean);
  if (!bounds.length) return null;
  let start = bounds[0].start;
  let end = bounds[0].end;
  for (const entry of bounds.slice(1)) {
    if (entry.start < start) start = entry.start;
    if (entry.end > end) end = entry.end;
  }
  return { start, end };
}

function ymdFromView({ viewYear, viewMonth, selectedDay }) {
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

function flattenWritableCalendars(sourceGroups) {
  const flat = [];
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (!calendar.writable) continue;
      flat.push({
        accountId: group.accountId,
        accountLabel: group.accountLabel,
        value: `${group.accountId}::${calendar.id}`,
        calendarId: calendar.id,
        summary: calendar.summary,
        label: calendar.summary,
        color: calendar.backgroundColor || "#4285f4",
        primary: !!calendar.primary,
      });
    }
  }
  return flat;
}

function inferNoWritableReason(sourceGroups) {
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (calendar.accessRole === "owner" || calendar.accessRole === "writer") {
        return "calendar_reauth_required";
      }
    }
  }
  return "calendar_no_writable_sources";
}

function createManualOverrides() {
  return {
    startDate: false,
    endDate: false,
    startTime: false,
    endTime: false,
    location: false,
    allDay: false,
  };
}

function buildInactiveTitleAssist(rawTitle, cleanTitle) {
  return {
    rawTitle,
    mode: "single",
    cleanTitle,
    titleAfterSourceCommit: rawTitle,
    titleAfterLocationCommit: rawTitle,
    matchedText: "",
    locationQuery: "",
    sourceQuery: "",
    parsedDateTime: null,
    singleDraft: null,
    batchDrafts: [],
    recurrenceDraft: null,
    preview: "",
  };
}

function coerceEditingTitleAssist(parsedAssist, {
  active,
  fallbackTitle,
  isEditingRecurring,
  recurringEditScope,
}) {
  if (!active) {
    return buildInactiveTitleAssist(parsedAssist.rawTitle, fallbackTitle);
  }

  if (isEditingRecurring && recurringEditScope === "one" && !parsedAssist.parsedDateTime && !parsedAssist.locationQuery && !parsedAssist.sourceQuery) {
    return buildInactiveTitleAssist(parsedAssist.rawTitle, parsedAssist.rawTitle);
  }

  if (parsedAssist.mode === "batch") {
    return {
      ...parsedAssist,
      mode: "single",
      batchDrafts: [],
      recurrenceDraft: null,
    };
  }

  if (isEditingRecurring && recurringEditScope === "one" && parsedAssist.mode === "recurring") {
    return {
      ...parsedAssist,
      mode: "single",
      recurrenceDraft: null,
    };
  }

  return parsedAssist;
}

function clearLocationState(setters) {
  setters.setLocationSuggestions([]);
  setters.setLocationSuggestionsLoading(false);
  setters.setLocationSuggestionsError(null);
  setters.setActiveLocationSuggestion(0);
  setters.setPlacesSessionToken("");
}

function parsePositiveInt(value, fallback = 1) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

function createBatchDraftId(item, index) {
  return [
    "batch",
    index,
    item?.startDate || "no-start",
    item?.startTime || "no-start-time",
    item?.endDate || "no-end",
    item?.endTime || "no-end-time",
  ].join(":");
}

function toBatchEditorDraft(item, index, error) {
  return {
    id: createBatchDraftId(item, index),
    title: item?.title || "",
    startDate: item?.startDate || "",
    endDate: item?.endDate || item?.startDate || "",
    startTime: item?.startTime || "",
    endTime: item?.endTime || "",
    error: error || null,
  };
}

function normalizeBatchDrafts(items) {
  return (items || []).map((item, index) => toBatchEditorDraft(item, index));
}

function normalizeBatchDraftsWithErrors(failedEntries) {
  return (failedEntries || []).map((entry, index) =>
    toBatchEditorDraft(entry.input, index, entry.message || "Failed to create"),
  );
}

function normalizeRecurrenceDraft(input, draft) {
  const fallbackWeekday = new Date(`${draft?.startDate || todayYmd()}T12:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const fallbackCode = {
    Sun: "SU",
    Mon: "MO",
    Tue: "TU",
    Wed: "WE",
    Thu: "TH",
    Fri: "FR",
    Sat: "SA",
  }[fallbackWeekday] || "MO";
  const frequency = ["daily", "weekly", "monthly", "yearly"].includes(input?.frequency)
    ? input.frequency
    : "weekly";
  const weekdays = Array.isArray(input?.weekdays) && input.weekdays.length
    ? [...new Set(input.weekdays)]
    : frequency === "weekly"
      ? [fallbackCode]
      : [];
  const endsType = input?.ends?.type || "never";
  return {
    frequency,
    interval: parsePositiveInt(input?.interval, 1),
    weekdays,
    ends: endsType === "onDate"
      ? {
          type: "onDate",
          untilDate: input?.ends?.untilDate || draft?.startDate || todayYmd(),
        }
      : endsType === "afterCount"
        ? {
            type: "afterCount",
            count: parsePositiveInt(input?.ends?.count, 1),
          }
        : { type: "never" },
  };
}

function buildRecurrencePayload(recurrenceDraft, draft) {
  if (!recurrenceDraft) return null;
  const frequency = recurrenceDraft.frequency;
  const payload = {
    frequency,
    interval: parsePositiveInt(recurrenceDraft.interval, 1),
    ends: recurrenceDraft.ends?.type === "onDate"
      ? {
          type: "onDate",
          untilDate: recurrenceDraft.ends.untilDate,
        }
      : recurrenceDraft.ends?.type === "afterCount"
        ? {
            type: "afterCount",
            count: parsePositiveInt(recurrenceDraft.ends.count, 1),
          }
        : { type: "never" },
  };

  if (frequency === "weekly") payload.weekdays = recurrenceDraft.weekdays || [];
  if (frequency === "monthly" || frequency === "yearly") {
    payload.monthDay = Number((draft?.startDate || todayYmd()).slice(-2));
  }
  if (frequency === "yearly") {
    payload.month = Number((draft?.startDate || todayYmd()).slice(5, 7));
  }
  return payload;
}

function validateSingleDraft({ draft, effectiveTitle }) {
  if (!effectiveTitle) return "Title is required.";
  if (!draft.accountId || !draft.calendarId) return "Choose a writable calendar.";
  if (!draft.startDate || !draft.endDate) return "Start and end dates are required.";
  if (draft.endDate < draft.startDate) return "End date must be on or after the start date.";
  if (draft.allDay) return null;
  if (!draft.startTime || !draft.endTime) return "Start and end times are required.";
  const startIso = `${draft.startDate}T${draft.startTime}:00`;
  const endIso = `${draft.endDate}T${draft.endTime}:00`;
  if (endIso < startIso) return "End time must be on or after start time.";
  return null;
}

function validateBatchDrafts({ draft, batchDrafts, effectiveTitle }) {
  if (!effectiveTitle) return "Title is required.";
  if (!draft.accountId || !draft.calendarId) return "Choose a writable calendar.";
  if (!batchDrafts.length) return "Add at least one batch event before saving.";

  for (let index = 0; index < batchDrafts.length; index += 1) {
    const item = batchDrafts[index];
    if (!item.startDate || !item.endDate) return `Batch event ${index + 1} is missing a date.`;
    if (item.endDate < item.startDate) return `Batch event ${index + 1} ends before it starts.`;
    if (draft.allDay) continue;
    if (!item.startTime || !item.endTime) return `Batch event ${index + 1} is missing a time.`;
    const startIso = `${item.startDate}T${item.startTime}:00`;
    const endIso = `${item.endDate}T${item.endTime}:00`;
    if (endIso < startIso) return `Batch event ${index + 1} ends before it starts.`;
  }

  return null;
}

function validateRecurrenceDraft({ recurrenceDraft, draft }) {
  if (!recurrenceDraft) return "Recurring event setup is missing.";
  if (!Number.isInteger(Number(recurrenceDraft.interval)) || Number(recurrenceDraft.interval) <= 0) {
    return "Recurrence interval must be a positive integer.";
  }
  if (recurrenceDraft.frequency === "weekly" && !(recurrenceDraft.weekdays || []).length) {
    return "Choose at least one weekday for weekly recurrence.";
  }
  if (recurrenceDraft.ends?.type === "onDate") {
    if (!recurrenceDraft.ends.untilDate) return "Choose when this recurring event should stop.";
    if (draft?.startDate && recurrenceDraft.ends.untilDate < draft.startDate) {
      return "Recurrence end date must be on or after the event start date.";
    }
  }
  if (recurrenceDraft.ends?.type === "afterCount") {
    if (!Number.isInteger(Number(recurrenceDraft.ends.count)) || Number(recurrenceDraft.ends.count) <= 0) {
      return "Recurrence count must be a positive integer.";
    }
  }
  return null;
}

export default function useCalendarEventEditor({
  open,
  view,
  editable = true,
  selectedDay,
  viewYear,
  viewMonth,
  refreshRange,
  onFocusDate,
}) {
  const [mode, setMode] = useState("detail");
  const [sourceGroups, setSourceGroups] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
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
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSuggestionsLoading, setLocationSuggestionsLoading] = useState(false);
  const [locationSuggestionsError, setLocationSuggestionsError] = useState(null);
  const [activeLocationSuggestion, setActiveLocationSuggestion] = useState(0);
  const [placesSessionToken, setPlacesSessionToken] = useState("");
  const locationSuggestionsRef = useRef([]);
  const activeLocationSuggestionRef = useRef(0);
  const editorHistoryTokenRef = useRef(null);

  const selectedDate = ymdFromView({ viewYear, viewMonth, selectedDay });
  const writableCalendars = useMemo(
    () => flattenWritableCalendars(sourceGroups),
    [sourceGroups],
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

  const ensureSources = useCallback(async () => {
    if (!editable) return [];
    if (sourcesLoaded) return sourceGroups;

    setSourcesLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const data = await getCalendarSources();
      const groups = data?.accounts || [];
      setSourceGroups(groups);
      setSourcesLoaded(true);
      return groups;
    } catch (err) {
      setError(err.message || "Failed to load calendar sources.");
      setErrorCode(err.code || null);
      return [];
    } finally {
      setSourcesLoading(false);
    }
  }, [editable, sourceGroups, sourcesLoaded]);

  useLayoutEffect(() => {
    locationSuggestionsRef.current = locationSuggestions;
  }, [locationSuggestions]);

  useLayoutEffect(() => {
    activeLocationSuggestionRef.current = activeLocationSuggestion;
  }, [activeLocationSuggestion]);

  useEffect(() => {
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
      clearLocationState({
        setLocationSuggestions,
        setLocationSuggestionsLoading,
        setLocationSuggestionsError,
        setActiveLocationSuggestion,
        setPlacesSessionToken,
      });
    }
  }, [open, view]);

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
    clearLocationState({
      setLocationSuggestions,
      setLocationSuggestionsLoading,
      setLocationSuggestionsError,
      setActiveLocationSuggestion,
      setPlacesSessionToken,
    });
  }, []);

  useEffect(() => {
    if (mode !== "editor" || !editable) return undefined;
    const query = String(draft.location || "").trim();
    if (query.length < 2) {
      setLocationSuggestions([]);
      setLocationSuggestionsLoading(false);
      setLocationSuggestionsError(null);
      setActiveLocationSuggestion(0);
      return undefined;
    }

    const sessionToken = placesSessionToken || crypto.randomUUID();
    if (!placesSessionToken) setPlacesSessionToken(sessionToken);

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLocationSuggestionsLoading(true);
      setLocationSuggestionsError(null);
      try {
        const data = await getCalendarPlaceSuggestions(query, sessionToken);
        if (cancelled) return;
        setLocationSuggestions(data?.places || []);
        setActiveLocationSuggestion(0);
      } catch (err) {
        if (cancelled) return;
        setLocationSuggestions([]);
        setLocationSuggestionsError(err.message || "Failed to search locations.");
      } finally {
        if (!cancelled) setLocationSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.location, editable, mode, placesSessionToken]);

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
    const groups = await ensureSources();
    const nextDraft = seedDefaultCalendar(defaultDraft(selectedDate), groups);
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
    clearLocationState({
      setLocationSuggestions,
      setLocationSuggestionsLoading,
      setLocationSuggestionsError,
      setActiveLocationSuggestion,
      setPlacesSessionToken,
    });
    setMode("editor");
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
  }, [editable, ensureSources, seedDefaultCalendar, selectedDate]);

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
    clearLocationState({
      setLocationSuggestions,
      setLocationSuggestionsLoading,
      setLocationSuggestionsError,
      setActiveLocationSuggestion,
      setPlacesSessionToken,
    });
    setMode("editor");
    setError(null);
    setErrorCode(null);
  }, [editable, ensureSources, seedDefaultCalendar]);

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
      setLocationSuggestionsError(null);
    }
    setError(null);
    setErrorCode(null);
  }, []);

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

  const selectLocationSuggestion = useCallback(async (suggestion) => {
    if (!suggestion?.placeId) return;
    const sessionToken = placesSessionToken || crypto.randomUUID();
    if (!placesSessionToken) setPlacesSessionToken(sessionToken);
    setLocationSuggestionsLoading(true);
    setLocationSuggestionsError(null);
    try {
      const data = await getCalendarPlaceDetails(suggestion.placeId, sessionToken);
      const place = data?.place || null;
      updateField("location", place?.location || suggestion.fullText || suggestion.primaryText, {
        markTouched: true,
        markOverride: true,
      });
      setLocationSuggestions([]);
      setActiveLocationSuggestion(0);
      setPlacesSessionToken("");
    } catch (err) {
      setLocationSuggestionsError(err.message || "Failed to load place details.");
    } finally {
      setLocationSuggestionsLoading(false);
    }
  }, [placesSessionToken, updateField]);

  const moveActiveLocationSuggestion = useCallback((delta) => {
    const total = locationSuggestionsRef.current.length;
    if (!total) {
      activeLocationSuggestionRef.current = 0;
      setActiveLocationSuggestion(0);
      return;
    }
    const next = (activeLocationSuggestionRef.current + delta + total) % total;
    activeLocationSuggestionRef.current = next;
    setActiveLocationSuggestion(next);
  }, []);

  const acceptActiveLocationSuggestion = useCallback(async () => {
    const suggestion = locationSuggestionsRef.current[activeLocationSuggestionRef.current];
    if (!suggestion) return false;
    await selectLocationSuggestion(suggestion);
    return true;
  }, [selectLocationSuggestion]);

  const clearLocationSuggestions = useCallback(() => {
    setLocationSuggestions([]);
    setLocationSuggestionsError(null);
    setActiveLocationSuggestion(0);
  }, []);

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
        if (bounds) await refreshRange?.(bounds.start, bounds.end);
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
      if (bounds) await refreshRange?.(bounds.start, bounds.end);
      onFocusDate?.(pacificYMD(savedEvent.startMs));
      setMode("detail");
      setEditingEvent(null);
      setConfirmDelete(false);
    } catch (err) {
      setError(err.message || "Failed to save event.");
      setErrorCode(err.code || null);
    } finally {
      setSaving(false);
    }
  }, [batchDrafts, draft, editable, editingEvent, effectiveTitle, intentState.mode, isEditingRecurring, onFocusDate, recurrenceDraft, recurringEditScope, refreshRange, validationMessage]);

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
      if (bounds) await refreshRange?.(bounds.start, bounds.end);
      closeEditor();
    } catch (err) {
      setError(err.message || "Failed to delete event.");
      setErrorCode(err.code || null);
    } finally {
      setDeleting(false);
    }
  }, [closeEditor, editingEvent, isEditingRecurring, recurringEditScope, refreshRange]);

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
