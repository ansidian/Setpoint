import type { CreateTimeToLeaveReminderRequest } from "../../shared/types/reminders.ts";

export type TimeToLeaveErrorCode =
  | "time_to_leave_invalid_source"
  | "time_to_leave_source_identity_required"
  | "time_to_leave_item_required"
  | "time_to_leave_occurrence_required"
  | "time_to_leave_all_day"
  | "time_to_leave_event_started"
  | "time_to_leave_location_required"
  | "time_to_leave_location_unsupported"
  | "time_to_leave_buffer_invalid"
  | "time_to_leave_home_not_configured"
  | "time_to_leave_maps_not_configured"
  | "time_to_leave_routes_not_enabled"
  | "time_to_leave_credential_rejected"
  | "time_to_leave_destination_invalid"
  | "time_to_leave_no_route"
  | "time_to_leave_rate_limited"
  | "time_to_leave_timeout"
  | "time_to_leave_provider_unavailable"
  | "time_to_leave_provider_response_invalid";

export class TimeToLeaveError extends Error {
  readonly code: TimeToLeaveErrorCode;
  readonly status: number;

  constructor(
    code: TimeToLeaveErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "TimeToLeaveError";
    this.code = code;
    this.status = status;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const URL_ONLY_RE = /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i;
const ZOOM_ONLY_RE = /^(?:zoom(?: meeting| call| video conference)?|join zoom)$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPhysicalEventLocation(value: unknown): boolean {
  const location = String(value || "").trim();
  return !!location && !URL_ONLY_RE.test(location) && !ZOOM_ONLY_RE.test(location);
}

function validDate(value: string | number | Date, fieldName: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} must be a valid date`);
  return date;
}

export function normalizeTimeToLeaveRequest(
  input: CreateTimeToLeaveReminderRequest,
  now: string | number | Date = new Date(),
) {
  if (input.sourceType !== "calendar_event") {
    throw new TimeToLeaveError(
      "time_to_leave_invalid_source",
      "Time to Leave is available only for calendar events.",
    );
  }

  const sourceAccountId = String(input.sourceAccountId || "").trim();
  const sourceCalendarId = String(input.sourceCalendarId || "").trim();
  if (!sourceAccountId || !sourceCalendarId) {
    throw new TimeToLeaveError(
      "time_to_leave_source_identity_required",
      "The calendar account and calendar are required for Time to Leave.",
    );
  }

  const sourceItemId = String(input.sourceItemId || "").trim();
  if (!sourceItemId) {
    throw new TimeToLeaveError(
      "time_to_leave_item_required",
      "A calendar event ID is required.",
    );
  }
  const sourceOccurrenceId = input.sourceOccurrenceId == null
    ? null
    : String(input.sourceOccurrenceId).trim() || null;
  if (input.isRecurring && !sourceOccurrenceId) {
    throw new TimeToLeaveError(
      "time_to_leave_occurrence_required",
      "Choose one recurring event occurrence for Time to Leave.",
    );
  }

  if (input.isAllDay !== undefined && typeof input.isAllDay !== "boolean") {
    throw new TimeToLeaveError(
      "time_to_leave_all_day",
      "isAllDay must be a boolean.",
    );
  }
  if (input.isRecurring !== undefined && typeof input.isRecurring !== "boolean") {
    throw new TimeToLeaveError(
      "time_to_leave_occurrence_required",
      "isRecurring must be a boolean.",
    );
  }
  if (input.isAllDay || DATE_ONLY_RE.test(String(input.eventStart || "").trim())) {
    throw new TimeToLeaveError(
      "time_to_leave_all_day",
      "Time to Leave requires a timed calendar event.",
    );
  }
  const eventStartDate = new Date(String(input.eventStart || ""));
  if (Number.isNaN(eventStartDate.getTime())) {
    throw new TimeToLeaveError(
      "time_to_leave_event_started",
      "The calendar event start time is invalid.",
    );
  }
  const nowDate = validDate(now, "now");
  if (eventStartDate.getTime() <= nowDate.getTime()) {
    throw new TimeToLeaveError(
      "time_to_leave_event_started",
      "Time to Leave requires an event that has not started.",
    );
  }

  const eventLocation = String(input.eventLocation || "").trim();
  if (!eventLocation) {
    throw new TimeToLeaveError(
      "time_to_leave_location_required",
      "Add a physical event location before enabling Time to Leave.",
    );
  }
  if (!isPhysicalEventLocation(eventLocation)) {
    throw new TimeToLeaveError(
      "time_to_leave_location_unsupported",
      "Time to Leave requires a physical event location.",
    );
  }

  const arrivalBufferMinutes = input.arrivalBufferMinutes ?? 15;
  if (
    !Number.isInteger(arrivalBufferMinutes)
    || arrivalBufferMinutes < 0
    || arrivalBufferMinutes > 120
  ) {
    throw new TimeToLeaveError(
      "time_to_leave_buffer_invalid",
      "Arrival buffer must be an integer from 0 through 120 minutes.",
    );
  }

  return {
    sourceAccountId,
    sourceCalendarId,
    sourceItemId,
    sourceOccurrenceId,
    eventStart: eventStartDate.toISOString(),
    eventLocation,
    arrivalBufferMinutes,
  };
}

export function calculateTimeToLeave(
  eventStart: string | number | Date,
  arrivalBufferMinutes: number,
  routeDurationSeconds: number,
): string {
  const eventStartDate = validDate(eventStart, "eventStart");
  if (!Number.isInteger(arrivalBufferMinutes) || arrivalBufferMinutes < 0) {
    throw new Error("arrivalBufferMinutes must be a non-negative integer");
  }
  if (!Number.isInteger(routeDurationSeconds) || routeDurationSeconds < 0) {
    throw new Error("routeDurationSeconds must be a non-negative integer");
  }
  return new Date(
    eventStartDate.getTime()
      - arrivalBufferMinutes * 60_000
      - routeDurationSeconds * 1000,
  ).toISOString();
}

export function calculateNextRouteCheck({
  now = new Date(),
  eventStart,
  estimatedDeparture,
}: {
  now?: string | number | Date;
  eventStart: string | number | Date;
  estimatedDeparture: string | number | Date;
}): string | null {
  const nowDate = validDate(now, "now");
  const eventStartDate = validDate(eventStart, "eventStart");
  const departureDate = validDate(estimatedDeparture, "estimatedDeparture");
  if (nowDate.getTime() >= eventStartDate.getTime()) return null;

  const untilDeparture = departureDate.getTime() - nowDate.getTime();
  let nextMs: number;
  if (untilDeparture > 3 * HOUR_MS) {
    nextMs = departureDate.getTime() - 3 * HOUR_MS;
  } else if (untilDeparture > HOUR_MS) {
    nextMs = nowDate.getTime() + 15 * 60_000;
  } else {
    nextMs = nowDate.getTime() + 5 * 60_000;
  }

  return new Date(Math.min(nextMs, eventStartDate.getTime())).toISOString();
}
