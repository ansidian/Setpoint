const REMINDER_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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
  return REMINDER_TIME_FORMATTER.format(date);
}

export function formatReminderSummary(item) {
  const state = getUpcomingReminderState(item);
  if (!state.hasUpcomingReminder) return null;
  const time = formatReminderTime(state.nextReminderAt);
  if (time) return `Reminder ${time}`;
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
