import { epochFromLa } from "../../inbox/helpers";
import type { CreateReminderRequest, ReminderAnchorKind } from "../../../../shared/types/reminders";
import type {
  TodoistReminderChip,
  TodoistReminderDraftResult,
  TodoistReminderEntry,
  TodoistReminderPresetState,
  TodoistReminderSourceTask,
} from "./types";

export const TODOIST_REMINDER_PRESETS = [
  { offsetMinutes: -10, label: "10 min" },
  { offsetMinutes: -30, label: "30 min" },
  { offsetMinutes: -60, label: "1 hour" },
  { offsetMinutes: -1440, label: "1 day" },
];

const TIME_12H_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function isoFromPacific(dateIso: string, hour: number, minute: number) {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = String(dateIso).split("-").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(epochFromLa(year, month - 1, day, hour, minute)).toISOString();
}

function parseDueTime(dueTime: string | null | undefined) {
  if (!dueTime) return null;
  const match = String(dueTime).match(TIME_12H_RE);
  if (!match) return null;
  let hour = parseInt(match[1]!, 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]!.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function normalizeOffset(reminder: TodoistReminderEntry) {
  return Number(reminder?.offsetMinutes ?? reminder?.offset_minutes);
}

function computeRemindAt(anchorAt: string, offsetMinutes: number) {
  return new Date(new Date(anchorAt).getTime() + Number(offsetMinutes) * 60_000).toISOString();
}

export function todoistAnchorFromTask(task: TodoistReminderSourceTask): {
  anchorKind: ReminderAnchorKind;
  anchorAt: string | null;
} | null {
  if (!task?.due_date) return null;
  const dueTime = parseDueTime(task.due_time);
  if (dueTime) {
    return {
      anchorKind: "todoist_due_datetime",
      anchorAt: isoFromPacific(task.due_date, dueTime.hour, dueTime.minute),
    };
  }
  return {
    anchorKind: "todoist_date_9am_pacific",
    anchorAt: isoFromPacific(task.due_date, 9, 0),
  };
}

export function todoistReminderSourceFromTask(task: TodoistReminderSourceTask) {
  const anchor = todoistAnchorFromTask(task);
  return {
    sourceType: "todoist_task",
    sourceItemId: task?.id,
    anchorKind: anchor?.anchorKind || null,
    anchorAt: anchor?.anchorAt || null,
    payloadSnapshot: {
      title: task?.title || task?.content || "Todoist task",
      context: task?.class_name || task?.project_name || "Todoist",
      url: task?.url || null,
      color: task?.class_color || null,
    },
  };
}

function createDraft({
  anchorAt,
  offsetMinutes,
  now,
  existingReminders,
}: {
  anchorAt: string;
  offsetMinutes: number;
  now: Date;
  existingReminders: TodoistReminderEntry[];
}): TodoistReminderDraftResult {
  const offset = Number(offsetMinutes);
  const remindAt = computeRemindAt(anchorAt, offset);
  if (isDuplicateTodoistReminderOffset(existingReminders, offset)) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "duplicate" };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "past" };
  }
  return {
    clientId: `todoist-reminder-${offset}-${remindAt}`,
    offsetMinutes: offset,
    remindAt,
    status: "pending",
    blocked: false,
  };
}

export function isDuplicateTodoistReminderOffset(
  existingReminders: TodoistReminderEntry[] = [],
  offsetMinutes: number,
) {
  const offset = Number(offsetMinutes);
  return (existingReminders || []).some((reminder) =>
    reminder.status !== "missed" && normalizeOffset(reminder) === offset
  );
}

export function getTodoistReminderPresetState({
  task,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}: {
  task: TodoistReminderSourceTask;
  offsetMinutes: number;
  now?: Date;
  existingReminders?: TodoistReminderEntry[];
}): TodoistReminderPresetState {
  const anchor = todoistAnchorFromTask(task);
  const offset = Number(offsetMinutes);
  if (!anchor?.anchorAt || !Number.isFinite(offset)) {
    return { disabled: true, reason: "missing_anchor", remindAt: null };
  }
  const remindAt = computeRemindAt(anchor.anchorAt, offset);
  if (isDuplicateTodoistReminderOffset(existingReminders, offset)) {
    return { disabled: true, reason: "duplicate", remindAt };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { disabled: true, reason: "past", remindAt };
  }
  return { disabled: false, reason: null, remindAt };
}

export function createTodoistReminderDraftFromOffset({
  task,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}: {
  task: TodoistReminderSourceTask;
  offsetMinutes: number;
  now?: Date;
  existingReminders?: TodoistReminderEntry[];
}): TodoistReminderDraftResult {
  const anchor = todoistAnchorFromTask(task);
  if (!anchor?.anchorAt) return { blocked: true, blockReason: "missing_anchor" };
  return createDraft({ anchorAt: anchor.anchorAt, offsetMinutes, now, existingReminders });
}

export function createTodoistReminderDraftFromCustom({
  task,
  reminderDate,
  reminderTime,
  now = new Date(),
  existingReminders = [],
}: {
  task: TodoistReminderSourceTask;
  reminderDate: string;
  reminderTime: string;
  now?: Date;
  existingReminders?: TodoistReminderEntry[];
}): TodoistReminderDraftResult {
  const anchor = todoistAnchorFromTask(task);
  const [hour = Number.NaN, minute = Number.NaN] = String(reminderTime).split(":").map(Number);
  const customAt = isoFromPacific(reminderDate, hour, minute);
  if (!anchor?.anchorAt || !customAt) return { blocked: true, blockReason: "missing_anchor" };
  const offsetMinutes = Math.round((new Date(customAt).getTime() - new Date(anchor.anchorAt).getTime()) / 60_000);
  return createDraft({ anchorAt: anchor.anchorAt, offsetMinutes, now, existingReminders });
}

export function buildTodoistReminderCreatePayload({
  task,
  reminder,
}: {
  task: TodoistReminderSourceTask;
  reminder: TodoistReminderEntry;
}): CreateReminderRequest {
  return {
    ...todoistReminderSourceFromTask(task),
    offsetMinutes: normalizeOffset(reminder),
  } as CreateReminderRequest;
}

export function formatTodoistReminderLabel(reminder: TodoistReminderEntry) {
  const offset = normalizeOffset(reminder);
  const absolute = Math.abs(offset);
  if (absolute === 0) return "At due time";
  if (absolute % 1440 === 0) {
    const days = absolute / 1440;
    return `${days} day${days === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"}`;
  }
  if (absolute % 60 === 0) {
    const hours = absolute / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"}`;
  }
  return `${absolute} minutes ${offset < 0 ? "before" : "after"}`;
}

export function projectTodoistReminderChips(reminders: TodoistReminderEntry[]): TodoistReminderChip[] {
  return (reminders || []).map((reminder) => ({
    key: (reminder.id || reminder.clientId)!,
    id: reminder.id || null,
    label: formatTodoistReminderLabel(reminder),
    status: reminder.status || "pending",
    sent: reminder.status === "sent",
    offsetMinutes: normalizeOffset(reminder),
    raw: reminder,
  }));
}

export function isUnsavedTodoistReminder(reminder: TodoistReminderEntry) {
  return !reminder?.id && !reminder?.sent && reminder?.status !== "sent";
}
