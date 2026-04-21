import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Calendar as CalendarIcon, ChevronDown, ChevronRight, Clock3, MapPin, Repeat, StickyNote } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import TimePickerView from "@/components/shared/pickers/TimePickerView";
import CalendarLocationSuggestionsPanel from "./CalendarLocationSuggestionsPanel";
import CalendarBatchReviewSection from "./CalendarBatchReviewSection";
import CalendarRecurrenceSection, { formatRecurrenceSummary } from "./CalendarRecurrenceSection";
import CalendarRecurringScopePrompt, { recurringScopeLabel } from "./CalendarRecurringScopePrompt";
import SourcePickerPanel from "./CalendarSourcePickerPanel";
import { FieldLabel, ActionButton, PickerFieldButton, stopKeyPropagation } from "./CalendarEditorControls";
import {
  ACCENT,
  toPacificYmd,
  formatDateLabel,
  formatTimeLabel,
  addMinutesToDraftDateTime,
  sourceDotStyle,
  textFieldStyle,
} from "./calendarEditorUtils";

const DATE_PICKER_WIDTH = 300;
const DATE_PICKER_HEIGHT = 386;
const TIME_PICKER_WIDTH = 280;
const TIME_PICKER_HEIGHT = 238;
const SOURCE_PICKER_WIDTH = 320;
const SOURCE_PICKER_HEIGHT = 280;
const LOCATION_PICKER_WIDTH = 360;
const LOCATION_PICKER_HEIGHT = 240;

function DetailSummaryChip({ icon: Icon, label }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        fontSize: 11,
        color: "rgba(205,214,244,0.72)",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={10} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      {label}
    </span>
  );
}

function DetailSummaryRow({ draft, recurrenceSummary, onToggle, expanded }) {
  const dateLabel = draft.startDate === draft.endDate
    ? formatDateLabel(draft.startDate)
    : `${formatDateLabel(draft.startDate)} – ${formatDateLabel(draft.endDate)}`;
  const timeLabel = draft.allDay
    ? "All day"
    : `${formatTimeLabel(draft.startTime)} – ${formatTimeLabel(draft.endTime)}`;
  const hasLocation = !!draft.location?.trim();
  const hasNotes = !!draft.description?.trim();
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="calendar-event-detail-toggle"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        fontFamily: "inherit",
        transition: "background 140ms",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
    >
      <Chevron size={12} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
        <DetailSummaryChip icon={CalendarDays} label={dateLabel} />
        <DetailSummaryChip icon={Clock3} label={timeLabel} />
        {recurrenceSummary ? <DetailSummaryChip icon={Repeat} label={recurrenceSummary} /> : null}
        {hasLocation ? <DetailSummaryChip icon={MapPin} label={draft.location.length > 20 ? `${draft.location.slice(0, 20)}…` : draft.location} /> : null}
        {hasNotes ? <DetailSummaryChip icon={StickyNote} label="Notes" /> : null}
      </div>
      <span style={{ fontSize: 10, color: "rgba(205,214,244,0.38)", flexShrink: 0 }}>
        {expanded ? "Collapse" : "Edit"}
      </span>
    </button>
  );
}

export default function CalendarEventEditorRail({ editor }) {
  const {
    draft,
    titleInput,
    titleAssist,
    intentState,
    batchDrafts,
    recurrenceDraft,
    recurringEditScope,
    writableCalendars,
    sourceGroups,
    sourcesLoading,
    error,
    errorCode,
    validationMessage,
    canSave,
    saving,
    deleting,
    confirmDelete,
    isEditing,
    isEditingRecurring,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
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
    closeEditor,
    confirmDeleteIntent,
    cancelDelete,
    remove,
    reconnect,
  } = editor;

  const disabled = saving || deleting;
  const saveDisabled = disabled || !canSave;
  const isBatchMode = !isEditing && intentState.mode === "batch";
  const isRecurringMode = !isEditing && intentState.mode === "recurring";
  const showRecurringScopePrompt = isEditingRecurring;
  const showRecurringBuilder = recurrenceDraft && (
    isRecurringMode || (isEditingRecurring && !!recurringEditScope && recurringEditScope !== "one")
  );
  const isCompactMode = isBatchMode || isRecurringMode;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const showDetailFields = !isCompactMode || detailsExpanded;
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
  const showTitleAssist = !isEditing && (!!titleAssist.preview || !!titleAssist.locationQuery || !!titleAssist.sourceQuery);
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
  const shouldConsumeParsedSourceFromTitle = !isEditing
    && !!parsedSourceQuery
    && titleInput !== titleAssist.titleAfterSourceCommit;
  const shouldConsumeParsedLocationFromTitle = !isEditing
    && !!parsedLocationQuery
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

  return (
    <div
      data-testid="calendar-event-editor-rail"
      style={{ padding: "16px 20px", overflow: "auto", flex: 1 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
            {isEditing ? "Edit event" : isBatchMode ? "New batch" : "New event"}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: "rgba(205,214,244,0.42)", lineHeight: 1.45 }}>
            {isEditing
              ? isEditingRecurring
                ? recurringEditScope
                  ? `Applying changes to ${recurringScopeLabel(recurringEditScope).toLowerCase()}.`
                  : "This is a recurring event."
                : "Edit this event directly from the dashboard."
              : isBatchMode
                ? `${batchDrafts.length} one-off event${batchDrafts.length === 1 ? "" : "s"} ready for review before creating.`
                : isRecurringMode
                  ? "Structured recurrence is ready to review before creating the series."
                  : "Natural language can create a single event, a batch of one-offs, or a recurring draft."}
          </div>
        </div>
      </div>

      {showRecurringScopePrompt ? (
        <CalendarRecurringScopePrompt
          selectedScope={recurringEditScope}
          disabled={disabled}
          onSelectScope={selectRecurringEditScope}
        />
      ) : null}

      {error ? (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(243,139,168,0.18)",
            background: "rgba(243,139,168,0.08)",
            color: "#f5c2e7",
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          <div>{error}</div>
          {errorCode === "calendar_reauth_required" ? (
            <div style={{ marginTop: 8 }}>
              <ActionButton onClick={reconnect}>Reconnect Gmail</ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {!error && validationMessage && !(isEditingRecurring && !recurringEditScope) ? (
        <div
          data-testid="calendar-event-validation"
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(249,115,22,0.24)",
            background: "rgba(249,115,22,0.08)",
            color: "#fdba74",
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          {validationMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
        <div>
          <FieldLabel>Title</FieldLabel>
          <input
            ref={titleRef}
            data-testid="calendar-event-title"
            type="text"
            value={titleInput}
            onKeyDown={async (event) => {
              if (await handleSourceSuggestionKey(event)) return;
              if (await handleLocationSuggestionKey(event)) return;
              event.stopPropagation();
            }}
            onChange={(event) => {
              activeSourceSuggestionRef.current = 0;
              setActiveSourceSuggestion(0);
              setDismissedAutoSourceQuery("");
              setDismissedAutoLocationQuery("");
              handleTitleInputChange(event.target.value);
            }}
            disabled={disabled}
            placeholder={isEditing ? "Event title" : "Dinner on Tue at 5pm"}
            style={textFieldStyle({ invalid: validationMessage === "Title is required." })}
          />
          {showTitleAssist ? (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {titleAssist.preview ? (
                <div
                  data-testid="calendar-event-title-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.78)", lineHeight: 1.45 }}
                >
                  Parsed schedule: <span style={{ color: "#cba6da" }}>{titleAssist.preview}</span>
                </div>
              ) : null}
              {!isEditing && intentState.mode === "batch" ? (
                <div
                  data-testid="calendar-event-title-mode-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed intent: <span style={{ color: "#89dceb" }}>{batchDrafts.length} one-off events</span>
                </div>
              ) : null}
              {!isEditing && intentState.mode === "recurring" ? (
                <div
                  data-testid="calendar-event-title-mode-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed intent: <span style={{ color: "#89dceb" }}>recurring event</span>
                </div>
              ) : null}
              {titleAssist.locationQuery ? (
                <div
                  data-testid="calendar-event-title-location-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed location query: <span style={{ color: "#f5c2e7" }}>{titleAssist.locationQuery}</span>
                </div>
              ) : null}
              {titleAssist.sourceQuery ? (
                <div
                  data-testid="calendar-event-title-source-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed calendar source: <span style={{ color: "#89dceb" }}>{titleAssist.sourceQuery}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <FieldLabel>Calendar</FieldLabel>
          <input
            data-testid="calendar-event-source"
            type="hidden"
            value={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
            readOnly
          />
          <PickerFieldButton
            anchorRef={sourceRef}
            icon={CalendarIcon}
            value={selectedSource?.label || (sourcesLoading ? "Loading calendars..." : "")}
            placeholder={writableCalendars.length ? "Choose a calendar" : "No writable calendars"}
            dataTestId="calendar-event-source-trigger"
            onClick={() => !disabled && setOpenPicker("source")}
            disabled={disabled || sourcesLoading || writableCalendars.length === 0}
            invalid={missingCalendar}
            trailingLabel=""
            leading={selectedSource ? (
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  display: "inline-grid",
                  placeItems: "center",
                  background: `color-mix(in srgb, ${selectedSource.color} 16%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${selectedSource.color} 28%, transparent)`,
                  flexShrink: 0,
                }}
              >
                <span style={sourceDotStyle(selectedSource.color)} />
              </span>
            ) : null}
          />
        </div>

        {isCompactMode ? (
          <DetailSummaryRow
            draft={draft}
            recurrenceSummary={isRecurringMode ? formatRecurrenceSummary(recurrenceDraft, draft.startDate) : ""}
            expanded={detailsExpanded}
            onToggle={() => setDetailsExpanded((prev) => !prev)}
          />
        ) : null}

        {showDetailFields ? (
          <>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "rgba(205,214,244,0.72)",
              }}
            >
              <input
                data-testid="calendar-event-all-day"
                type="checkbox"
                checked={draft.allDay}
                onChange={(event) => {
                  const nextAllDay = event.target.checked;
                  if (nextAllDay && (openPicker === "startTime" || openPicker === "endTime")) {
                    setOpenPicker(null);
                  }
                  updateField("allDay", nextAllDay);
                }}
                disabled={disabled}
                style={{ accentColor: "#cba6da" }}
              />
              All day
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Start</FieldLabel>
                <PickerFieldButton
                  anchorRef={startDateRef}
                  icon={CalendarDays}
                  value={formatDateLabel(draft.startDate)}
                  placeholder="Choose date"
                  dataTestId="calendar-event-start-date"
                  onClick={() => !disabled && setOpenPicker("startDate")}
                  disabled={disabled}
                  invalid={invalidDateRange}
                  trailingLabel=""
                />
              </div>
              <div>
                <FieldLabel>End</FieldLabel>
                <PickerFieldButton
                  anchorRef={endDateRef}
                  icon={CalendarDays}
                  value={formatDateLabel(draft.endDate)}
                  placeholder="Choose date"
                  dataTestId="calendar-event-end-date"
                  onClick={() => !disabled && setOpenPicker("endDate")}
                  disabled={disabled}
                  invalid={invalidDateRange}
                  trailingLabel=""
                />
              </div>
            </div>

            {!draft.allDay ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <FieldLabel>Start time</FieldLabel>
                  <PickerFieldButton
                    anchorRef={startTimeRef}
                    icon={Clock3}
                    value={formatTimeLabel(draft.startTime)}
                    placeholder="Choose time"
                    dataTestId="calendar-event-start-time"
                    onClick={() => !disabled && setOpenPicker("startTime")}
                    disabled={disabled}
                    invalid={invalidTimeRange}
                    trailingLabel=""
                  />
                </div>
                <div>
                  <FieldLabel>End time</FieldLabel>
                  <PickerFieldButton
                    anchorRef={endTimeRef}
                    icon={Clock3}
                    value={formatTimeLabel(draft.endTime)}
                    placeholder="Choose time"
                    dataTestId="calendar-event-end-time"
                    onClick={() => !disabled && setOpenPicker("endTime")}
                    disabled={disabled}
                    invalid={invalidTimeRange}
                    trailingLabel=""
                  />
                </div>
              </div>
            ) : null}

            <div>
              <FieldLabel>Location</FieldLabel>
              <input
                ref={locationRef}
                data-testid="calendar-event-location"
                type="text"
                value={draft.location}
                onFocus={() => {
                  if (!disabled) setOpenPicker("location");
                }}
                onChange={(event) => {
                  updateField("location", event.target.value);
                  if (!disabled) setOpenPicker("location");
                }}
                onKeyDown={async (event) => {
                  if (await handleLocationSuggestionKey(event)) return;
                  event.stopPropagation();
                }}
                disabled={disabled}
                placeholder="Search for a place or type your own"
                style={textFieldStyle()}
              />
              {!locationSuggestionsError ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10.5,
                    color: "rgba(205,214,244,0.45)",
                    lineHeight: 1.45,
                  }}
                >
                  Nearby suggestions are biased to your saved weather location.
                </div>
              ) : null}
            </div>

            <div>
              <FieldLabel>Notes</FieldLabel>
              <textarea
                data-testid="calendar-event-description"
                value={draft.description}
                onKeyDown={stopKeyPropagation}
                onChange={(event) => updateField("description", event.target.value)}
                disabled={disabled}
                rows={isCompactMode ? 3 : 5}
                placeholder="Optional"
                style={{ ...textFieldStyle(), resize: "vertical", minHeight: isCompactMode ? 60 : 120 }}
              />
            </div>
          </>
        ) : null}
      </div>

      {isBatchMode ? (
        <CalendarBatchReviewSection
          batchDrafts={batchDrafts}
          allDay={draft.allDay}
          disabled={disabled}
          onUpdateDraft={updateBatchDraft}
          onRemoveDraft={removeBatchDraft}
        />
      ) : null}

      {showRecurringBuilder ? (
        <CalendarRecurrenceSection
          recurrenceDraft={recurrenceDraft}
          startDate={draft.startDate}
          disabled={disabled}
          onUpdateRecurrence={updateRecurrenceDraft}
          onToggleWeekday={toggleRecurrenceWeekday}
        />
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {confirmDelete ? (
          <>
            <ActionButton
              dataTestId="calendar-event-delete-confirm"
              danger
              onClick={remove}
              disabled={disabled}
            >
              {deleting ? "Deleting..." : "Confirm delete"}
            </ActionButton>
            <ActionButton subtle onClick={cancelDelete} disabled={disabled}>
              Keep event
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton
              dataTestId="calendar-event-save"
              onClick={save}
              disabled={saveDisabled}
            >
              {saving ? "Saving..." : isEditing ? "Save changes" : isBatchMode ? (batchDrafts.some((d) => d.error) ? `Retry ${batchDrafts.length} event${batchDrafts.length === 1 ? "" : "s"}` : `Create ${batchDrafts.length} event${batchDrafts.length === 1 ? "" : "s"}`) : isRecurringMode ? "Create recurring event" : "Create event"}
            </ActionButton>
            <ActionButton subtle onClick={closeEditor} disabled={disabled}>
              Cancel
            </ActionButton>
            {isEditing ? (
              <ActionButton
                dataTestId="calendar-event-delete"
                danger
                onClick={confirmDeleteIntent}
                disabled={disabled || (isEditingRecurring && !recurringEditScope)}
              >
                Delete
              </ActionButton>
            ) : null}
          </>
        )}
      </div>

      {openPicker === "startDate" ? (
        <AnchoredFloatingPanel
          anchorRef={startDateRef}
          ariaLabel="Start date picker"
          {...sharedDatePickerProps}
        >
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={new Date(`${draft.startDate || draft.endDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={(epoch) => {
              updateField("startDate", toPacificYmd(epoch));
              setOpenPicker("endDate");
            }}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "endDate" ? (
        <AnchoredFloatingPanel
          anchorRef={endDateRef}
          ariaLabel="End date picker"
          {...sharedDatePickerProps}
        >
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={new Date(`${draft.endDate || draft.startDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={(epoch) => {
              updateField("endDate", toPacificYmd(epoch));
              setOpenPicker(null);
            }}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}

      {showSourceSuggestions ? (
        <AnchoredFloatingPanel
          anchorRef={sourceRef}
          ariaLabel="Calendar source picker"
          {...sharedSourcePickerProps}
          onClose={closeSourceSuggestions}
        >
          <SourcePickerPanel
            sourceGroups={sourceGroups}
            writableCalendars={writableCalendars}
            selectedValue={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
            activeValue={filteredSourceSuggestions[activeSourceSuggestion]?.value || null}
            filterQuery={showAutoSourceSuggestions ? parsedSourceQuery : ""}
            onSelect={selectSourceSuggestion}
          />
        </AnchoredFloatingPanel>
      ) : null}

      {showLocationSuggestions ? (
        <AnchoredFloatingPanel
          anchorRef={locationRef}
          ariaLabel="Location suggestions"
          {...sharedLocationPickerProps}
          onClose={() => {
            closeLocationSuggestions();
          }}
        >
          <CalendarLocationSuggestionsPanel
            suggestions={locationSuggestions}
            loading={locationSuggestionsLoading}
            error={locationSuggestionsError}
            activeIndex={activeLocationSuggestion}
            onSelect={async (item) => {
              await selectLocationSuggestion(item);
              consumeParsedLocationFromTitle();
              setOpenPicker(null);
            }}
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "startTime" ? (
        <AnchoredFloatingPanel
          anchorRef={startTimeRef}
          ariaLabel="Start time picker"
          {...sharedTimePickerProps}
        >
          <TimePickerView
            initialTime={draft.startTime}
            onSelect={(value) => {
              updateField("startTime", value);
              const seededEnd = addMinutesToDraftDateTime(draft.startDate, value, 30);
              const shouldSyncEndDate = !draft.endDate
                || draft.endDate === draft.startDate
                || draft.endDate < seededEnd.date;
              if (shouldSyncEndDate) {
                updateField("endDate", seededEnd.date);
              }
              updateField("endTime", seededEnd.time);
              setOpenPicker("endTime");
            }}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start time"
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "endTime" ? (
        <AnchoredFloatingPanel
          anchorRef={endTimeRef}
          ariaLabel="End time picker"
          {...sharedTimePickerProps}
        >
          <TimePickerView
            initialTime={draft.endTime}
            onSelect={(value) => {
              updateField("endTime", value);
              setOpenPicker(null);
            }}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end time"
          />
        </AnchoredFloatingPanel>
      ) : null}
    </div>
  );
}
