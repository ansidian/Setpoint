import { CalendarClock } from "lucide-react";
import TodoistDuePicker from "./TodoistDuePicker";
import { RemoveLabelButton, TokenAutocomplete } from "./controls";
import { formatFriendlyDraftPreview } from "./formatDraftPreview.js";
import { ActionButton, FieldLabel } from "../../calendar/events/CalendarEditorControls";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import { TODOIST_DEADLINE_COLOR } from "../../../../shared/deadline-source-colors";

export function TodoistErrorNotice({ error, compact = false }) {
  if (!error) return null;
  return (
    <div
      style={{
        padding: compact ? "9px 10px" : "10px 12px",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)",
        background: "color-mix(in srgb, var(--sp-rose) 8%, transparent)",
        color: "#f5c2e7",
        fontSize: 11.5,
        lineHeight: 1.5,
      }}
    >
      {error}
    </div>
  );
}

export function TodoistDraftPreview({ draftPreview, compact = false }) {
  if (!draftPreview?.dueDate || (draftPreview.isEditing && !draftPreview.placementChanged)) return null;
  return (
    <div
      data-testid="todoist-draft-preview-summary"
      style={{
        padding: compact ? "9px 10px" : "10px 12px",
        borderRadius: 10,
        border: `1px solid ${TODOIST_DEADLINE_COLOR}33`,
        background: `${TODOIST_DEADLINE_COLOR}12`,
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: TODOIST_DEADLINE_COLOR }}>
        Draft preview
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "rgba(205,214,244,0.78)" }}>
        {formatFriendlyDraftPreview(draftPreview)}
      </div>
    </div>
  );
}

export function TodoistTaskTextSection({
  autocompleteType,
  cursorPos,
  handleAutocompleteSelect,
  handleInputChange,
  handleKeyDown,
  input,
  inputRef,
  labels,
  projects,
  recurrenceSummary,
}) {
  return (
    <div style={{ position: "relative" }}>
      <FieldLabel>Task</FieldLabel>
      <input
        ref={inputRef}
        type="text"
        data-calendar-editor-primary="true"
        inputMode="text"
        enterKeyHint="done"
        aria-label="Task title"
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Buy groceries tomorrow ! #Shopping @errand"
        style={{
          ...textFieldStyle({ invalid: false }),
          boxShadow: input ? "0 0 0 1px color-mix(in srgb, var(--sp-accent) 15%, transparent)" : "none",
        }}
      />
      {autocompleteType === "project" && (
        <TokenAutocomplete
          cursorPos={cursorPos}
          input={input}
          items={projects}
          type="project"
          onSelect={handleAutocompleteSelect}
        />
      )}
      {autocompleteType === "label" && (
        <TokenAutocomplete
          cursorPos={cursorPos}
          input={input}
          items={labels}
          type="label"
          onSelect={handleAutocompleteSelect}
        />
      )}
      {recurrenceSummary ? (
        <div
          data-testid="todoist-recurring-preview"
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            padding: "5px 8px",
            borderRadius: 999,
            border: "1px solid color-mix(in srgb, var(--sp-blue) 18%, transparent)",
            background: "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
            color: "var(--sp-blue)",
            fontSize: 11,
            lineHeight: 1.3,
          }}
        >
          <CalendarClock size={11} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Recurs {recurrenceSummary}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function TodoistSelectedLabelChips({
  borderRadius = 6,
  fontSize = 10.5,
  padding = "2px 7px",
  resolvedLabels,
  setManualLabels,
  setOverrides,
}) {
  if (!resolvedLabels.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
      {resolvedLabels.map((label) => (
        <span
          key={label.id}
          style={{
            background: "color-mix(in srgb, var(--sp-teal) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--sp-teal) 20%, transparent)",
            borderRadius,
            padding,
            color: "var(--sp-teal)",
            fontSize,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {label.name}
          <RemoveLabelButton
            onRemove={() => {
              const updated = resolvedLabels.filter((entry) => entry.id !== label.id);
              setManualLabels(updated);
              setOverrides((prev) => ({ ...prev, labels: true }));
            }}
          />
        </span>
      ))}
    </div>
  );
}

export function TodoistActionFooter({
  canSubmit,
  cancelDelete,
  confirmDelete,
  confirmDeleteIntent,
  deleteTask,
  deleting,
  handleSubmit,
  isEdit,
  showCancel = false,
  showDeleteIcon = null,
  submitting,
  requestClose,
}) {
  const DeleteIcon = showDeleteIcon;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {confirmDelete ? (
          <>
            <ActionButton
              dataTestId="todoist-delete-confirm"
              danger
              onClick={deleteTask}
              disabled={deleting || submitting}
            >
              {deleting ? "Deleting..." : "Confirm delete"}
            </ActionButton>
            <ActionButton subtle onClick={cancelDelete} disabled={deleting || submitting}>
              Keep task
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || deleting}
            >
              {submitting ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save" : "Add task")}
            </ActionButton>
            {showCancel ? (
              <ActionButton subtle onClick={requestClose} disabled={submitting || deleting}>
                Cancel
              </ActionButton>
            ) : null}
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {isEdit && !confirmDelete ? (
          <ActionButton
            dataTestId="todoist-delete"
            danger
            onClick={confirmDeleteIntent}
            disabled={deleting || submitting}
          >
            {DeleteIcon ? <DeleteIcon size={11} /> : null}
            Delete
          </ActionButton>
        ) : null}
      </div>
    </>
  );
}

export function TodoistDuePickerLayer({
  closeDuePicker,
  duePickerOpen,
  duePickerNow,
  duePickerRef,
  dueTriggerRef,
  handleDueSelect,
  pickerDueEpoch,
}) {
  if (!duePickerOpen) return null;
  return (
    <TodoistDuePicker
      anchorRef={dueTriggerRef}
      panelRef={duePickerRef}
      nowTick={duePickerNow}
      initialEpoch={pickerDueEpoch}
      onSelect={handleDueSelect}
      onClose={closeDuePicker}
    />
  );
}
