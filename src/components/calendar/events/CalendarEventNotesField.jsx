import { useState } from "react";
import { FieldLabel } from "./CalendarEditorControls";
import { textFieldStyle } from "./calendarEditorUtils";

export default function CalendarEventNotesField({
  draft,
  disabled,
  updateField,
  rows,
  minHeight,
  compact = false,
}) {
  const [focused, setFocused] = useState(false);
  const hasContent = !!draft.description?.trim();
  const compactExpanded = focused || hasContent;
  const resolvedRows = compact ? (compactExpanded ? 3 : 1) : rows;
  const resolvedMinHeight = compact ? (compactExpanded ? 72 : 38) : minHeight;

  return (
    <div>
      {compact ? null : <FieldLabel>Notes</FieldLabel>}
      <textarea
        data-testid="calendar-event-description"
        data-compact-notes={compact ? "true" : undefined}
        aria-label="Event notes"
        value={draft.description}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => updateField("description", event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        rows={resolvedRows}
        placeholder={compact ? "Notes" : "Optional"}
        style={{
          ...textFieldStyle(),
          resize: "vertical",
          minHeight: resolvedMinHeight,
          padding: compact ? "8px 10px" : "10px 12px",
          transition: "min-height 160ms, background 140ms, border-color 140ms",
        }}
      />
    </div>
  );
}
