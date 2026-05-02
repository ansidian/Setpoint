import { Calendar as CalendarIcon } from "lucide-react";
import { FieldLabel, PickerFieldButton } from "./CalendarEditorControls";
import { sourceDotStyle } from "./calendarEditorUtils";

export default function CalendarEventSourceField({
  draft,
  sourceRef,
  selectedSource,
  sourcesLoading,
  writableCalendars,
  disabled,
  missingCalendar,
  onOpen,
}) {
  return (
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
        onClick={() => !disabled && onOpen()}
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
  );
}
