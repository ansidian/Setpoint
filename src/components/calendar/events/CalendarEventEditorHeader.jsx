import { recurringScopeLabel } from "./calendarEditorUtils";

export default function CalendarEventEditorHeader({
  isEditing,
  isEditingRecurring,
  recurringEditScope,
  isBatchMode,
  isRecurringMode,
  batchDrafts,
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
          <span id="calendar-event-editor-title">
            {isEditing ? "Edit event" : isBatchMode ? "New batch" : "New event"}
          </span>
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: "var(--color-text-faint)", lineHeight: 1.45 }}>
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
  );
}
