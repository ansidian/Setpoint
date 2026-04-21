import { ActionButton } from "./CalendarEditorControls";

export default function CalendarEventEditorActionBar({
  editor,
  disabled,
  saveDisabled,
  isBatchMode,
  isRecurringMode,
}) {
  const {
    batchDrafts,
    saving,
    deleting,
    confirmDelete,
    isEditing,
    isEditingRecurring,
    recurringEditScope,
    save,
    closeEditor,
    confirmDeleteIntent,
    cancelDelete,
    remove,
  } = editor;

  return (
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
  );
}
