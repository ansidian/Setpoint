// Pure view-model derivations for the add-task panel: resolving the manual-vs-
// parsed field values, the deadline draft preview, and the dirty-state snapshots.
// Extracted from useAddTaskPanelController so these projections are unit-testable.
// Each function takes exactly the fields the caller's memo depends on, so the
// controller's memoization granularity is preserved.
import { deadlinePreviewFromEpoch, minutesFromDisplayTime } from "../../calendar/ghostPreview.js";

// Manual labels win once the user has touched labels; otherwise the parsed
// @label tokens, falling back to an empty list.
export function resolveAddTaskLabels({ useManualLabels, manualLabels, parsedLabels }) {
  if (useManualLabels) return manualLabels || [];
  return parsedLabels.length ? parsedLabels : [];
}

// The resolved due string / display label / recurrence summary / picker epoch,
// preferring a manual due selection, then the parsed natural-language due, then
// the create-mode seed.
export function resolveAddTaskDue({
  useManualDue,
  manualDue,
  parsed,
  seededCreateDue,
  seededDueDisplay,
  seededDueEpoch,
}) {
  const resolvedDue = useManualDue
    ? manualDue?.dueString || null
    : parsed.recurringDueString || parsed.dateDueString || parsed.datePhrase || seededCreateDue?.dueString || null;
  const dueDisplay = manualDue?.display || parsed.dateFormatted || seededDueDisplay || "";
  const recurrenceSummary = !useManualDue ? parsed.recurrenceSummary : null;
  const pickerDueEpoch = manualDue?.epochMs ?? seededDueEpoch;
  return { resolvedDue, dueDisplay, recurrenceSummary, pickerDueEpoch };
}

// The ghost/deadline preview the calendar shows for the in-progress draft.
// `placementChanged` is true for new tasks, or when the edited due date/time
// actually moves — used to suppress unchanged-edit previews.
export function buildAddTaskDraftPreview({
  manualDueEpochMs,
  useManualDue,
  parsedDuePreview,
  parsedStripped,
  seededDueEpoch,
  editingDueDate,
  editingDueTime,
  editingTitle,
  isEdit,
  input,
  resolvedPriority,
}) {
  const manualPreview = manualDueEpochMs != null ? deadlinePreviewFromEpoch(manualDueEpochMs) : null;
  const parsedPreview = !useManualDue ? parsedDuePreview : null;
  const seededPreview = seededDueEpoch != null ? deadlinePreviewFromEpoch(seededDueEpoch) : null;
  const due = manualPreview || parsedPreview || seededPreview;
  if (!due?.dueDate) return null;
  const dueMinutes = due.dueMinutes ?? minutesFromDisplayTime(due.dueTime);
  const originalMinutes = minutesFromDisplayTime(editingDueTime);
  const placementChanged = !isEdit
    || due.dueDate !== editingDueDate
    || (dueMinutes ?? null) !== (originalMinutes ?? null);
  return {
    kind: "deadline",
    title: parsedStripped || input.trim() || editingTitle || "",
    dueDate: due.dueDate,
    dueTime: due.dueTime || null,
    priority: resolvedPriority,
    source: "todoist",
    isEditing: isEdit,
    placementChanged,
  };
}

// The task's pre-edit due value, used as the dirty-check baseline.
export function buildOriginalDueValue({ editingTask, seededDueString }) {
  return editingTask
    ? editingTask.due_string || [editingTask.due_date, editingTask.due_time].filter(Boolean).join(" ") || null
    : seededDueString || null;
}

// Normalized snapshot of the current draft for dirty comparison against the
// baseline below. In edit mode an untouched due keeps the original value so a
// reformatted-but-equivalent due does not read as dirty.
export function buildAddTaskDirtySnapshot({
  parsedStripped,
  input,
  description,
  resolvedProjectName,
  resolvedProjectId,
  resolvedPriority,
  resolvedLabels,
  isEdit,
  useManualDue,
  originalDueValue,
  resolvedDue,
}) {
  return JSON.stringify({
    content: String(parsedStripped || input || "").trim(),
    description: String(description || "").trim(),
    project: resolvedProjectName || resolvedProjectId || null,
    priority: resolvedPriority || null,
    labels: (resolvedLabels || []).map((label) => label.name).sort(),
    due: isEdit && !useManualDue ? originalDueValue : resolvedDue || null,
  });
}

// Normalized snapshot of the editing task as loaded; the dirty flag is
// `snapshot !== baseline`.
export function buildAddTaskDirtyBaseline({ editingTask, originalDueValue }) {
  return JSON.stringify({
    content: String(editingTask?.title || "").trim(),
    description: String(editingTask?.description || "").trim(),
    project: editingTask
      ? editingTask.project_id || editingTask.project_name || editingTask.class_name || null
      : null,
    priority: editingTask?.priority || null,
    labels: (editingTask?.labels || []).map((name) => String(name)).sort(),
    due: originalDueValue,
  });
}
