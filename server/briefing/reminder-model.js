const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const MISSED_GRACE_HOURS = 6;
const VALID_SOURCE_TYPES = new Set(["calendar_event", "todoist_task"]);
const VALID_ANCHOR_KINDS = new Set([
  "event_start",
  "todoist_due_datetime",
  "todoist_date_9am_pacific",
]);

function requireIsoDate(value, fieldName) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return date.toISOString();
}

function zonedDateTimeToUtcIso(dateIso, time, timeZone = PACIFIC_TIME_ZONE) {
  const [year, month, day] = String(dateIso).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new Error("date and time are required");
  }

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

  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guessMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const zonedAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    const deltaMs = targetUtcMs - zonedAsUtcMs;
    if (deltaMs === 0) break;
    guessMs += deltaMs;
  }

  return new Date(guessMs).toISOString();
}

export function resolveReminderAnchor(source) {
  if (!VALID_SOURCE_TYPES.has(source?.sourceType)) {
    throw new Error("sourceType must be calendar_event or todoist_task");
  }

  if (source.sourceType === "calendar_event") {
    return {
      anchorKind: "event_start",
      anchorAt: requireIsoDate(source.startAt, "startAt"),
    };
  }

  if (source.dueDateTime) {
    return {
      anchorKind: "todoist_due_datetime",
      anchorAt: requireIsoDate(source.dueDateTime, "dueDateTime"),
    };
  }

  if (source.dueDate) {
    return {
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: zonedDateTimeToUtcIso(source.dueDate, "09:00"),
    };
  }

  throw new Error("Todoist reminders require dueDateTime or dueDate");
}

export function computeRemindAt(anchorAt, offsetMinutes) {
  const anchor = new Date(requireIsoDate(anchorAt, "anchorAt"));
  const offset = Number(offsetMinutes);
  if (!Number.isFinite(offset)) {
    throw new Error("offsetMinutes must be a number");
  }
  return new Date(anchor.getTime() + offset * 60_000).toISOString();
}

export function computeOffsetMinutes(anchorAt, remindAt) {
  const anchor = new Date(requireIsoDate(anchorAt, "anchorAt"));
  const reminder = new Date(requireIsoDate(remindAt, "remindAt"));
  return Math.round((reminder.getTime() - anchor.getTime()) / 60_000);
}

function reminderOffset(reminder) {
  return Number(reminder?.offset_minutes ?? reminder?.offsetMinutes);
}

export function createReminderDraft({
  anchorAt,
  remindAt,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}) {
  const offset = remindAt !== undefined
    ? computeOffsetMinutes(anchorAt, remindAt)
    : Number(offsetMinutes);
  const computedRemindAt = computeRemindAt(anchorAt, offset);
  const nowDate = new Date(now);

  if (existingReminders.some((reminder) =>
    reminder.status !== "missed" && reminderOffset(reminder) === offset
  )) {
    return {
      offsetMinutes: offset,
      remindAt: computedRemindAt,
      blocked: true,
      blockReason: "duplicate",
    };
  }

  if (new Date(computedRemindAt) <= nowDate) {
    return {
      offsetMinutes: offset,
      remindAt: computedRemindAt,
      blocked: true,
      blockReason: "past",
    };
  }

  return {
    offsetMinutes: offset,
    remindAt: computedRemindAt,
    blocked: false,
  };
}

export function projectUpcomingReminderState(reminders, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const upcoming = (reminders || [])
    .filter((reminder) =>
      reminder.status === "pending" &&
      new Date(reminder.remind_at ?? reminder.remindAt).getTime() > nowMs
    )
    .sort((a, b) =>
      new Date(a.remind_at ?? a.remindAt).getTime() -
      new Date(b.remind_at ?? b.remindAt).getTime()
    );

  return {
    hasUpcomingReminder: upcoming.length > 0,
    upcomingCount: upcoming.length,
    nextReminderAt: upcoming[0]?.remind_at ?? upcoming[0]?.remindAt ?? null,
  };
}

export function computeReminderState({
  remindAt,
  now = new Date(),
  graceHours = MISSED_GRACE_HOURS,
}) {
  const remindMs = new Date(requireIsoDate(remindAt, "remindAt")).getTime();
  const nowMs = new Date(now).getTime();
  if (remindMs > nowMs) return "pending";
  return nowMs - remindMs <= graceHours * 60 * 60 * 1000 ? "due" : "missed";
}

export function assertReminderShape({ sourceType, anchorKind }) {
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    throw new Error("sourceType must be calendar_event or todoist_task");
  }
  if (!VALID_ANCHOR_KINDS.has(anchorKind)) {
    throw new Error("anchorKind is invalid");
  }
}
