import type { NormalizedCalendarEvent } from "../../../../shared/types/calendar";
import type { Reminder, TimeToLeaveReminder } from "../../../../shared/types/reminders";

export type ScheduleNoticeEvent = Partial<NormalizedCalendarEvent> & {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
};

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
});

function eventKey(event: ScheduleNoticeEvent) {
  return JSON.stringify([event.accountId, event.calendarId, event.id, event.originalStartTime || event.startMs]);
}

export function buildDashboardScheduleNotices(events: readonly ScheduleNoticeEvent[], reminders: readonly Reminder[], now: number) {
  const today = dayFormatter.format(now);
  const seen = new Set<string>();
  const remaining = events.filter((event) => {
    if (event.allDay || event.status === "cancelled" || !Number.isFinite(event.startMs)
      || !Number.isFinite(event.endMs) || event.endMs <= Math.max(now, event.startMs)) return false;
    if (dayFormatter.format(event.startMs) > today || dayFormatter.format(event.endMs) < today) return false;
    const key = eventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.startMs - b.startMs);

  const conflicts: Array<{ first: ScheduleNoticeEvent; second: ScheduleNoticeEvent; startMs: number }> = [];
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      const first = remaining[i]!;
      const second = remaining[j]!;
      if (second.startMs >= first.endMs) break;
      const startMs = Math.max(first.startMs, second.startMs);
      if (Math.min(first.endMs, second.endMs) > Math.max(startMs, now)) {
        conflicts.push({ first, second, startMs });
      }
    }
  }
  conflicts.sort((a, b) => a.startMs - b.startMs);

  const departures: Array<{ event: ScheduleNoticeEvent; reminder: TimeToLeaveReminder; departureMs: number }> = [];
  for (const event of remaining) {
    if (event.startMs <= now) continue;
    const occurrence = event.isRecurring
      ? event.originalStartTime || new Date(event.startMs).toISOString()
      : null;
    for (const reminder of reminders) {
      if (reminder.reminder_kind !== "time_to_leave" || reminder.status === "missed"
        || reminder.source_type !== "calendar_event" || reminder.source_item_id !== event.id
        || reminder.source_account_id !== event.accountId || reminder.source_calendar_id !== event.calendarId
        || (reminder.source_occurrence_id || null) !== occurrence
        || new Date(reminder.anchor_at).getTime() !== event.startMs) continue;
      const departureMs = new Date(reminder.remind_at).getTime();
      if (Number.isFinite(departureMs) && dayFormatter.format(departureMs) === today) {
        departures.push({ event, reminder, departureMs });
      }
    }
  }
  departures.sort((a, b) => a.departureMs - b.departureMs);
  return { departure: departures[0] || null, conflicts, hasRemainingEvents: remaining.length > 0 };
}
