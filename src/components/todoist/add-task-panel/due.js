import { epochFromLa, laComponents } from "../../inbox/helpers";
import { formatResolvedDate } from "./parsing";

const DUE_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function parseDueTime(dueTime) {
  if (!dueTime) return null;
  const match = dueTime.match(DUE_TIME_RE);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function formatTime(hour, minute) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export function formatTodoistDueStringFromEpoch(epochMs) {
  const { year, month, day, hour, minute } = laComponents(epochMs);
  const monthValue = String(month + 1).padStart(2, "0");
  const dayValue = String(day).padStart(2, "0");
  return `${year}-${monthValue}-${dayValue} at ${formatTime(hour, minute)}`;
}

export function formatTodoistDueDisplayFromEpoch(epochMs) {
  const { year, month, day, hour, minute } = laComponents(epochMs);
  return formatResolvedDate({
    date: new Date(year, month, day),
    time: { hour, minute },
  });
}

export function buildManualDue(epochMs) {
  return {
    epochMs,
    dueString: formatTodoistDueStringFromEpoch(epochMs),
    display: formatTodoistDueDisplayFromEpoch(epochMs),
  };
}

export function getInitialDueEpoch(editingTask) {
  if (!editingTask?.due_date) return null;
  const [year, month, day] = editingTask.due_date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const dueTime = parseDueTime(editingTask.due_time);
  const hour = dueTime?.hour ?? 9;
  const minute = dueTime?.minute ?? 0;
  return epochFromLa(year, month - 1, day, hour, minute);
}

// Convert a Todoist display time ("2:30 PM") to the <input type="time"> value
// ("14:30"); falls back to "09:00" when absent or unparseable. Reuses the shared
// am/pm parser so the regex lives in exactly one place.
export function displayTimeToInputValue(dueTime) {
  if (!dueTime) return "09:00";
  const parsed = parseDueTime(dueTime);
  if (!parsed) return "09:00";
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
}

// Seed a manual due (9am LA) from a "YYYY-MM-DD" string for CREATE mode when a
// calendar day is preselected. Null for a missing/malformed date.
export function buildSeededDue(initialDueDate) {
  if (!initialDueDate) return null;
  const [year, month, day] = String(initialDueDate).split("-").map(Number);
  if (!year || !month || !day) return null;
  return buildManualDue(epochFromLa(year, month - 1, day, 9, 0));
}

// The "due" label shown before the user touches anything: the editing task's own
// due date/time when present, else the create-mode seeded display. Takes the
// primitive due fields (not the whole task) so the caller's memo can depend on
// exactly those fields.
export function buildSeededDueDisplay({ dueDate, dueTime, seededCreateDue }) {
  if (dueDate) {
    const [year, month, day] = dueDate.split("-").map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    const time = dueTime ? parseDueTime(dueTime) : null;
    return formatResolvedDate({ date, time });
  }
  return seededCreateDue?.display || null;
}

