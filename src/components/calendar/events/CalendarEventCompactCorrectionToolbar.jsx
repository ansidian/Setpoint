import { createElement, useState } from "react";
import { Calendar as CalendarIcon, Clock3, Layers3, MapPin, Repeat } from "lucide-react";
import Tooltip from "@/components/shared/Tooltip";
import {
  formatDateLabel,
  formatRecurrenceSummary,
  formatTimeLabel,
  sourceDotStyle,
} from "./calendarEditorUtils";

const hiddenControlStyle = {
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

function dateRangeLabel(draft) {
  if (draft.startDate && draft.endDate && draft.startDate !== draft.endDate) {
    return `${formatDateLabel(draft.startDate)} to ${formatDateLabel(draft.endDate)}`;
  }
  return formatDateLabel(draft.startDate);
}

function timeRangeLabel(draft) {
  if (draft.allDay) return "All day";
  if (draft.startTime && draft.endTime) {
    return `${formatTimeLabel(draft.startTime)} to ${formatTimeLabel(draft.endTime)}`;
  }
  return formatTimeLabel(draft.startTime);
}

function scheduleLabel(draft) {
  return `${dateRangeLabel(draft)} · ${timeRangeLabel(draft)}`;
}

function IconButton({
  icon: IconComponent,
  label,
  dataTestId,
  active = false,
  invalid = false,
  disabled = false,
  color = null,
  anchorRef,
  onClick,
  children = null,
}) {
  const [hover, setHover] = useState(false);
  const activeColor = color || "var(--ea-accent)";
  const border = invalid
    ? "color-mix(in srgb, var(--sp-orange) 42%, transparent)"
    : active
      ? `color-mix(in srgb, ${activeColor} 42%, transparent)`
      : hover && !disabled
        ? "rgba(255,255,255,0.16)"
        : "rgba(255,255,255,0.08)";
  const background = invalid
    ? "color-mix(in srgb, var(--sp-orange) 10%, transparent)"
    : active
      ? `color-mix(in srgb, ${activeColor} 15%, transparent)`
      : hover && !disabled
        ? "rgba(255,255,255,0.06)"
        : "rgba(255,255,255,0.035)";
  const foreground = invalid
    ? "var(--sp-cream)"
    : active
      ? activeColor
      : "rgba(205,214,244,0.58)";
  const fallbackIcon = IconComponent ? createElement(IconComponent, { size: 15, "aria-hidden": true }) : null;

  return (
    <Tooltip text={label} side="top" sideOffset={7} delay={350}>
      <button
        ref={anchorRef}
        type="button"
        data-testid={dataTestId}
        data-calendar-popover-trigger="true"
        data-calendar-focus-ring="true"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (anchorRef) anchorRef.current = event.currentTarget;
          onClick?.(event);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          border: `1px solid ${border}`,
          background,
          color: disabled ? "rgba(205,214,244,0.34)" : foreground,
          display: "inline-grid",
          placeItems: "center",
          padding: 0,
          flex: "0 0 auto",
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.66 : 1,
          transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
          transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms, opacity 140ms",
        }}
      >
        {children || fallbackIcon}
      </button>
    </Tooltip>
  );
}

export default function CalendarEventCompactCorrectionToolbar({
  draft,
  disabled,
  selectedSource,
  sourcesLoading,
  writableCalendars,
  missingCalendar,
  invalidDateRange,
  invalidTimeRange,
  isBatchMode,
  batchDrafts,
  recurrenceDraft,
  onExitBatchMode,
  openPicker,
  setOpenPicker,
  updateField,
  startDateRef,
  endDateRef,
  startTimeRef,
  endTimeRef,
  sourceRef,
  locationRef,
  repeatRef,
  handleLocationSuggestionKey,
}) {
  const recurrenceSummary = formatRecurrenceSummary(recurrenceDraft, draft.startDate);
  const sourceLabel = selectedSource?.summary || selectedSource?.label || (sourcesLoading ? "Loading calendars" : "Choose calendar");
  const scheduleInvalid = invalidDateRange || invalidTimeRange || !draft.startDate;
  const sourceDisabled = disabled || sourcesLoading || writableCalendars.length === 0;

  return (
    <div
      data-testid="calendar-event-compact-toolbar"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
      }}
    >
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
        onClick={() => !disabled && setOpenPicker("schedule:startDate")}
        disabled={disabled}
        style={hiddenControlStyle}
      >
        {formatDateLabel(draft.startDate)}
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
        {formatDateLabel(draft.endDate)}
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

      {isBatchMode ? (
        <IconButton
          icon={Layers3}
          label={`${batchDrafts.length} draft event${batchDrafts.length === 1 ? "" : "s"}`}
          dataTestId="calendar-event-batch-trigger"
          active={batchDrafts.length > 0}
          disabled={disabled}
          onClick={onExitBatchMode}
        />
      ) : (
        <IconButton
          anchorRef={startDateRef}
          icon={Clock3}
          label={`Schedule: ${scheduleLabel(draft)}`}
          dataTestId="calendar-event-schedule-trigger"
          active={typeof openPicker === "string" && openPicker.startsWith("schedule:")}
          invalid={scheduleInvalid}
          disabled={disabled}
          onClick={() => !disabled && setOpenPicker("schedule:startDate")}
        />
      )}

      <IconButton
        anchorRef={sourceRef}
        icon={CalendarIcon}
        label={`Calendar: ${sourceLabel}`}
        dataTestId="calendar-event-source-trigger"
        active={openPicker === "source"}
        invalid={missingCalendar}
        disabled={sourceDisabled}
        color={selectedSource?.color || null}
        onClick={() => {
          if (sourceDisabled) return;
          setOpenPicker("source");
        }}
      >
        {selectedSource ? <span style={sourceDotStyle(selectedSource.color)} /> : <CalendarIcon size={15} aria-hidden />}
      </IconButton>

      <IconButton
        anchorRef={locationRef}
        icon={MapPin}
        label={draft.location?.trim() ? `Location: ${draft.location}` : "Location"}
        dataTestId="calendar-event-location-trigger"
        active={openPicker === "location" || !!draft.location?.trim()}
        disabled={disabled}
        onClick={() => !disabled && setOpenPicker("location")}
      />

      <IconButton
        anchorRef={repeatRef}
        icon={Repeat}
        label={recurrenceSummary ? `Repeat: ${recurrenceSummary}` : "Repeat"}
        dataTestId="calendar-event-repeat-trigger"
        active={openPicker === "recurrence" || !!recurrenceDraft}
        disabled={disabled}
        onClick={() => !disabled && setOpenPicker("recurrence")}
      />
    </div>
  );
}
