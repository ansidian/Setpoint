import { CalendarClock, ExternalLink } from "lucide-react";
import TodoistDuePicker from "./TodoistDuePicker";
import { RemoveLabelButton, TokenAutocomplete } from "./controls";
import { formatFriendlyDraftPreview } from "./formatDraftPreview";
import { ActionButton, FieldLabel } from "../../calendar/events/CalendarEditorControls";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import { TODOIST_DEADLINE_COLOR } from "../../../../shared/deadline-source-colors";
import type {
  ButtonHTMLAttributes,
  ComponentType,
  CSSProperties,
  Dispatch,
  PropsWithChildren,
  RefObject,
  SetStateAction,
} from "react";
import type { LucideIcon } from "lucide-react";
import type { TodoistLabel, TodoistProject } from "../../../../shared/types/tasks";
import type { AddTaskDraftPreview, AddTaskOverrides, AutocompleteType } from "./types";
import { extractDescriptionUrls } from "./descriptionLinksModel";

const TypedActionButton = ActionButton as ComponentType<PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { subtle?: boolean; danger?: boolean; dataTestId?: string }
>>;

export function TodoistDescriptionLinks({ description }: { description: string }) {
  const urls = extractDescriptionUrls(description);
  if (!urls.length) return null;
  return (
    <div className="todoist-description-links" aria-label="Links in task description">
      {urls.map((url) => (
        <a key={url} className="todoist-description-link" href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={11} aria-hidden />
          <span>{url}</span>
        </a>
      ))}
    </div>
  );
}

export function TodoistErrorNotice({ error, compact = false }: { error: string | null; compact?: boolean }) {
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

export function TodoistDraftPreview({
  draftPreview,
  compact = false,
}: {
  draftPreview: AddTaskDraftPreview | null;
  compact?: boolean;
}) {
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
}: {
  autocompleteType: AutocompleteType;
  cursorPos: number;
  handleAutocompleteSelect: (item: TodoistProject | TodoistLabel, triggerIdx: number, cursorPos: number) => void;
  handleInputChange: React.ChangeEventHandler<HTMLInputElement>;
  handleKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  input: string;
  inputRef: RefObject<HTMLInputElement | null>;
  labels: TodoistLabel[];
  projects: TodoistProject[];
  recurrenceSummary: string | null;
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
          ...(textFieldStyle({ invalid: false }) as CSSProperties),
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
}: {
  borderRadius?: number;
  fontSize?: number;
  padding?: string;
  resolvedLabels: TodoistLabel[];
  setManualLabels: Dispatch<SetStateAction<TodoistLabel[] | null>>;
  setOverrides: Dispatch<SetStateAction<AddTaskOverrides>>;
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
  confirmDiscard,
  confirmDeleteIntent,
  confirmDiscardChanges,
  cancelDiscard,
  deleteTask,
  deleting,
  handleSubmit,
  isEdit,
  showCancel = false,
  showDeleteIcon = null,
  submitting,
  requestClose,
}: {
  canSubmit: boolean;
  cancelDelete: () => void;
  confirmDelete: boolean;
  confirmDiscard: boolean;
  confirmDeleteIntent: () => void;
  confirmDiscardChanges: () => void;
  cancelDiscard: () => void;
  deleteTask: () => void | Promise<void>;
  deleting: boolean;
  handleSubmit: () => void | Promise<void>;
  isEdit: boolean;
  showCancel?: boolean;
  showDeleteIcon?: LucideIcon | null;
  submitting: boolean;
  requestClose: () => void;
}) {
  const DeleteIcon = showDeleteIcon;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {confirmDelete ? (
          <>
            <TypedActionButton
              dataTestId="todoist-delete-confirm"
              danger
              onClick={deleteTask}
              disabled={deleting || submitting}
            >
              {deleting ? "Deleting..." : "Confirm delete"}
            </TypedActionButton>
            <TypedActionButton subtle onClick={cancelDelete} disabled={deleting || submitting}>
              Keep task
            </TypedActionButton>
          </>
        ) : confirmDiscard ? (
          <>
            <TypedActionButton danger onClick={confirmDiscardChanges} disabled={submitting || deleting}>
              Confirm
            </TypedActionButton>
            <TypedActionButton subtle onClick={cancelDiscard} disabled={submitting || deleting}>
              Cancel
            </TypedActionButton>
          </>
        ) : (
          <>
            <TypedActionButton
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || deleting}
            >
              {submitting ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save" : "Add task")}
            </TypedActionButton>
            {showCancel ? (
              <TypedActionButton subtle onClick={requestClose} disabled={submitting || deleting}>
                Cancel
              </TypedActionButton>
            ) : null}
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {isEdit && !confirmDelete ? (
          <TypedActionButton
            dataTestId="todoist-delete"
            danger
            onClick={confirmDeleteIntent}
            disabled={deleting || submitting}
          >
            {DeleteIcon ? <DeleteIcon size={11} /> : null}
            Delete
          </TypedActionButton>
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
}: {
  closeDuePicker: () => void;
  duePickerOpen: boolean;
  duePickerNow: number;
  duePickerRef: RefObject<HTMLDivElement | null>;
  dueTriggerRef: RefObject<HTMLElement | null>;
  handleDueSelect: (epochMs: number) => void;
  pickerDueEpoch: number | null;
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
