import { useCallback, useEffect, useMemo, useState } from "react";
import { listReminders } from "../../../api";
import type { TodoistProject } from "../../../../shared/types/tasks";
import { displayTimeToInputValue } from "./due";
import {
  createTodoistReminderDraftFromCustom,
  createTodoistReminderDraftFromOffset,
  getTodoistReminderPresetState,
  TODOIST_REMINDER_PRESETS,
} from "./todoistReminderModel";
import type {
  AddTaskDraftPreview,
  CustomReminder,
  TodoistEditorTask,
  TodoistReminderDraftResult,
  TodoistReminderEntry,
  TodoistReminderPresetState,
} from "./types";

interface ReminderDraftState {
  sourceItemId: string | null;
  reminders: TodoistReminderEntry[];
  removedIds: string[];
  error: string | null;
}

function emptyReminderDraftState(sourceItemId: string | null): ReminderDraftState {
  return { sourceItemId, reminders: [], removedIds: [], error: null };
}

function reminderDraftError(nextReminder: TodoistReminderDraftResult) {
  if (!nextReminder.blocked) return null;
  if (nextReminder.blockReason === "duplicate") return "That reminder is already on this task.";
  if (nextReminder.blockReason === "past") return "Choose a future reminder time.";
  return "Choose a due date before adding a reminder.";
}

export default function useTodoistReminderDrafts({
  editingTask,
  initialDueDate,
  draftPreview,
  input,
  parsedTitle,
  resolvedProject,
}: {
  editingTask?: TodoistEditorTask | null;
  initialDueDate?: string | null;
  draftPreview: AddTaskDraftPreview | null;
  input: string;
  parsedTitle: string;
  resolvedProject: TodoistProject | null;
}) {
  const sourceItemId = editingTask?.id || null;
  const [reminderState, setReminderState] = useState<ReminderDraftState>(() => (
    emptyReminderDraftState(sourceItemId)
  ));
  const [customReminder, setCustomReminder] = useState<CustomReminder>(() => ({
    date: editingTask?.due_date || initialDueDate || "",
    time: displayTimeToInputValue(editingTask?.due_time),
  }));
  const activeReminderState = reminderState.sourceItemId === sourceItemId
    ? reminderState
    : emptyReminderDraftState(sourceItemId);
  const todoistReminders = activeReminderState.reminders;
  const removedReminderIds = activeReminderState.removedIds;
  const reminderError = activeReminderState.error;

  const updateReminderState = useCallback((
    update: (current: ReminderDraftState) => ReminderDraftState,
  ) => {
    setReminderState((current) => update(
      current.sourceItemId === sourceItemId ? current : emptyReminderDraftState(sourceItemId),
    ));
  }, [sourceItemId]);

  useEffect(() => {
    let cancelled = false;
    if (!sourceItemId) return undefined;
    listReminders({
      sourceType: "todoist_task",
      sourceItemId,
    })
      .then((result) => {
        if (!cancelled) {
          setReminderState({
            sourceItemId,
            reminders: result.reminders || [],
            removedIds: [],
            error: null,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setReminderState({
            ...emptyReminderDraftState(sourceItemId),
            error: err instanceof Error && err.message ? err.message : "Failed to load reminders.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceItemId]);

  const reminderDraftTask = useMemo(() => ({
    ...(editingTask || {}),
    id: editingTask?.id || null,
    title: parsedTitle || input.trim() || editingTask?.title || "",
    due_date: draftPreview?.dueDate || editingTask?.due_date || null,
    due_time: draftPreview?.dueTime || editingTask?.due_time || null,
    class_name: resolvedProject?.name || editingTask?.class_name || editingTask?.project_name || "Todoist",
    class_color: resolvedProject?.color || editingTask?.class_color || null,
    url: editingTask?.url || null,
  }), [draftPreview?.dueDate, draftPreview?.dueTime, editingTask, input, parsedTitle, resolvedProject?.color, resolvedProject?.name]);
  const hasReminderAnchor = !!reminderDraftTask.due_date;

  const defaultReminderTime = displayTimeToInputValue(reminderDraftTask.due_time);
  if (
    (!customReminder.date && reminderDraftTask.due_date)
    || (!customReminder.time && defaultReminderTime)
  ) {
    setCustomReminder((current) => ({
      date: current.date || reminderDraftTask.due_date || "",
      time: current.time || defaultReminderTime,
    }));
  }

  const updateCustomReminder = useCallback((patch: Partial<CustomReminder>) => {
    setCustomReminder((current) => ({ ...current, ...patch }));
    updateReminderState((current) => ({ ...current, error: null }));
  }, [updateReminderState]);

  const addTodoistReminderDraft = useCallback((nextReminder: TodoistReminderDraftResult) => {
    const error = reminderDraftError(nextReminder);
    if (error) {
      updateReminderState((current) => ({ ...current, error }));
      return;
    }
    updateReminderState((current) => ({
      ...current,
      reminders: [...current.reminders, nextReminder],
      error: null,
    }));
  }, [updateReminderState]);

  const addTodoistReminderPreset = useCallback((offsetMinutes: number) => {
    addTodoistReminderDraft(createTodoistReminderDraftFromOffset({
      task: reminderDraftTask,
      offsetMinutes,
      existingReminders: todoistReminders,
    }));
  }, [addTodoistReminderDraft, reminderDraftTask, todoistReminders]);

  const addCustomTodoistReminder = useCallback((selection: CustomReminder | null = null) => {
    const reminderSelection = selection || customReminder;
    addTodoistReminderDraft(createTodoistReminderDraftFromCustom({
      task: reminderDraftTask,
      reminderDate: reminderSelection.date,
      reminderTime: reminderSelection.time,
      existingReminders: todoistReminders,
    }));
  }, [addTodoistReminderDraft, customReminder, reminderDraftTask, todoistReminders]);

  const todoistReminderPresetStates = useMemo<Record<number, TodoistReminderPresetState>>(() => (
    Object.fromEntries(TODOIST_REMINDER_PRESETS.map((preset) => [
      preset.offsetMinutes,
      getTodoistReminderPresetState({
        task: reminderDraftTask,
        offsetMinutes: preset.offsetMinutes,
        existingReminders: todoistReminders,
      }),
    ]))
  ), [reminderDraftTask, todoistReminders]);

  const removeTodoistReminder = useCallback((reminder: TodoistReminderEntry) => {
    updateReminderState((current) => ({
      ...current,
      reminders: current.reminders.filter((entry) => (
        reminder.id ? entry.id !== reminder.id : entry.clientId !== reminder.clientId
      )),
      removedIds: reminder.id && !current.removedIds.includes(reminder.id)
        ? [...current.removedIds, reminder.id]
        : current.removedIds,
      error: null,
    }));
  }, [updateReminderState]);

  const reportReminderMutationFailure = useCallback((someMutationsSucceeded: boolean) => {
    updateReminderState((current) => ({
      ...current,
      error: someMutationsSucceeded
        ? "Task saved, but some reminders could not be updated."
        : "Task saved, but reminders could not be updated.",
    }));
  }, [updateReminderState]);

  return {
    todoistReminders,
    removedReminderIds,
    reminderError,
    customReminder,
    hasReminderAnchor,
    todoistReminderPresetStates,
    updateCustomReminder,
    addTodoistReminderPreset,
    addCustomTodoistReminder,
    removeTodoistReminder,
    reportReminderMutationFailure,
  };
}
