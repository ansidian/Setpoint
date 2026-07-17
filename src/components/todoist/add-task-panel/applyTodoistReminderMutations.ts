import { buildTodoistReminderCreatePayload, isUnsavedTodoistReminder } from "./todoistReminderModel";
import type { CreateReminderRequest } from "../../../../shared/types/reminders";
import type { TodoistReminderEntry, TodoistReminderSourceTask } from "./types";

export interface TodoistReminderMutationError {
  op: "create" | "delete";
  id?: string;
  reminder?: TodoistReminderEntry;
  message: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Reconcile the panel's reminder drafts against the server after a deadline
// mutation has already committed. Each delete/create runs independently and its
// failure is collected rather than aborting the flow, so a single reminder error
// can never strand the committed task update or leave the panel un-reconciled.
//
// `todoistReminders` is the panel's kept-reminder state (removed reminders have
// already been filtered out of it); `removedReminderIds` lists server reminders
// to delete. Returns:
//   appliedReminders - best-known reminder list to project onto the saved task.
//                      Successfully-created/kept reminders only; a create that
//                      failed is excluded since it is not live on the server.
//   created/deleted  - counts of successful server ops.
//   errors           - array of { op, id?, reminder?, message } for failed ops.
//                      A non-empty array means projected state may be stale and
//                      the caller should reconcile (refetch) / surface the error.
export async function applyTodoistReminderMutations({
  savedTask,
  todoistReminders = [],
  removedReminderIds = [],
  createReminder,
  deleteReminder,
}: {
  savedTask: TodoistReminderSourceTask;
  todoistReminders?: TodoistReminderEntry[];
  removedReminderIds?: string[];
  createReminder: (payload: CreateReminderRequest) => Promise<unknown>;
  deleteReminder: (id: string) => Promise<unknown>;
}) {
  const errors: TodoistReminderMutationError[] = [];
  let created = 0;
  let deleted = 0;

  for (const reminderId of removedReminderIds) {
    try {
      await deleteReminder(reminderId);
      deleted += 1;
    } catch (err) {
      errors.push({ op: "delete", id: reminderId, message: errorMessage(err, "Failed to remove reminder.") });
    }
  }

  const appliedReminders: TodoistReminderEntry[] = [];
  for (const reminder of todoistReminders) {
    if (!isUnsavedTodoistReminder(reminder)) {
      appliedReminders.push(reminder);
      continue;
    }
    try {
      await createReminder(buildTodoistReminderCreatePayload({ task: savedTask, reminder }));
      created += 1;
      appliedReminders.push(reminder);
    } catch (err) {
      errors.push({ op: "create", reminder, message: errorMessage(err, "Failed to add reminder.") });
    }
  }

  return { appliedReminders, created, deleted, errors };
}
