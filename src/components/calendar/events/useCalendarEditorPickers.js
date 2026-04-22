import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DATE_PICKER_WIDTH = 300;
const DATE_PICKER_HEIGHT = 386;
const TIME_PICKER_WIDTH = 280;
const TIME_PICKER_HEIGHT = 238;
const SOURCE_PICKER_WIDTH = 320;
const SOURCE_PICKER_HEIGHT = 280;
const LOCATION_PICKER_WIDTH = 360;
const LOCATION_PICKER_HEIGHT = 240;

export default function useCalendarEditorPickers(editor) {
  const {
    draft,
    titleInput,
    titleAssist,
    isEditing,
    writableCalendars,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    updateField,
    handleTitleInputChange,
    moveActiveLocationSuggestion,
    acceptActiveLocationSuggestion,
    clearLocationSuggestions,
    save,
  } = editor;

  const [openPicker, setOpenPicker] = useState(null);
  const [activeSourceSuggestion, setActiveSourceSuggestion] = useState(0);
  const [dismissedAutoLocationQuery, setDismissedAutoLocationQuery] = useState("");
  const [dismissedAutoSourceQuery, setDismissedAutoSourceQuery] = useState("");
  const pickerPanelRef = useRef(null);
  const [nowTick] = useState(() => Date.now());
  const titleRef = useRef(null);
  const sourceRef = useRef(null);
  const locationRef = useRef(null);
  const startDateRef = useRef(null);
  const endDateRef = useRef(null);
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const activeSourceSuggestionRef = useRef(0);

  useEffect(() => {
    if (!openPicker) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenPicker(null);
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [openPicker]);

  useEffect(() => {
    if (isEditing) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [isEditing]);

  useEffect(() => {
    activeSourceSuggestionRef.current = activeSourceSuggestion;
  }, [activeSourceSuggestion]);

  useEffect(() => {
    function handleSaveHotkey(event) {
      if ((!event.metaKey && !event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      save();
    }

    document.addEventListener("keydown", handleSaveHotkey, true);
    return () => document.removeEventListener("keydown", handleSaveHotkey, true);
  }, [save]);

  const sharedDatePickerProps = {
    panelRef: pickerPanelRef,
    onClose: () => setOpenPicker(null),
    width: DATE_PICKER_WIDTH,
    height: DATE_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedTimePickerProps = {
    panelRef: pickerPanelRef,
    onClose: () => setOpenPicker(null),
    width: TIME_PICKER_WIDTH,
    height: TIME_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedSourcePickerProps = {
    panelRef: pickerPanelRef,
    onClose: () => setOpenPicker(null),
    width: SOURCE_PICKER_WIDTH,
    height: SOURCE_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const sharedLocationPickerProps = {
    panelRef: pickerPanelRef,
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
  const showTitleAssist = !!titleAssist.preview || !!titleAssist.locationQuery || !!titleAssist.sourceQuery;
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
  const showLocationSuggestions = (openPicker === "location" || showAutoLocationSuggestions)
    && (
      locationSuggestionsLoading
      || !!locationSuggestionsError
      || locationSuggestions.length > 0
      || String(draft.location || "").trim().length >= 2
    );
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
  }, [parsedSourceQuery, showAutoSourceSuggestions]);

  const closeLocationSuggestions = useCallback(() => {
    if (showAutoLocationSuggestions) {
      setDismissedAutoLocationQuery(parsedLocationQuery);
    } else {
      setOpenPicker(null);
    }
    clearLocationSuggestions();
  }, [clearLocationSuggestions, parsedLocationQuery, showAutoLocationSuggestions]);

  const consumeParsedLocationFromTitle = useCallback(() => {
    if (!shouldConsumeParsedLocationFromTitle) return;
    handleTitleInputChange(titleAssist.titleAfterLocationCommit);
    setDismissedAutoLocationQuery("");
  }, [handleTitleInputChange, shouldConsumeParsedLocationFromTitle, titleAssist.titleAfterLocationCommit]);

  const consumeParsedSourceFromTitle = useCallback(() => {
    if (!shouldConsumeParsedSourceFromTitle) return;
    handleTitleInputChange(titleAssist.titleAfterSourceCommit);
    setDismissedAutoSourceQuery("");
  }, [handleTitleInputChange, shouldConsumeParsedSourceFromTitle, titleAssist.titleAfterSourceCommit]);

  const selectSourceSuggestion = useCallback((item) => {
    if (!item) return;
    updateField("accountId", item.accountId, { markTouched: false, markOverride: false });
    updateField("calendarId", item.calendarId, { markTouched: false, markOverride: false });
    consumeParsedSourceFromTitle();
    setOpenPicker(null);
    setActiveSourceSuggestion(0);
  }, [consumeParsedSourceFromTitle, updateField]);

  const handleSourceSuggestionKey = useCallback(async (event) => {
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
  }, [closeSourceSuggestions, filteredSourceSuggestions, selectSourceSuggestion, showSourceSuggestions]);

  const handleLocationSuggestionKey = useCallback(async (event) => {
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
    showLocationSuggestions,
  ]);

  const onTitleKeyDown = useCallback(async (event) => {
    if (await handleSourceSuggestionKey(event)) return;
    if (await handleLocationSuggestionKey(event)) return;
    event.stopPropagation();
  }, [handleSourceSuggestionKey, handleLocationSuggestionKey]);

  const onTitleChange = useCallback((event) => {
    activeSourceSuggestionRef.current = 0;
    setActiveSourceSuggestion(0);
    setDismissedAutoSourceQuery("");
    setDismissedAutoLocationQuery("");
    handleTitleInputChange(event.target.value);
  }, [handleTitleInputChange]);

  return {
    openPicker,
    setOpenPicker,
    nowTick,
    titleRef,
    sourceRef,
    locationRef,
    startDateRef,
    endDateRef,
    startTimeRef,
    endTimeRef,
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
    sharedSourcePickerProps,
    sharedLocationPickerProps,
  };
}
