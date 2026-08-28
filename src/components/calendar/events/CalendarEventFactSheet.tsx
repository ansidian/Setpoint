import type { CSSProperties, MutableRefObject } from "react";
import { CalendarClock, ChevronRight, MapPin, Repeat } from "lucide-react";
import {
  calendarDraftDurationMinutes,
  formatRecurrenceSummary,
  formatTimeLabel,
} from "./calendarEditorUtils";
import type {
  CalendarEventDraft,
  CalendarRecurrenceDraft,
  WritableCalendarOption,
} from "./calendarEventEditorModel";
import type useCalendarEditorPickers from "./useCalendarEditorPickers";
import type useCalendarEventEditor from "./useCalendarEventEditor";
import "./editorFactSheet.css";

type CalendarEditorPickers = ReturnType<typeof useCalendarEditorPickers>;
type CalendarEventEditorController = ReturnType<typeof useCalendarEventEditor>;

interface CalendarEventFactSheetProps {
  draft: CalendarEventDraft;
  disabled: boolean;
  selectedSource: WritableCalendarOption | null;
  sourcesLoading: boolean;
  writableCalendars: WritableCalendarOption[];
  missingCalendar: boolean;
  invalidDateRange: boolean;
  invalidTimeRange: boolean;
  recurrenceDraft: CalendarRecurrenceDraft | null;
  isRecurringEvent: boolean;
  conflictCount: number;
  openPicker: CalendarEditorPickers["openPicker"];
  setOpenPicker: CalendarEditorPickers["setOpenPicker"];
  toggleOpenPicker: CalendarEditorPickers["toggleOpenPicker"];
  updateField: CalendarEventEditorController["updateField"];
  startDateRef: MutableRefObject<HTMLButtonElement | null>;
  endDateRef: MutableRefObject<HTMLButtonElement | null>;
  startTimeRef: MutableRefObject<HTMLButtonElement | null>;
  endTimeRef: MutableRefObject<HTMLButtonElement | null>;
  sourceRef: MutableRefObject<HTMLButtonElement | null>;
  locationRef: MutableRefObject<HTMLButtonElement | null>;
  repeatRef: MutableRefObject<HTMLButtonElement | null>;
  handleLocationSuggestionKey: CalendarEditorPickers["handleLocationSuggestionKey"];
}

const hiddenControlStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

function formatFactDate(value?: string | null) {
  if (!value) return "Choose a date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateRangeLabel(draft: CalendarEventDraft) {
  if (draft.startDate && draft.endDate && draft.startDate !== draft.endDate) {
    return `${formatFactDate(draft.startDate)} – ${formatFactDate(draft.endDate)}`;
  }
  return formatFactDate(draft.startDate);
}

function durationLabel(minutes: number | null) {
  if (minutes == null || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes} minutes`;
  if (!remainder) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minutes`;
}

function timeRangeLabel(draft: CalendarEventDraft) {
  if (draft.allDay) return "All day";
  if (draft.startTime && draft.endTime) {
    return `${formatTimeLabel(draft.startTime)} to ${formatTimeLabel(draft.endTime)}`;
  }
  return formatTimeLabel(draft.startTime);
}

export default function CalendarEventFactSheet({
  draft,
  disabled,
  selectedSource,
  sourcesLoading,
  writableCalendars,
  missingCalendar,
  invalidDateRange,
  invalidTimeRange,
  recurrenceDraft,
  isRecurringEvent,
  conflictCount,
  openPicker,
  setOpenPicker,
  toggleOpenPicker,
  updateField,
  startDateRef,
  endDateRef,
  startTimeRef,
  endTimeRef,
  sourceRef,
  locationRef,
  repeatRef,
  handleLocationSuggestionKey,
}: CalendarEventFactSheetProps) {
  const dateLabel = dateRangeLabel(draft);
  const timeLabel = timeRangeLabel(draft);
  const duration = draft.allDay || draft.startDate !== draft.endDate
    ? ""
    : durationLabel(calendarDraftDurationMinutes(draft));
  const sourceLabel = selectedSource?.summary || selectedSource?.label || (sourcesLoading ? "Loading calendars" : "Choose calendar");
  const locationLabel = draft.location?.trim() || "No location";
  const recurrenceLabel = formatRecurrenceSummary(recurrenceDraft, draft.startDate)
    || (isRecurringEvent ? "Recurring event" : "Does not repeat");
  const scheduleInvalid = invalidDateRange || invalidTimeRange || !draft.startDate;
  const sourceDisabled = disabled || sourcesLoading || writableCalendars.length === 0;
  const scheduleActive = typeof openPicker === "string" && openPicker.startsWith("schedule:");

  return (
    <>
      <input
        data-testid="calendar-event-source"
        type="hidden"
        value={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
        readOnly
      />
      <input
        data-testid={openPicker === "location" ? undefined : "calendar-event-location"}
        data-calendar-popover-trigger="true"
        aria-label="Event location"
        value={draft.location}
        onFocus={() => {
          if (!disabled) setOpenPicker("location");
        }}
        onChange={(event) => {
          updateField("location", event.target.value);
          if (!disabled) setOpenPicker("location");
        }}
        onKeyDown={handleLocationSuggestionKey}
        disabled={disabled}
        style={hiddenControlStyle}
      />
      <button
        type="button"
        data-testid="calendar-event-start-date"
        data-calendar-popover-trigger="true"
        onClick={() => !disabled && toggleOpenPicker("schedule:startDate")}
        disabled={disabled}
        style={hiddenControlStyle}
      >
        {formatFactDate(draft.startDate)}
      </button>
      <button
        ref={endDateRef}
        type="button"
        data-testid="calendar-event-end-date"
        data-calendar-popover-trigger="true"
        onClick={() => !disabled && setOpenPicker("schedule:endDate")}
        disabled={disabled}
        style={hiddenControlStyle}
      >
        {formatFactDate(draft.endDate)}
      </button>
      <button
        ref={startTimeRef}
        type="button"
        data-testid="calendar-event-start-time"
        data-calendar-popover-trigger="true"
        onClick={() => !disabled && setOpenPicker(draft.allDay ? "schedule:startDate" : "schedule:startTime")}
        disabled={disabled || draft.allDay}
        style={hiddenControlStyle}
      >
        {draft.allDay ? "All day" : formatTimeLabel(draft.startTime)}
      </button>
      <button
        ref={endTimeRef}
        type="button"
        data-testid="calendar-event-end-time"
        data-calendar-popover-trigger="true"
        onClick={() => !disabled && setOpenPicker(draft.allDay ? "schedule:endDate" : "schedule:endTime")}
        disabled={disabled || draft.allDay}
        style={hiddenControlStyle}
      >
        {draft.allDay ? "All day" : formatTimeLabel(draft.endTime)}
      </button>

      <div
        className="calendar-editor-fact-sheet"
        data-testid="calendar-draft-preview-summary"
        aria-label="Editable event facts"
      >
        <div className="calendar-editor-fact-sheet__surface">
          <button
            ref={startDateRef}
            type="button"
            className="calendar-editor-fact-sheet__primary"
            data-testid="calendar-event-schedule-trigger"
            data-calendar-popover-trigger="true"
            data-calendar-focus-ring="true"
            data-active={scheduleActive}
            data-invalid={scheduleInvalid}
            aria-label={`Schedule: ${dateLabel}, ${timeLabel}${duration ? `, ${duration}` : ""}`}
            aria-pressed={scheduleActive}
            aria-invalid={scheduleInvalid}
            disabled={disabled}
            onClick={() => toggleOpenPicker("schedule:startDate")}
          >
            <span className="calendar-editor-fact-sheet__primary-icon">
              <CalendarClock size={16} aria-hidden />
            </span>
            <span className="calendar-editor-fact-sheet__primary-copy">
              <span className="calendar-editor-fact-sheet__label">When</span>
              <span className="calendar-editor-fact-sheet__lead" data-testid="calendar-draft-preview-segment" data-summary-kind="schedule">
                {dateLabel}
              </span>
              <span className="calendar-editor-fact-sheet__detail">
                {timeLabel}
                {duration ? <span className="calendar-editor-fact-sheet__detail-muted"> · {duration}</span> : null}
                {conflictCount ? (
                  <span className="calendar-editor-fact-sheet__warning">
                    {" · "}Overlaps {conflictCount} event{conflictCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            </span>
            <ChevronRight className="calendar-editor-fact-sheet__disclosure" size={16} aria-hidden />
          </button>

          <div className="calendar-editor-fact-sheet__secondary">
            <button
              ref={sourceRef}
              type="button"
              className="calendar-editor-fact-sheet__fact"
              data-testid="calendar-event-source-trigger"
              data-calendar-popover-trigger="true"
              data-calendar-focus-ring="true"
              data-active={openPicker === "source"}
              data-invalid={missingCalendar}
              aria-label={`Calendar: ${sourceLabel}`}
              aria-pressed={openPicker === "source"}
              aria-invalid={missingCalendar}
              disabled={sourceDisabled}
              onClick={() => toggleOpenPicker("source")}
            >
              <span className="calendar-editor-fact-sheet__label">Calendar</span>
              <span className="calendar-editor-fact-sheet__value">
                <span
                  className="calendar-editor-fact-sheet__source-dot"
                  style={{ "--calendar-editor-source-color": selectedSource?.color || "#4285f4" } as CSSProperties}
                  aria-hidden
                />
                <span className="calendar-editor-fact-sheet__value-text" title={sourceLabel}>{sourceLabel}</span>
              </span>
            </button>

            <button
              ref={locationRef}
              type="button"
              className="calendar-editor-fact-sheet__fact"
              data-testid="calendar-event-location-trigger"
              data-calendar-popover-trigger="true"
              data-calendar-focus-ring="true"
              data-active={openPicker === "location" || !!draft.location?.trim()}
              aria-label={`Location: ${locationLabel}`}
              aria-pressed={openPicker === "location"}
              disabled={disabled}
              onClick={() => toggleOpenPicker("location")}
            >
              <span className="calendar-editor-fact-sheet__label">Location</span>
              <span className={`calendar-editor-fact-sheet__value${draft.location?.trim() ? "" : " calendar-editor-fact-sheet__value--muted"}`}>
                <MapPin size={13} aria-hidden />
                <span className="calendar-editor-fact-sheet__value-text" title={locationLabel}>{locationLabel}</span>
              </span>
            </button>

            <button
              ref={repeatRef}
              type="button"
              className="calendar-editor-fact-sheet__fact"
              data-testid="calendar-event-repeat-trigger"
              data-calendar-popover-trigger="true"
              data-calendar-focus-ring="true"
              data-active={openPicker === "recurrence" || !!recurrenceDraft}
              aria-label={`Repeat: ${recurrenceLabel}`}
              aria-pressed={openPicker === "recurrence"}
              disabled={disabled}
              onClick={() => toggleOpenPicker("recurrence")}
            >
              <span className="calendar-editor-fact-sheet__label">Repeat</span>
              <span className={`calendar-editor-fact-sheet__value${recurrenceDraft || isRecurringEvent ? "" : " calendar-editor-fact-sheet__value--muted"}`}>
                <Repeat size={13} aria-hidden />
                <span className="calendar-editor-fact-sheet__value-text" title={recurrenceLabel}>{recurrenceLabel}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
