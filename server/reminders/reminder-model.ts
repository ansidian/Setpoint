import type {
  ReminderAnchorKind,
  ReminderSourceType,
  ReminderTriggerState,
} from "../../shared/types/reminders.ts";

const MISSED_GRACE_HOURS = 6;
const VALID_SOURCE_TYPES = new Set<ReminderSourceType>(["calendar_event", "todoist_task"]);
const VALID_ANCHOR_KINDS = new Set<ReminderAnchorKind>([
  "event_start",
  "todoist_due_datetime",
  "todoist_date_9am_pacific",
]);

type DateInput = string | number | Date;

function dateFrom(value: DateInput): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value as string | number);
}

function requireIsoDate(value: DateInput | null | undefined, fieldName: string): string {
  const date = value == null ? new Date(Number.NaN) : dateFrom(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return date.toISOString();
}

export function computeRemindAt(anchorAt: DateInput, offsetMinutes: number): string {
  const anchor = new Date(requireIsoDate(anchorAt, "anchorAt"));
  const offset = Number(offsetMinutes);
  if (!Number.isFinite(offset)) {
    throw new Error("offsetMinutes must be a number");
  }
  return new Date(anchor.getTime() + offset * 60_000).toISOString();
}

export function computeReminderState({
  remindAt,
  now = new Date(),
  graceHours = MISSED_GRACE_HOURS,
}: { remindAt: DateInput; now?: DateInput; graceHours?: number }): ReminderTriggerState {
  const remindMs = new Date(requireIsoDate(remindAt, "remindAt")).getTime();
  const nowMs = dateFrom(now).getTime();
  if (remindMs > nowMs) return "pending";
  return nowMs - remindMs <= graceHours * 60 * 60 * 1000 ? "due" : "missed";
}

export function assertReminderShape({ sourceType, anchorKind }: { sourceType: unknown; anchorKind: unknown }): void {
  if (!VALID_SOURCE_TYPES.has(sourceType as ReminderSourceType)) {
    throw new Error("sourceType must be calendar_event or todoist_task");
  }
  if (!VALID_ANCHOR_KINDS.has(anchorKind as ReminderAnchorKind)) {
    throw new Error("anchorKind is invalid");
  }
}
