import { FieldLabel } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";

export default function CalendarEventNotesField({
  draft,
  disabled,
  updateField,
  rows,
  minHeight,
}) {
  return (
    <div>
      <FieldLabel>Notes</FieldLabel>
      <textarea
        data-testid="calendar-event-description"
        aria-label="Event notes"
        value={draft.description}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => updateField("description", event.target.value)}
        disabled={disabled}
        rows={rows}
        placeholder="Optional"
        style={{
          ...textFieldStyle(),
          resize: "vertical",
          minHeight,
        }}
      />
    </div>
  );
}
