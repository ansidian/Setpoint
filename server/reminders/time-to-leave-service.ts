import crypto from "crypto";
import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import {
  computeGoogleRoute,
  GoogleRoutesError,
  type GoogleRouteEstimate,
} from "../platform/google-routes.ts";
import type { CreateTimeToLeaveReminderRequest } from "../../shared/types/reminders.ts";
import {
  calculateNextRouteCheck,
  calculateTimeToLeave,
  normalizeTimeToLeaveRequest,
  TimeToLeaveError,
  type TimeToLeaveErrorCode,
} from "./time-to-leave-model.ts";

type DateInput = string | number | Date;
type RouteComputer = (input: {
  origin: { lat: number; lng: number };
  destination: string;
}) => Promise<GoogleRouteEstimate>;

export interface TimeToLeaveServiceOptions {
  dbClient?: Client;
  idFactory?: () => string;
  now?: DateInput;
  computeRoute?: RouteComputer;
}

export const ROUTE_ERROR_CODES = {
  maps_not_configured: "time_to_leave_maps_not_configured",
  routes_not_enabled: "time_to_leave_routes_not_enabled",
  credential_rejected: "time_to_leave_credential_rejected",
  destination_invalid: "time_to_leave_destination_invalid",
  no_route: "time_to_leave_no_route",
  rate_limited: "time_to_leave_rate_limited",
  timeout: "time_to_leave_timeout",
  provider_unavailable: "time_to_leave_provider_unavailable",
  malformed_response: "time_to_leave_provider_response_invalid",
} as const satisfies Record<GoogleRoutesError["code"], TimeToLeaveErrorCode>;

export function timeToLeaveRouteErrorCode(error: unknown): TimeToLeaveErrorCode {
  return error instanceof GoogleRoutesError
    ? ROUTE_ERROR_CODES[error.code]
    : "time_to_leave_provider_unavailable";
}

function currentDate(value: DateInput | undefined): Date {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("now must be a valid date");
  return date;
}

function mapRouteError(error: unknown): never {
  if (error instanceof GoogleRoutesError) {
    throw new TimeToLeaveError(
      timeToLeaveRouteErrorCode(error),
      error.message,
      error.status,
    );
  }
  throw new TimeToLeaveError(
    "time_to_leave_provider_unavailable",
    "Google Routes is temporarily unavailable.",
    503,
  );
}

export async function createTimeToLeaveReminderRecord(
  input: CreateTimeToLeaveReminderRequest & { userId: string },
  options: TimeToLeaveServiceOptions = {},
): Promise<string> {
  const dbClient = options.dbClient || db;
  const now = currentDate(options.now);
  const normalized = normalizeTimeToLeaveRequest(input, now);

  const settingsResult = await dbClient.execute({
    sql: `SELECT home_location_address, home_location_place_id,
                 home_location_lat, home_location_lng
          FROM ea_settings WHERE user_id = ?`,
    args: [input.userId],
  });
  const home = settingsResult.rows[0];
  const homeAddress = home?.home_location_address == null
    ? ""
    : String(home.home_location_address).trim();
  const homePlaceId = home?.home_location_place_id == null
    ? ""
    : String(home.home_location_place_id).trim();
  const homeLat = home?.home_location_lat;
  const homeLng = home?.home_location_lng;
  if (
    !homeAddress
    || !homePlaceId
    || typeof homeLat !== "number"
    || !Number.isFinite(homeLat)
    || homeLat < -90
    || homeLat > 90
    || typeof homeLng !== "number"
    || !Number.isFinite(homeLng)
    || homeLng < -180
    || homeLng > 180
  ) {
    throw new TimeToLeaveError(
      "time_to_leave_home_not_configured",
      "Save a complete Home location in Settings before enabling Time to Leave.",
      409,
    );
  }

  let estimate: GoogleRouteEstimate;
  try {
    estimate = await (options.computeRoute || computeGoogleRoute)({
      origin: { lat: homeLat, lng: homeLng },
      destination: normalized.eventLocation,
    });
  } catch (error) {
    mapRouteError(error);
  }

  const remindAt = calculateTimeToLeave(
    normalized.eventStart,
    normalized.arrivalBufferMinutes,
    estimate.durationSeconds,
  );
  const routeCheckedAt = now.toISOString();
  const nextRouteCheckAt = calculateNextRouteCheck({
    now,
    eventStart: normalized.eventStart,
    estimatedDeparture: remindAt,
  });
  const id = options.idFactory?.() || crypto.randomUUID();
  const payloadSnapshot = {
    ...(input.payloadSnapshot || {}),
    location: normalized.eventLocation,
  };

  await dbClient.execute({
    sql: `INSERT INTO ea_reminders
            (id, user_id, reminder_kind, source_type, source_account_id,
             source_calendar_id, source_item_id, source_occurrence_id,
             anchor_kind, anchor_at, offset_minutes, remind_at,
             arrival_buffer_minutes, route_duration_seconds,
             route_distance_meters, route_checked_at, next_route_check_at,
             route_status, route_error_code, payload_snapshot_json)
          VALUES (?, ?, 'time_to_leave', 'calendar_event', ?, ?, ?, ?,
                  'event_start', ?, 0, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?)`,
    args: [
      id,
      input.userId,
      normalized.sourceAccountId,
      normalized.sourceCalendarId,
      normalized.sourceItemId,
      normalized.sourceOccurrenceId,
      normalized.eventStart,
      remindAt,
      normalized.arrivalBufferMinutes,
      estimate.durationSeconds,
      estimate.distanceMeters,
      routeCheckedAt,
      nextRouteCheckAt,
      JSON.stringify(payloadSnapshot),
    ],
  });

  return id;
}
