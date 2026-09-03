import ExpandingTextarea from "../../shared/ExpandingTextarea";
import { FieldLabel } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";
import type { CalendarEventDraft } from "./calendarEventEditorModel";

interface CalendarEventNotesFieldProps {
  draft: CalendarEventDraft;
  disabled: boolean;
  updateField: (field: "description", value: string) => void;
  rows?: number;
  minHeight?: number;
  compact?: boolean;
}

export default function CalendarEventNotesField({
  draft,
  disabled,
  updateField,
  rows,
  minHeight,
  compact = false,
}: CalendarEventNotesFieldProps) {
  return (
    <div>
      {compact ? null : <FieldLabel>Notes</FieldLabel>}
      <ExpandingTextarea
        data-testid="calendar-event-description"
        data-compact-notes={compact ? "true" : undefined}
        aria-label="Event notes"
        value={draft.description}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => updateField("description", event.target.value)}
        disabled={disabled}
        expandable={compact}
        rows={rows}
        placeholder={compact ? "Notes" : "Optional"}
        style={{
          ...textFieldStyle(),
          resize: "vertical",
          minHeight,
          padding: compact ? "8px 10px" : "10px 12px",
        }}
      />
    </div>
  );
}
