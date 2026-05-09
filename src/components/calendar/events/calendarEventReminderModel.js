const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export const EVENT_REMINDER_PRESETS = [
  { offsetMinutes: -10, label: "10 min" },
  { offsetMinutes: -30, label: "30 min" },
  { offsetMinutes: -60, label: "1 hour" },
  { offsetMinutes: -1440, label: "1 day" },
];

function zonedDateTimeToUtcIso(dateIso, time, timeZone = PACIFIC_TIME_ZONE) {
  const [year, month, day] = String(dateIso).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
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

export function eventAnchorFromDraft(draft) {
  const time = draft?.allDay ? "00:00" : draft?.startTime || "00:00";
  return zonedDateTimeToUtcIso(draft?.startDate, time);
}

function computeRemindAt(anchorAt, offsetMinutes) {
  return new Date(new Date(anchorAt).getTime() + Number(offsetMinutes) * 60_000).toISOString();
}

function normalizeOffset(reminder) {
  return Number(reminder?.offsetMinutes ?? reminder?.offset_minutes);
}

function createDraft({ anchorAt, offsetMinutes, now, existingReminders }) {
  const offset = Number(offsetMinutes);
  const remindAt = computeRemindAt(anchorAt, offset);
  if (isDuplicateReminderOffset(existingReminders, offset)) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "duplicate" };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "past" };
  }
  return {
    clientId: `reminder-${offset}-${remindAt}`,
    offsetMinutes: offset,
    remindAt,
    status: "pending",
    blocked: false,
  };
}

export function isDuplicateReminderOffset(existingReminders = [], offsetMinutes) {
  const offset = Number(offsetMinutes);
  return (existingReminders || []).some((reminder) =>
    reminder.status !== "missed" && normalizeOffset(reminder) === offset
  );
}

export function getEventReminderPresetState({
  draft,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}) {
  const anchorAt = eventAnchorFromDraft(draft);
  const offset = Number(offsetMinutes);
  if (!anchorAt || !Number.isFinite(offset)) {
    return { disabled: true, reason: "missing_anchor", remindAt: null };
  }
  const remindAt = computeRemindAt(anchorAt, offset);
  if (isDuplicateReminderOffset(existingReminders, offset)) {
    return { disabled: true, reason: "duplicate", remindAt };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { disabled: true, reason: "past", remindAt };
  }
  return { disabled: false, reason: null, remindAt };
}

export function createEventReminderDraftFromOffset({
  draft,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}) {
  const anchorAt = eventAnchorFromDraft(draft);
  if (!anchorAt) return { blocked: true, blockReason: "missing_anchor" };
  return createDraft({ anchorAt, offsetMinutes, now, existingReminders });
}

export function createEventReminderDraftFromCustom({
  draft,
  reminderDate,
  reminderTime,
  now = new Date(),
  existingReminders = [],
}) {
  const anchorAt = eventAnchorFromDraft(draft);
  const customAt = zonedDateTimeToUtcIso(reminderDate, reminderTime);
  if (!anchorAt || !customAt) return { blocked: true, blockReason: "missing_anchor" };
  const offsetMinutes = Math.round((new Date(customAt).getTime() - new Date(anchorAt).getTime()) / 60_000);
  return createDraft({ anchorAt, offsetMinutes, now, existingReminders });
}

export function eventReminderSourceFromEvent(event) {
  const anchorAt = event?.startMs
    ? new Date(event.startMs).toISOString()
    : event?.anchorAt || null;
  return {
    sourceType: "calendar_event",
    sourceAccountId: event?.accountId || null,
    sourceCalendarId: event?.calendarId || null,
    sourceItemId: event?.id,
    sourceOccurrenceId: event?.isRecurring
      ? event?.originalStartTime || anchorAt
      : null,
    anchorKind: "event_start",
    anchorAt,
    payloadSnapshot: {
      title: event?.title || "Calendar event",
      context: event?.calendarSummary || event?.sourceLabel || "Calendar",
      url: event?.htmlLink || event?.url || null,
      color: event?.color || event?.sourceColor || null,
    },
  };
}

export function buildEventReminderCreatePayload({ event, reminder }) {
  return {
    ...eventReminderSourceFromEvent(event),
    offsetMinutes: normalizeOffset(reminder),
  };
}

export function formatEventReminderLabel(reminder) {
  const offset = normalizeOffset(reminder);
  const absolute = Math.abs(offset);
  if (absolute === 0) return "At start";
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

export function projectEventReminderChips(reminders) {
  return (reminders || []).map((reminder) => ({
    key: reminder.id || reminder.clientId,
    id: reminder.id || null,
    label: formatEventReminderLabel(reminder),
    status: reminder.status || "pending",
    sent: reminder.status === "sent",
    offsetMinutes: normalizeOffset(reminder),
    raw: reminder,
  }));
}

export function isUnsavedReminder(reminder) {
  return !reminder?.id && !reminder?.sent && reminder?.status !== "sent";
}
