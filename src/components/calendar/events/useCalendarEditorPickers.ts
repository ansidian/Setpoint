import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type useCalendarEventEditor from "./useCalendarEventEditor";
import type { WritableCalendarOption } from "./calendarEventEditorModel";

export type CalendarSchedulePickerField = "startDate" | "endDate" | "startTime" | "endTime";
export type CalendarEditorPicker = "source" | "location" | "startDate" | "endDate" | "startTime" | "endTime" | "schedule" | `schedule:${CalendarSchedulePickerField}` | "recurrence" | "conflicts";

const DATE_PICKER_WIDTH = 300;
const DATE_PICKER_HEIGHT = 386;
const SCHEDULE_PICKER_WIDTH = 620;
const SCHEDULE_PICKER_HEIGHT = 380;
const TIME_PICKER_WIDTH = 280;
const TIME_PICKER_HEIGHT = 238;
const SOURCE_PICKER_WIDTH = 320;
const SOURCE_PICKER_HEIGHT = 280;
const LOCATION_PICKER_WIDTH = 360;
const LOCATION_PICKER_HEIGHT = 240;
const RECURRENCE_PICKER_COMPACT_WIDTH = 232;
const RECURRENCE_PICKER_COMPACT_HEIGHT = 320;
const RECURRENCE_PICKER_WIDTH = 620;
const RECURRENCE_PICKER_HEIGHT = 380;
const CONFLICT_PICKER_WIDTH = 420;
const CONFLICT_PICKER_HEIGHT = 480;

export default function useCalendarEditorPickers(editor: ReturnType<typeof useCalendarEventEditor>) {
  const {
    draft,
    titleInput,
    titleAssist,
    isEditorOpen,
    isEditing,
    editingEvent,
    writableCalendars,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    updateField,
    handleTitleInputChange,
    moveActiveLocationSuggestion,
    acceptActiveLocationSuggestion,
    clearLocationSuggestions,
    recurrenceDraft,
    save,
  } = editor;

  const [openPicker, setOpenPickerRaw] = useState<CalendarEditorPicker | null>(null);
  const [activeSourceSuggestion, setActiveSourceSuggestion] = useState(0);
  const [dismissedAutoLocationQuery, setDismissedAutoLocationQuery] = useState("");
  const [dismissedAutoSourceQuery, setDismissedAutoSourceQuery] = useState("");
  const [nowTick] = useState(() => Date.now());
  const titleRef = useRef<HTMLInputElement | null>(null);
  const sourceRef = useRef<HTMLButtonElement | null>(null);
  const locationRef = useRef<HTMLButtonElement | null>(null);
  const startDateRef = useRef<HTMLButtonElement | null>(null);
  const endDateRef = useRef<HTMLButtonElement | null>(null);
  const startTimeRef = useRef<HTMLButtonElement | null>(null);
  const endTimeRef = useRef<HTMLButtonElement | null>(null);
  const repeatRef = useRef<HTMLButtonElement | null>(null);
  const conflictRef = useRef<HTMLButtonElement | null>(null);
  const activeSourceSuggestionRef = useRef(0);
  const setOpenPicker = useCallback((nextValue: SetStateAction<CalendarEditorPicker | null>) => {
    setOpenPickerRaw((prev) => (
      typeof nextValue === "function" ? nextValue(prev) : nextValue
    ));
  }, []);
  const toggleOpenPicker = useCallback((nextPicker: CalendarEditorPicker) => {
    if (nextPicker === "source") {
      const selectedValue = draft.accountId && draft.calendarId
        ? `${draft.accountId}::${draft.calendarId}`
        : "";
      const selectedIndex = Math.max(0, writableCalendars.findIndex((item) => item.value === selectedValue));
      activeSourceSuggestionRef.current = selectedIndex;
      setActiveSourceSuggestion(selectedIndex);
    }
    setOpenPickerRaw((current) => {
      const currentGroup = current?.startsWith("schedule:") ? "schedule" : current;
      const nextGroup = nextPicker.startsWith("schedule:") ? "schedule" : nextPicker;
      return currentGroup === nextGroup ? null : nextPicker;
    });
  }, [draft.accountId, draft.calendarId, writableCalendars]);

  useEffect(() => {
    if (!openPicker) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenPicker(null);
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [openPicker, setOpenPicker]);

  useEffect(() => {
    if (!isEditorOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const title = titleRef.current;
      title?.focus({ preventScroll: true });
      if (!title) return;
      if (isEditing) {
        const cursorPosition = String(title.value || "").length;
        title.setSelectionRange?.(cursorPosition, cursorPosition);
      } else {
        title.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingEvent?.id, isEditing, isEditorOpen]);

  useEffect(() => {
    activeSourceSuggestionRef.current = activeSourceSuggestion;
  }, [activeSourceSuggestion]);

  useEffect(() => {
    function handleSaveHotkey(event: KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      save();
    }

    document.addEventListener("keydown", handleSaveHotkey, true);
    return () => document.removeEventListener("keydown", handleSaveHotkey, true);
  }, [save]);

  const sharedDatePickerProps = {
    onClose: () => setOpenPicker(null),
    width: DATE_PICKER_WIDTH,
    height: DATE_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedTimePickerProps = {
    onClose: () => setOpenPicker(null),
    width: TIME_PICKER_WIDTH,
    height: TIME_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedSchedulePickerProps = {
    onClose: () => setOpenPicker(null),
    width: SCHEDULE_PICKER_WIDTH,
    height: SCHEDULE_PICKER_HEIGHT,
    scrollable: false,
    mobileHeight: "min(620px, calc(100dvh - 20px))",
    role: "dialog",
    style: {
      minHeight: SCHEDULE_PICKER_HEIGHT,
      overflow: "hidden",
      padding: 10,
      zIndex: 10001,
    },
  };

  const sharedSourcePickerProps = {
    onClose: () => setOpenPicker(null),
    width: SOURCE_PICKER_WIDTH,
    height: SOURCE_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedLocationPickerProps = {
    onClose: () => {
      setOpenPicker(null);
      clearLocationSuggestions();
    },
    width: LOCATION_PICKER_WIDTH,
    height: LOCATION_PICKER_HEIGHT,
    matchAnchorWidth: true,
    minWidth: 280,
    maxWidth: LOCATION_PICKER_WIDTH,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedRecurrencePickerProps = {
    onClose: () => setOpenPicker(null),
    width: recurrenceDraft ? RECURRENCE_PICKER_WIDTH : RECURRENCE_PICKER_COMPACT_WIDTH,
    height: recurrenceDraft ? RECURRENCE_PICKER_HEIGHT : RECURRENCE_PICKER_COMPACT_HEIGHT,
    mobileHeight: "min(620px, calc(100dvh - 20px))",
    animatePosition: true,
    animateSize: true,
    role: "dialog",
    style: {
      height: `min(${recurrenceDraft ? RECURRENCE_PICKER_HEIGHT : RECURRENCE_PICKER_COMPACT_HEIGHT}px, calc(100vh - 20px))`,
      overflow: "hidden",
      padding: 10,
      zIndex: 10001,
    },
  };

  const sharedConflictPickerProps = {
    onClose: () => setOpenPicker(null),
    width: CONFLICT_PICKER_WIDTH,
    height: CONFLICT_PICKER_HEIGHT,
    minWidth: 300,
    maxWidth: CONFLICT_PICKER_WIDTH,
    mobileHeight: null,
    role: "dialog",
    style: {
      maxHeight: `min(${CONFLICT_PICKER_HEIGHT}px, calc(100vh - 20px))`,
      overflow: "auto",
      padding: 12,
      zIndex: 10001,
    },
  };

  const missingCalendar = !draft.accountId || !draft.calendarId;
  const selectedSource = useMemo(() => (
    writableCalendars.find((entry) => entry.value === `${draft.accountId}::${draft.calendarId}`) || null
  ), [draft.accountId, draft.calendarId, writableCalendars]);
  const invalidDateRange = !!draft.startDate && !!draft.endDate && draft.endDate < draft.startDate;
  const invalidTimeRange = !draft.allDay
    && !!draft.startDate
    && !!draft.endDate
    && !!draft.startTime
    && !!draft.endTime
    && `${draft.endDate}T${draft.endTime}:00` < `${draft.startDate}T${draft.startTime}:00`;
  const showTitleAssist = !!titleAssist.locationQuery || !!titleAssist.sourceQuery;
  const parsedSourceQuery = String(titleAssist.sourceQuery || "").trim();
  const parsedLocationQuery = String(titleAssist.locationQuery || "").trim();
  const filteredSourceSuggestions = useMemo(() => {
    const normalizedQuery = parsedSourceQuery.toLowerCase();
    if (!normalizedQuery) return writableCalendars;
    return writableCalendars.filter((entry) => {
      const haystack = [
        entry.summary,
        entry.label,
        entry.accountLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [parsedSourceQuery, writableCalendars]);
  const showAutoSourceSuggestions = !openPicker
    && !!parsedSourceQuery
    && dismissedAutoSourceQuery !== parsedSourceQuery;
  const showSourceSuggestions = openPicker === "source" || showAutoSourceSuggestions;
  const showAutoLocationSuggestions = !showSourceSuggestions
    && !openPicker
    && !!parsedLocationQuery
    && draft.location === parsedLocationQuery
    && dismissedAutoLocationQuery !== parsedLocationQuery;
  const showLocationSuggestions = openPicker === "location" || (showAutoLocationSuggestions
    && (
      locationSuggestionsLoading
      || !!locationSuggestionsError
      || locationSuggestions.length > 0
      || String(draft.location || "").trim().length >= 2
    ));
  const shouldConsumeParsedSourceFromTitle = !!parsedSourceQuery
    && titleInput !== titleAssist.titleAfterSourceCommit;
  const shouldConsumeParsedLocationFromTitle = !!parsedLocationQuery
    && draft.location === parsedLocationQuery
    && titleInput !== titleAssist.titleAfterLocationCommit;

  const closeSourceSuggestions = useCallback(() => {
    if (showAutoSourceSuggestions) {
      setDismissedAutoSourceQuery(parsedSourceQuery);
    } else {
      setOpenPicker(null);
    }
    setActiveSourceSuggestion(0);
  }, [parsedSourceQuery, setOpenPicker, showAutoSourceSuggestions]);

  const closeLocationSuggestions = useCallback(() => {
    if (showAutoLocationSuggestions) {
      setDismissedAutoLocationQuery(parsedLocationQuery);
    } else {
      setOpenPicker(null);
    }
    clearLocationSuggestions();
  }, [clearLocationSuggestions, parsedLocationQuery, setOpenPicker, showAutoLocationSuggestions]);

  const consumeParsedLocationFromTitle = useCallback(() => {
    if (!shouldConsumeParsedLocationFromTitle) return;
    const nextValue = titleAssist.titleAfterLocationCommit;
    if (titleRef.current) titleRef.current.value = nextValue;
    handleTitleInputChange(nextValue);
    setDismissedAutoLocationQuery("");
  }, [handleTitleInputChange, shouldConsumeParsedLocationFromTitle, titleAssist.titleAfterLocationCommit]);

  const consumeParsedSourceFromTitle = useCallback(() => {
    if (!shouldConsumeParsedSourceFromTitle) return;
    const nextValue = titleAssist.titleAfterSourceCommit;
    if (titleRef.current) titleRef.current.value = nextValue;
    handleTitleInputChange(nextValue);
    setDismissedAutoSourceQuery("");
  }, [handleTitleInputChange, shouldConsumeParsedSourceFromTitle, titleAssist.titleAfterSourceCommit]);

  const selectSourceSuggestion = useCallback((item: WritableCalendarOption | null | undefined) => {
    if (!item) return;
    updateField("accountId", item.accountId, { markTouched: false, markOverride: false });
    updateField("calendarId", item.calendarId, { markTouched: false, markOverride: false });
    updateField("colorId", item.defaultEventColorId || null, { markTouched: false, markOverride: false });
    updateField("sourceColor", item.color || null, { markTouched: false, markOverride: false });
    updateField("sourceColorId", item.defaultEventColorId || null, { markTouched: false, markOverride: false });
    consumeParsedSourceFromTitle();
    setOpenPicker(null);
    setActiveSourceSuggestion(0);
  }, [consumeParsedSourceFromTitle, setOpenPicker, updateField]);

  const handleSourceSuggestionKey = useCallback(async (event: React.KeyboardEvent) => {
    if (!showSourceSuggestions) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (filteredSourceSuggestions.length) {
        const next = (activeSourceSuggestionRef.current + 1) % filteredSourceSuggestions.length;
        activeSourceSuggestionRef.current = next;
        setActiveSourceSuggestion(next);
      }
      setOpenPicker("source");
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (filteredSourceSuggestions.length) {
        const next = (activeSourceSuggestionRef.current - 1 + filteredSourceSuggestions.length) % filteredSourceSuggestions.length;
        activeSourceSuggestionRef.current = next;
        setActiveSourceSuggestion(next);
      }
      setOpenPicker("source");
      return true;
    }
    if (event.key === "Enter" && filteredSourceSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      selectSourceSuggestion(filteredSourceSuggestions[activeSourceSuggestionRef.current] || filteredSourceSuggestions[0]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSourceSuggestions();
      return true;
    }
    return false;
  }, [closeSourceSuggestions, filteredSourceSuggestions, selectSourceSuggestion, setOpenPicker, showSourceSuggestions]);

  const handleLocationSuggestionKey = useCallback(async (event: React.KeyboardEvent) => {
    if (!showLocationSuggestions) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveActiveLocationSuggestion(1);
      setOpenPicker("location");
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveActiveLocationSuggestion(-1);
      setOpenPicker("location");
      return true;
    }
    if (event.key === "Enter" && locationSuggestions.length > 0) {
      const accepted = await acceptActiveLocationSuggestion();
      if (accepted) {
        consumeParsedLocationFromTitle();
        event.preventDefault();
        event.stopPropagation();
        setOpenPicker(null);
      }
      return accepted;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLocationSuggestions();
      return true;
    }
    return false;
  }, [
    acceptActiveLocationSuggestion,
    consumeParsedLocationFromTitle,
    closeLocationSuggestions,
    locationSuggestions.length,
    moveActiveLocationSuggestion,
    setOpenPicker,
    showLocationSuggestions,
  ]);

  const onTitleKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (await handleSourceSuggestionKey(event)) return;
    if (await handleLocationSuggestionKey(event)) return;
    event.stopPropagation();
  }, [handleSourceSuggestionKey, handleLocationSuggestionKey]);

  const onTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    activeSourceSuggestionRef.current = 0;
    setActiveSourceSuggestion(0);
    setOpenPicker(null);
    setDismissedAutoSourceQuery("");
    setDismissedAutoLocationQuery("");
    handleTitleInputChange(event.target.value);
  }, [handleTitleInputChange, setOpenPicker]);

  return {
    openPicker,
    setOpenPicker,
    toggleOpenPicker,
    nowTick,
    titleRef,
    sourceRef,
    locationRef,
    startDateRef,
    endDateRef,
    startTimeRef,
    endTimeRef,
    repeatRef,
    conflictRef,
    missingCalendar,
    selectedSource,
    invalidDateRange,
    invalidTimeRange,
    showTitleAssist,
    parsedSourceQuery,
    parsedLocationQuery,
    filteredSourceSuggestions,
    activeSourceSuggestion,
    showAutoSourceSuggestions,
    showSourceSuggestions,
    showLocationSuggestions,
    closeSourceSuggestions,
    closeLocationSuggestions,
    selectSourceSuggestion,
    consumeParsedLocationFromTitle,
    handleLocationSuggestionKey,
    onTitleKeyDown,
    onTitleChange,
    sharedDatePickerProps,
    sharedTimePickerProps,
    sharedSchedulePickerProps,
    sharedSourcePickerProps,
    sharedLocationPickerProps,
    sharedRecurrencePickerProps,
    sharedConflictPickerProps,
  };
}
