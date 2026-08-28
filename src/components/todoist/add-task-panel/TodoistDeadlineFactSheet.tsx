import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { CalendarClock, ChevronRight, Flag, Folder, Tags } from "lucide-react";
import { formatFriendlyDraftPreview } from "./formatDraftPreview";
import type { CompactPanel } from "./types";
import type useAddTaskPanelController from "./useAddTaskPanelController";
import "../../calendar/events/editorFactSheet.css";

interface TodoistDeadlineFactSheetProps {
  openCompactPanel: CompactPanel;
  setOpenCompactPanel: Dispatch<SetStateAction<CompactPanel>>;
  state: ReturnType<typeof useAddTaskPanelController>;
}

function dueFactCopy(state: ReturnType<typeof useAddTaskPanelController>) {
  const dueDate = state.draftPreview?.dueDate || state.editingTask?.due_date || null;
  const dueTime = state.draftPreview?.dueTime ?? state.editingTask?.due_time ?? null;
  if (!dueDate) {
    return {
      dateLabel: state.dueDisplay || "No due date",
      timeLabel: state.recurrenceSummary || "Set a date or time",
      combinedLabel: state.dueDisplay || "No due date",
    };
  }
  const combinedLabel = formatFriendlyDraftPreview({ dueDate, dueTime });
  const [dateLabel, timeLabel = "End of day"] = combinedLabel.split(" · ");
  return {
    dateLabel,
    timeLabel: state.recurrenceSummary ? `${timeLabel} · ${state.recurrenceSummary}` : timeLabel,
    combinedLabel: state.recurrenceSummary ? `${combinedLabel} · ${state.recurrenceSummary}` : combinedLabel,
  };
}

export default function TodoistDeadlineFactSheet({
  openCompactPanel,
  setOpenCompactPanel,
  state,
}: TodoistDeadlineFactSheetProps) {
  const {
    deleting,
    duePickerOpen,
    dueTriggerRef,
    openDuePicker,
    resolvedLabels,
    resolvedPriority,
    resolvedProject,
    submitting,
  } = state;
  const disabled = submitting || deleting;
  const due = dueFactCopy(state);
  const projectLabel = resolvedProject?.name
    || state.editingTask?.class_name
    || state.editingTask?.project_name
    || "Inbox";
  const priorityLabel = resolvedPriority ? `P${resolvedPriority}` : "None";
  const visibleLabels = resolvedLabels.slice(0, 3);
  const hiddenLabelCount = Math.max(0, resolvedLabels.length - visibleLabels.length);
  const labelsLabel = resolvedLabels.length
    ? resolvedLabels.map((label) => label.name).join(", ")
    : "No labels";

  return (
    <div
      className="calendar-editor-fact-sheet calendar-editor-fact-sheet--deadline"
      data-testid="todoist-draft-preview-summary"
      aria-label="Editable deadline facts"
    >
      <div className="calendar-editor-fact-sheet__surface">
        <button
          ref={dueTriggerRef}
          type="button"
          className="calendar-editor-fact-sheet__primary"
          data-testid="todoist-due-trigger"
          data-calendar-popover-trigger="true"
          data-calendar-focus-ring="true"
          data-active={duePickerOpen}
          aria-label={`Due: ${due.combinedLabel}`}
          aria-pressed={duePickerOpen}
          disabled={disabled}
          onClick={openDuePicker}
        >
          <span className="calendar-editor-fact-sheet__primary-icon">
            <CalendarClock size={16} aria-hidden />
          </span>
          <span className="calendar-editor-fact-sheet__primary-copy">
            <span className="calendar-editor-fact-sheet__label">Due</span>
            <span className="calendar-editor-fact-sheet__lead">{due.dateLabel}</span>
            <span className="calendar-editor-fact-sheet__sr-separator" aria-hidden> · </span>
            <span className="calendar-editor-fact-sheet__detail">{due.timeLabel}</span>
          </span>
          <ChevronRight className="calendar-editor-fact-sheet__disclosure" size={16} aria-hidden />
        </button>

        <div className="calendar-editor-fact-sheet__secondary">
          <button
            type="button"
            className="calendar-editor-fact-sheet__fact"
            data-testid="todoist-project-trigger"
            data-calendar-popover-trigger="true"
            data-calendar-focus-ring="true"
            data-active={openCompactPanel === "project"}
            aria-label={`Project: ${projectLabel}`}
            aria-pressed={openCompactPanel === "project"}
            disabled={disabled}
            onClick={() => setOpenCompactPanel((panel) => (panel === "project" ? null : "project"))}
          >
            <span className="calendar-editor-fact-sheet__label">Project</span>
            <span className="calendar-editor-fact-sheet__value">
              {resolvedProject ? (
                <span
                  className="calendar-editor-fact-sheet__source-dot"
                  style={{ "--calendar-editor-source-color": resolvedProject.color || "var(--ea-accent)" } as CSSProperties}
                  aria-hidden
                />
              ) : <Folder size={13} aria-hidden />}
              <span className="calendar-editor-fact-sheet__value-text" title={projectLabel}>{projectLabel}</span>
            </span>
          </button>

          <button
            type="button"
            className="calendar-editor-fact-sheet__fact"
            data-testid="todoist-priority-trigger"
            data-calendar-popover-trigger="true"
            data-calendar-focus-ring="true"
            data-active={openCompactPanel === "priority" || !!resolvedPriority}
            aria-label={`Priority: ${priorityLabel}`}
            aria-pressed={openCompactPanel === "priority"}
            disabled={disabled}
            onClick={() => setOpenCompactPanel((panel) => (panel === "priority" ? null : "priority"))}
          >
            <span className="calendar-editor-fact-sheet__label">Priority</span>
            <span className={`calendar-editor-fact-sheet__value${resolvedPriority ? " calendar-editor-fact-sheet__value--priority" : " calendar-editor-fact-sheet__value--muted"}`}>
              <Flag size={13} aria-hidden />
              <span className="calendar-editor-fact-sheet__value-text">{priorityLabel}</span>
            </span>
          </button>

          <button
            type="button"
            className="calendar-editor-fact-sheet__fact"
            data-testid="todoist-labels-trigger"
            data-calendar-popover-trigger="true"
            data-calendar-focus-ring="true"
            data-active={openCompactPanel === "labels" || resolvedLabels.length > 0}
            aria-label={`Labels: ${labelsLabel}`}
            aria-pressed={openCompactPanel === "labels"}
            disabled={disabled}
            onClick={() => setOpenCompactPanel((panel) => (panel === "labels" ? null : "labels"))}
          >
            <span className="calendar-editor-fact-sheet__label">Labels</span>
            {visibleLabels.length ? (
              <span className="calendar-editor-fact-sheet__label-list">
                {visibleLabels.map((label) => (
                  <span key={label.id || label.name} className="calendar-editor-fact-sheet__label-chip" title={label.name}>
                    {label.name}
                  </span>
                ))}
                {hiddenLabelCount ? (
                  <span className="calendar-editor-fact-sheet__label-chip calendar-editor-fact-sheet__label-chip--overflow">
                    +{hiddenLabelCount}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="calendar-editor-fact-sheet__value calendar-editor-fact-sheet__value--muted">
                <Tags size={13} aria-hidden />
                <span className="calendar-editor-fact-sheet__value-text">No labels</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
