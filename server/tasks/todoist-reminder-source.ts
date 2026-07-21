const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const TIME_12H_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

import type { ReminderAnchor } from "../../shared/types/reminders.ts";

interface TodoistReminderTask extends Record<string, unknown> {
  id?: unknown;
  item_id?: unknown;
  title?: string | null;
  content?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  due_datetime?: string | null;
  dueDateTime?: string | null;
  due_timezone?: string | null;
  class_name?: string | null;
  project_name?: string | null;
  url?: string | null;
  class_color?: string | null;
  due?: { date?: string | null; timezone?: string | null } | null;
}

function zonedDateTimeToUtcIso(dateIso: string, time: string, timeZone = PACIFIC_TIME_ZONE): string | null {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = String(dateIso).split("-").map(Number);
  const [hour = Number.NaN, minute = Number.NaN] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessMs = targetUtcMs;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let index = 0; index < 4; index += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guessMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const zonedAsUtcMs = Date.UTC(
      parts.year ?? Number.NaN,
      (parts.month ?? Number.NaN) - 1,
      parts.day ?? Number.NaN,
      parts.hour ?? Number.NaN,
      parts.minute ?? Number.NaN,
      parts.second ?? Number.NaN,
      0,
    );
    const deltaMs = targetUtcMs - zonedAsUtcMs;
    if (deltaMs === 0) break;
    guessMs += deltaMs;
  }

  return new Date(guessMs).toISOString();
}

function parseDueTime(dueTime: string | null | undefined): { hour: number; minute: number } | null {
  if (!dueTime) return null;
  const match = String(dueTime).match(TIME_12H_RE);
  if (!match) return null;
  let hour = parseInt(match[1] ?? "", 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = (match[3] ?? "").toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function splitTodoistDateTime(value: string): { date: string; time: string } | null {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    date: match[1] ?? "",
    time: `${match[2] ?? ""}:${match[3] ?? ""}`,
  };
}

function dueDateFromTask(task: TodoistReminderTask): string | null {
  if (task?.due_date) return String(task.due_date).split("T")[0] ?? null;
  if (task?.due?.date) return String(task.due.date).split("T")[0] ?? null;
  return null;
}

export function todoistReminderAnchorFromTask(task: TodoistReminderTask): ReminderAnchor | null {
  const due = task?.due;
  const rawDueDateTime = task?.due_datetime
    || task?.dueDateTime
    || (String(due?.date || "").includes("T") ? due?.date : null);
  const dueDateTime = String(rawDueDateTime || "").includes("T") ? String(rawDueDateTime) : null;
  const dueTimezone = task?.due_timezone || task?.due?.timezone || PACIFIC_TIME_ZONE;

  if (dueDateTime) {
    const split = splitTodoistDateTime(dueDateTime);
    const anchorAt = split
      ? zonedDateTimeToUtcIso(split.date, split.time, dueTimezone)
      : new Date(dueDateTime).toISOString();
    return anchorAt ? {
      anchorKind: "todoist_due_datetime",
      anchorAt,
    } : null;
  }

  const dueDate = dueDateFromTask(task);
  const dueTime = parseDueTime(task?.due_time);
  if (dueDate && dueTime) {
    return {
      anchorKind: "todoist_due_datetime",
      anchorAt: zonedDateTimeToUtcIso(dueDate, `${String(dueTime.hour).padStart(2, "0")}:${String(dueTime.minute).padStart(2, "0")}`)!,
    };
  }

  if (dueDate) {
    return {
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: zonedDateTimeToUtcIso(dueDate, "09:00")!,
    };
  }

  return null;
}
