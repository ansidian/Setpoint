import { describe, expect, it } from "vitest";
import type { TimeToLeaveReminder } from "../../../../shared/types/reminders";
import { buildDashboardScheduleNotices, type ScheduleNoticeEvent } from "./dashboardScheduleModel";

const now = Date.parse("2026-09-05T19:00:00Z");
const event: ScheduleNoticeEvent = {
  id: "event", title: "Appointment", accountId: "personal", calendarId: "primary",
  startMs: now + 3_600_000, endMs: now + 7_200_000,
  isRecurring: true, originalStartTime: new Date(now + 3_600_000).toISOString(),
};
const reminder: TimeToLeaveReminder = {
  id: "reminder", user_id: "owner", reminder_kind: "time_to_leave", source_type: "calendar_event",
  source_account_id: "personal", source_calendar_id: "primary", source_item_id: "event",
  source_occurrence_id: event.originalStartTime!, anchor_kind: "event_start", anchor_at: new Date(event.startMs).toISOString(),
  offset_minutes: 0, remind_at: new Date(now + 1_800_000).toISOString(), status: "pending",
  sent_at: null, missed_at: null, retry_count: 0, retry_after: null, last_error: null,
  payload_snapshot_json: null, payload_snapshot: null, created_at: null, updated_at: null,
  arrival_buffer_minutes: 15, route_duration_seconds: 900, route_distance_meters: 6000,
  route_checked_at: new Date(now).toISOString(), next_route_check_at: null, route_status: "ready", route_error_code: null,
};

describe("dashboard schedule notice policy", () => {
  it("requires exact source and occurrence identity, with the current event anchor", () => {
    expect(buildDashboardScheduleNotices([event], [reminder], now).departure?.event.id).toBe("event");
    for (const patch of [
      { source_account_id: "work" }, { source_calendar_id: "other" }, { source_item_id: "other" },
      { source_occurrence_id: "2026-09-06T20:00:00Z" }, { anchor_at: "2026-09-05T21:00:00Z" },
    ]) {
      expect(buildDashboardScheduleNotices([event], [{ ...reminder, ...patch }], now).departure).toBeNull();
    }
  });

  it("keeps delivered or degraded estimates visible until event start but excludes missed reminders", () => {
    const sent = { ...reminder, status: "sent" as const, route_status: "degraded" as const };
    expect(buildDashboardScheduleNotices([event], [sent], now).departure?.reminder).toBe(sent);
    expect(buildDashboardScheduleNotices([event], [sent], event.startMs).departure).toBeNull();
    expect(buildDashboardScheduleNotices([event], [{ ...reminder, status: "missed" }], now).departure).toBeNull();
  });

  it("chooses the earliest departure today and excludes other days", () => {
    const later = { ...event, id: "later", startMs: now + 10_800_000, endMs: now + 14_400_000, isRecurring: false };
    const laterReminder = { ...reminder, source_item_id: "later", source_occurrence_id: null, anchor_at: new Date(later.startMs).toISOString(), remind_at: new Date(now + 9_000_000).toISOString() };
    expect(buildDashboardScheduleNotices([later, event], [laterReminder, reminder], now).departure?.event.id).toBe("event");
    expect(buildDashboardScheduleNotices([event], [{ ...reminder, remind_at: "2026-09-04T23:00:00Z" }], now).departure).toBeNull();
  });

  it("counts strict remaining timed overlaps once, ignoring duplicates, touching edges, and all-day events", () => {
    const overlap = { ...event, id: "overlap", startMs: event.startMs + 900_000 };
    const touching = { ...event, id: "touching", startMs: event.endMs, endMs: event.endMs + 3_600_000 };
    const allDay = { ...event, id: "all-day", allDay: true };
    const past = { ...event, id: "past", startMs: now - 7_200_000, endMs: now - 1 };
    const result = buildDashboardScheduleNotices([event, overlap, touching, allDay, past, event], [], now);
    expect(result.conflicts.map(({ first, second }) => [first.id, second.id])).toEqual([["event", "overlap"]]);
    expect(buildDashboardScheduleNotices([event, overlap], [], event.endMs).conflicts).toEqual([]);
  });
});
