import { CalendarDays, Clock3 } from "lucide-react";
import { FieldLabel, PickerFieldButton } from "./CalendarEditorControls";
import { formatDateLabel, formatTimeLabel } from "./calendarEditorUtils";

function AllDayToggle({ draft, disabled, openPicker, setOpenPicker, updateField }) {
  return (
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
  );
}

export default function CalendarEventScheduleFields({
  draft,
  disabled,
  openPicker,
  setOpenPicker,
  updateField,
  startDateRef,
  endDateRef,
  startTimeRef,
  endTimeRef,
  invalidDateRange,
  invalidTimeRange,
  desktop = false,
}) {
  const gridGap = desktop ? 12 : 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: desktop ? 12 : 14, minWidth: 0 }}>
      {desktop ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <FieldLabel>Schedule</FieldLabel>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "rgba(205,214,244,0.56)" }}>
              Set the event timing first, then add context below.
            </div>
          </div>
          <AllDayToggle
            draft={draft}
            disabled={disabled}
            openPicker={openPicker}
            setOpenPicker={setOpenPicker}
            updateField={updateField}
          />
        </div>
      ) : (
        <AllDayToggle
          draft={draft}
          disabled={disabled}
          openPicker={openPicker}
          setOpenPicker={setOpenPicker}
          updateField={updateField}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: gridGap }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: gridGap }}>
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
    </div>
  );
}
