import { buildDeadlineMutationPayload } from "./submitPayload";
import { applyTodoistReminderMutations } from "./applyTodoistReminderMutations";
import {
  applyUpcomingReminderState,
  projectUpcomingReminderState,
} from "../../calendar/reminderDisplay.ts";
import { todoistAnchorFromTask } from "./todoistReminderModel";
import type { TodoistTask } from "../../../../shared/types/tasks";
import type { UpcomingReminderState } from "../../../../shared/types/reminders";
import type { SubmitAddTaskFlowOptions, TodoistEditorTask } from "./types";

const projectTypedUpcomingReminderState = projectUpcomingReminderState as (
  reminders: SubmitAddTaskFlowOptions["todoistReminders"],
  options?: { anchorAt?: string | null },
) => UpcomingReminderState;

// The add-task submit decision tree, lifted out of the controller so it can be
// tested without React. Network IO (deadline + reminder mutations) and the chrono
// re-parse gate are injected; the pure payload/projection helpers are imported.
//
// Returns the data the caller needs to update local state:
//   - committedTask: the create result to remember (so a retry updates instead of
//     duplicating); unchanged for edit/retry
//   - projectedTask: the task with projected upcoming-reminder state applied
//   - created / deleted: reminder op counts (drive the partial-failure copy)
//   - errors: reminder op errors (non-empty => deadline saved but reminders didn't)
//
// Throws only if the deadline create/update itself fails; reminder failures are
// collected (never thrown) so a committed deadline is never abandoned.
export async function submitAddTaskFlow({
  parsed,
  resolvedDue,
  overrides,
  input,
  projects,
  labels,
  seededNlpDueDate,
  seededCreateDue,
  description,
  resolvedProject,
  resolvedPriority,
  resolvedLabels,
  isEdit,
  editingTask,
  todoistReminders,
  removedReminderIds,
  committedTask,
  createDeadline,
  updateDeadline,
  createReminder,
  deleteReminder,
  parseTokensWithChrono,
  isChronoReady,
}: SubmitAddTaskFlowOptions) {
  // Paste-then-instant-submit may have parsed while chrono was still loading,
  // dropping a recurring time-of-day. Re-parse with chrono guaranteed loaded and
  // recompute the due string. Scoped to recurring input only — the sole
  // chrono-dependent case — so the await never touches the plain-date path.
  let effectiveParsed = parsed;
  let effectiveDue = resolvedDue;
  if (!overrides.due && input && parsed.recurrenceDraft && !isChronoReady()) {
    effectiveParsed = await parseTokensWithChrono(input, projects, labels, { seededDueDate: seededNlpDueDate });
    effectiveDue = effectiveParsed.recurringDueString
      || effectiveParsed.dateDueString
      || effectiveParsed.datePhrase
      || seededCreateDue?.dueString
      || null;
  }

  const payload = buildDeadlineMutationPayload({
    parsed: effectiveParsed,
    input,
    description,
    resolvedProject,
    resolvedPriority,
    resolvedLabels,
    resolvedDue: effectiveDue,
    isEdit,
  });

  let task: TodoistTask;
  let committed = committedTask;
  if (isEdit) {
    task = await updateDeadline(editingTask!.id!, payload);
  } else if (committed) {
    // Retry after a partial failure: the task already exists, so update it
    // rather than creating a second copy on Todoist.
    task = await updateDeadline(committed.id, payload);
  } else {
    task = await createDeadline(payload);
    committed = task;
  }
  const savedTask: TodoistEditorTask = isEdit
    ? { ...editingTask!, ...task, id: editingTask!.id! }
    : task;

  // The deadline mutation above is already committed, so reminder failures must
  // NOT abort the flow — collect each op's error instead of throwing.
  const { appliedReminders, created, deleted, errors } = await applyTodoistReminderMutations({
    savedTask,
    todoistReminders,
    removedReminderIds,
    createReminder,
    deleteReminder,
  });

  const remindersChanged = deleted > 0 || created > 0;
  const shouldProjectReminderState = remindersChanged || appliedReminders.length > 0;
  const projectedTask = shouldProjectReminderState
    ? applyUpcomingReminderState(
      savedTask,
      projectTypedUpcomingReminderState(appliedReminders, {
        anchorAt: todoistAnchorFromTask(savedTask)?.anchorAt || null,
      }),
    )
    : savedTask;

  return { committedTask: committed, savedTask, projectedTask, created, deleted, errors };
}
