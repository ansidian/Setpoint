import type { Client, InValue, Row } from "@libsql/client";
import db from "../db/connection.ts";
import { getCurrentCalendarSearchMirrorOccurrence } from "../calendar/calendar-search-mirror.ts";
import {
  computeGoogleRoute,
  type GoogleRouteEstimate,
} from "../platform/google-routes.ts";
import type { TimeToLeaveReminder } from "../../shared/types/reminders.ts";
import {
  calculateNextRouteCheck,
  calculateTimeToLeave,
  isPhysicalEventLocation,
} from "./time-to-leave-model.ts";
import { timeToLeaveRouteErrorCode } from "./time-to-leave-service.ts";
import { listDueTimeToLeaveReminders } from "./reminder-service.ts";

type DateInput = string | number | Date;
type RouteComputer = (input: {
  origin: { lat: number; lng: number };
  destination: string;
}) => Promise<GoogleRouteEstimate>;

interface HomeLocation {
  address: string;
  placeId: string;
  lat: number;
  lng: number;
}

interface CurrentOccurrence {
  accountId: string;
  calendarId: string;
  eventId: string;
  originalStartTime: string;
  title: string;
  location: string;
  startMs: number;
  allDay: boolean;
  status: string;
  url: string | null;
  sourceLabel: string;
  color: string | null;
  updatedAt: string;
}

export interface TimeToLeaveRefreshBatchResult {
  processed: number;
  refreshed: number;
  degraded: number;
  missed: number;
  stale: number;
}

interface TimeToLeaveRefreshOptions {
  now?: DateInput;
  limit?: number;
  dbClient?: Client;
  computeRoute?: RouteComputer;
}

const RETRY_MINUTES = 5;

function parseHome(row: Row | undefined): HomeLocation | null {
  const address = String(row?.home_location_address || "").trim();
  const placeId = String(row?.home_location_place_id || "").trim();
  const lat = row?.home_location_lat;
  const lng = row?.home_location_lng;
  if (
    !address
    || !placeId
    || typeof lat !== "number"
    || !Number.isFinite(lat)
    || typeof lng !== "number"
    || !Number.isFinite(lng)
  ) return null;
  return { address, placeId, lat, lng };
}

async function loadHome(dbClient: Client, userId: string): Promise<HomeLocation | null> {
  const result = await dbClient.execute({
    sql: `SELECT home_location_address, home_location_place_id,
                 home_location_lat, home_location_lng
          FROM ea_settings WHERE user_id = ?`,
    args: [userId],
  });
  return parseHome(result.rows[0]);
}

function parseOccurrence(rows: Row[]): CurrentOccurrence | null | "ambiguous" {
  if (rows.length > 1) return "ambiguous";
  const row = rows[0];
  if (!row) return null;
  return {
    accountId: String(row.account_id || ""),
    calendarId: String(row.calendar_id || ""),
    eventId: String(row.event_id || ""),
    originalStartTime: String(row.original_start_key || ""),
    title: String(row.title || "Calendar event"),
    location: String(row.location || "").trim(),
    startMs: Number(row.start_ms),
    allDay: !!row.all_day,
    status: String(row.status || "confirmed"),
    url: row.open_url || row.html_link ? String(row.open_url || row.html_link) : null,
    sourceLabel: String(row.source_label || "Calendar"),
    color: row.event_color || row.source_color ? String(row.event_color || row.source_color) : null,
    updatedAt: String(row.updated_at || ""),
  };
}

async function loadOccurrence(
  dbClient: Client,
  reminder: TimeToLeaveReminder,
): Promise<CurrentOccurrence | null | "ambiguous"> {
  if (!reminder.source_account_id || !reminder.source_calendar_id) return "ambiguous";
  const rows = await getCurrentCalendarSearchMirrorOccurrence({
    userId: reminder.user_id,
    accountId: reminder.source_account_id,
    calendarId: reminder.source_calendar_id,
    eventId: reminder.source_item_id,
    originalStartTime: reminder.source_occurrence_id,
  }, { dbClient });
  return parseOccurrence(rows);
}

function retryAt(nowIso: string): string {
  return new Date(new Date(nowIso).getTime() + RETRY_MINUTES * 60_000).toISOString();
}

async function markBlocked(
  dbClient: Client,
  reminder: TimeToLeaveReminder,
  code: string,
  nowIso: string,
  retry = true,
): Promise<boolean> {
  const result = await dbClient.execute({
    sql: `UPDATE ea_reminders
          SET route_status = 'blocked',
              route_error_code = ?,
              next_route_check_at = ?,
              updated_at = datetime('now')
          WHERE id = ?
            AND reminder_kind = 'time_to_leave'
            AND status = 'pending'
            AND route_checked_at IS ?
            AND next_route_check_at IS ?`,
    args: [
      code,
      retry ? retryAt(nowIso) : null,
      reminder.id,
      reminder.route_checked_at,
      reminder.next_route_check_at,
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

async function markMissed(
  dbClient: Client,
  reminder: TimeToLeaveReminder,
  code: string,
  nowIso: string,
): Promise<boolean> {
  const result = await dbClient.execute({
    sql: `UPDATE ea_reminders
          SET status = 'missed',
              missed_at = ?,
              route_status = 'blocked',
              route_error_code = ?,
              next_route_check_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?
            AND reminder_kind = 'time_to_leave'
            AND status = 'pending'
            AND route_checked_at IS ?
            AND next_route_check_at IS ?`,
    args: [
      nowIso,
      code,
      reminder.id,
      reminder.route_checked_at,
      reminder.next_route_check_at,
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

function reminderCas(reminder: TimeToLeaveReminder): { sql: string; args: InValue[] } {
  return {
    sql: `id = ?
          AND reminder_kind = 'time_to_leave'
          AND status = 'pending'
          AND route_checked_at IS ?
          AND next_route_check_at IS ?
          AND anchor_at = ?
          AND arrival_buffer_minutes = ?
          AND payload_snapshot_json IS ?`,
    args: [
      reminder.id,
      reminder.route_checked_at,
      reminder.next_route_check_at,
      reminder.anchor_at,
      reminder.arrival_buffer_minutes,
      reminder.payload_snapshot_json,
    ],
  };
}

function sourceStillCurrentSql(reminder: TimeToLeaveReminder) {
  const occurrenceSql = reminder.source_occurrence_id
    ? " AND c.original_start_key = ?"
    : "";
  return {
    sql: `AND EXISTS (
            SELECT 1 FROM ea_settings s
            WHERE s.user_id = ea_reminders.user_id
              AND s.home_location_address IS ?
              AND s.home_location_place_id IS ?
              AND s.home_location_lat IS ?
              AND s.home_location_lng IS ?
          )
          AND EXISTS (
            SELECT 1 FROM ea_calendar_search_occurrences c
            WHERE c.user_id = ea_reminders.user_id
              AND c.account_id = ea_reminders.source_account_id
              AND c.calendar_id = ea_reminders.source_calendar_id
              AND c.event_id = ea_reminders.source_item_id${occurrenceSql}
              AND c.start_ms = ?
              AND c.location = ?
              AND c.status = ?
              AND c.updated_at = ?
          )`,
    args: [] as InValue[],
  };
}

function sourceStillCurrentArgs(
  reminder: TimeToLeaveReminder,
  home: HomeLocation,
  occurrence: CurrentOccurrence,
): InValue[] {
  return [
    home.address,
    home.placeId,
    home.lat,
    home.lng,
    ...(reminder.source_occurrence_id ? [reminder.source_occurrence_id] : []),
    occurrence.startMs,
    occurrence.location,
    occurrence.status,
    occurrence.updatedAt,
  ];
}

async function recordRouteFailure({
  dbClient,
  reminder,
  home,
  occurrence,
  code,
  nowIso,
}: {
  dbClient: Client;
  reminder: TimeToLeaveReminder;
  home: HomeLocation;
  occurrence: CurrentOccurrence;
  code: string;
  nowIso: string;
}): Promise<boolean> {
  const cas = reminderCas(reminder);
  const source = sourceStillCurrentSql(reminder);
  const nextCheckAt = calculateNextRouteCheck({
    now: nowIso,
    eventStart: occurrence.startMs,
    estimatedDeparture: reminder.remind_at,
  }) || retryAt(nowIso);
  const boundedNext = new Date(Math.max(
    new Date(nextCheckAt).getTime(),
    new Date(retryAt(nowIso)).getTime(),
  )).toISOString();
  const result = await dbClient.execute({
    sql: `UPDATE ea_reminders
          SET route_status = 'degraded',
              route_error_code = ?,
              next_route_check_at = ?,
              updated_at = datetime('now')
          WHERE ${cas.sql}
          ${source.sql}`,
    args: [
      code,
      boundedNext,
      ...cas.args,
      ...sourceStillCurrentArgs(reminder, home, occurrence),
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

async function recordRouteSuccess({
  dbClient,
  reminder,
  home,
  occurrence,
  estimate,
  nowIso,
}: {
  dbClient: Client;
  reminder: TimeToLeaveReminder;
  home: HomeLocation;
  occurrence: CurrentOccurrence;
  estimate: GoogleRouteEstimate;
  nowIso: string;
}): Promise<boolean> {
  const eventStart = new Date(occurrence.startMs).toISOString();
  const remindAt = calculateTimeToLeave(
    eventStart,
    reminder.arrival_buffer_minutes,
    estimate.durationSeconds,
  );
  const nextRouteCheckAt = calculateNextRouteCheck({
    now: nowIso,
    eventStart,
    estimatedDeparture: remindAt,
  });
  const snapshot = {
    ...(reminder.payload_snapshot || {}),
    title: occurrence.title,
    context: occurrence.sourceLabel,
    url: occurrence.url,
    color: occurrence.color,
    location: occurrence.location,
  };
  const cas = reminderCas(reminder);
  const source = sourceStillCurrentSql(reminder);
  const result = await dbClient.execute({
    sql: `UPDATE ea_reminders
          SET anchor_at = ?,
              remind_at = ?,
              route_duration_seconds = ?,
              route_distance_meters = ?,
              route_checked_at = ?,
              next_route_check_at = ?,
              route_status = 'ready',
              route_error_code = NULL,
              payload_snapshot_json = ?,
              updated_at = datetime('now')
          WHERE ${cas.sql}
          ${source.sql}`,
    args: [
      eventStart,
      remindAt,
      estimate.durationSeconds,
      estimate.distanceMeters,
      nowIso,
      nextRouteCheckAt,
      JSON.stringify(snapshot),
      ...cas.args,
      ...sourceStillCurrentArgs(reminder, home, occurrence),
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

export async function processTimeToLeaveRefreshBatch({
  now = new Date(),
  limit = 10,
  dbClient = db,
  computeRoute = computeGoogleRoute,
}: TimeToLeaveRefreshOptions = {}): Promise<TimeToLeaveRefreshBatchResult> {
  const nowIso = new Date(now).toISOString();
  const due = await listDueTimeToLeaveReminders({ now: nowIso, limit }, { dbClient });
  const result: TimeToLeaveRefreshBatchResult = {
    processed: 0,
    refreshed: 0,
    degraded: 0,
    missed: 0,
    stale: 0,
  };

  for (const candidate of due) {
    if (candidate.reminder_kind !== "time_to_leave") continue;
    const reminder = candidate;
    result.processed += 1;

    if (new Date(reminder.anchor_at).getTime() <= new Date(nowIso).getTime()) {
      if (await markMissed(dbClient, reminder, "time_to_leave_event_started", nowIso)) {
        result.missed += 1;
      } else result.stale += 1;
      continue;
    }

    const occurrence = await loadOccurrence(dbClient, reminder);
    if (!occurrence || occurrence === "ambiguous") {
      if (await markBlocked(
        dbClient,
        reminder,
        occurrence === "ambiguous"
          ? "time_to_leave_occurrence_ambiguous"
          : "time_to_leave_occurrence_unavailable",
        nowIso,
      )) result.degraded += 1;
      else result.stale += 1;
      continue;
    }

    if (
      occurrence.status === "cancelled"
      || occurrence.allDay
      || !Number.isFinite(occurrence.startMs)
      || occurrence.startMs <= new Date(nowIso).getTime()
      || !isPhysicalEventLocation(occurrence.location)
    ) {
      const code = occurrence.status === "cancelled"
        ? "time_to_leave_event_cancelled"
        : occurrence.allDay
          ? "time_to_leave_all_day"
          : !isPhysicalEventLocation(occurrence.location)
            ? "time_to_leave_location_unsupported"
            : "time_to_leave_event_started";
      if (await markMissed(dbClient, reminder, code, nowIso)) result.missed += 1;
      else result.stale += 1;
      continue;
    }

    const home = await loadHome(dbClient, reminder.user_id);
    if (!home) {
      if (await markBlocked(
        dbClient,
        reminder,
        "time_to_leave_home_not_configured",
        nowIso,
        false,
      )) result.degraded += 1;
      else result.stale += 1;
      continue;
    }

    let estimate: GoogleRouteEstimate;
    try {
      estimate = await computeRoute({
        origin: { lat: home.lat, lng: home.lng },
        destination: occurrence.location,
      });
    } catch (error) {
      if (await recordRouteFailure({
        dbClient,
        reminder,
        home,
        occurrence,
        code: timeToLeaveRouteErrorCode(error),
        nowIso,
      })) result.degraded += 1;
      else result.stale += 1;
      continue;
    }

    if (await recordRouteSuccess({
      dbClient,
      reminder,
      home,
      occurrence,
      estimate,
      nowIso,
    })) result.refreshed += 1;
    else result.stale += 1;
  }

  return result;
}
