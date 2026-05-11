const REMINDER_TIME_ZONE = "America/Los_Angeles";
const SOON_REMINDER_WINDOW_MS = 6 * 60 * 60 * 1000;

const REMINDER_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: REMINDER_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const REMINDER_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: REMINDER_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const REMINDER_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: REMINDER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getUpcomingReminderState(item) {
  return item?.reminderState || {
    hasUpcomingReminder: !!item?.hasUpcomingReminder,
    upcomingCount: Number(item?.upcomingReminderCount || 0),
    nextReminderAt: item?.nextReminderAt || null,
  };
}

export function hasUpcomingReminder(item) {
  return !!getUpcomingReminderState(item).hasUpcomingReminder;
}

export function formatReminderTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return REMINDER_DATE_TIME_FORMATTER.format(date);
}

function formatShortReminderTime(date) {
  return REMINDER_TIME_FORMATTER.format(date);
}

function formatRelativeReminderTime(diffMs) {
  const totalMinutes = Math.max(1, Math.floor(diffMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function isSameReminderDay(left, right) {
  return REMINDER_DAY_FORMATTER.format(left) === REMINDER_DAY_FORMATTER.format(right);
}

export function formatReminderSummary(item, { now = new Date() } = {}) {
  const state = getUpcomingReminderState(item);
  if (!state.hasUpcomingReminder) return null;
  const nextReminderDate = new Date(state.nextReminderAt);
  if (!Number.isNaN(nextReminderDate.getTime())) {
    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();
    const diffMs = nextReminderDate.getTime() - nowMs;
    if (Number.isFinite(nowMs) && diffMs > 0 && diffMs <= SOON_REMINDER_WINDOW_MS) {
      return `Reminder in ${formatRelativeReminderTime(diffMs)}`;
    }
    if (Number.isFinite(nowMs) && isSameReminderDay(nextReminderDate, nowDate)) {
      return `Reminder ${formatShortReminderTime(nextReminderDate)}`;
    }
    return `Reminder ${formatReminderTime(nextReminderDate)}`;
  }
  return "Reminder set";
}

function reminderOffset(reminder) {
  return Number(reminder?.offsetMinutes ?? reminder?.offset_minutes);
}

function projectedReminderTime(reminder, anchorAt) {
  const offset = reminderOffset(reminder);
  if (anchorAt && Number.isFinite(offset)) {
    const anchorMs = new Date(anchorAt).getTime();
    if (Number.isFinite(anchorMs)) {
      return new Date(anchorMs + offset * 60_000).toISOString();
    }
  }
  return reminder?.remind_at ?? reminder?.remindAt ?? null;
}

export function projectUpcomingReminderState(reminders, { now = new Date(), anchorAt = null } = {}) {
  const nowMs = new Date(now).getTime();
  const upcoming = (reminders || [])
    .map((reminder) => ({
      reminder,
      remindAt: projectedReminderTime(reminder, anchorAt),
    }))
    .filter(({ reminder, remindAt }) => {
      const remindMs = new Date(remindAt).getTime();
      return reminder?.status === "pending" && Number.isFinite(remindMs) && remindMs > nowMs;
    })
    .sort((a, b) =>
      new Date(a.remindAt).getTime() -
      new Date(b.remindAt).getTime()
    );

  return {
    hasUpcomingReminder: upcoming.length > 0,
    upcomingCount: upcoming.length,
    nextReminderAt: upcoming[0]?.remindAt ?? null,
  };
}

export function applyUpcomingReminderState(item, state) {
  return {
    ...item,
    reminderState: state,
    hasUpcomingReminder: state.hasUpcomingReminder,
    upcomingReminderCount: state.upcomingCount,
    nextReminderAt: state.nextReminderAt,
  };
}
