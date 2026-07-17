import { throwCalendarError } from "./calendar-google-client.js";
import {
  googleEventColorForSourceHex,
  googleEventColorForId,
  normalizeGoogleEventColorId,
} from "../../shared/calendar-event-colors.ts";

export const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";

const GOOGLE_BIRTHDAY_SOURCE_LABEL = "Birthdays";
const GOOGLE_BIRTHDAY_SOURCE_COLOR = "#ff887c";

function findConferenceLink(event) {
  if (event?.hangoutLink) return event.hangoutLink;
  const entry = event?.conferenceData?.entryPoints?.find((item) => item.entryPointType === "video");
  return entry?.uri || null;
}

export function isRecurringEventResource(event) {
  return !!(event?.recurrence?.length || event?.recurringEventId || event?.originalStartTime);
}

function allDayAnchorMs(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getTime();
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatAllDayDuration(startStr, endStr) {
  if (!startStr || !endStr) return "";
  const days = Math.round((new Date(endStr) - new Date(startStr)) / 86400000);
  if (days <= 1) return "";
  return `${days} days`;
}

function formatDuration(startStr, endStr) {
  if (!startStr || !endStr) return "";
  const ms = new Date(endStr) - new Date(startStr);
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function normalizeAttendees(attendees) {
  if (!Array.isArray(attendees)) return [];
  return attendees
    .filter((attendee) => attendee?.email && !attendee.resource)
    .map((attendee) => attendee.displayName || attendee.email);
}

const RECURRENCE_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const WEEKDAY_TO_RRULE = {
  sunday: "SU",
  sun: "SU",
  monday: "MO",
  mon: "MO",
  tuesday: "TU",
  tue: "TU",
  tues: "TU",
  wednesday: "WE",
  wed: "WE",
  thursday: "TH",
  thu: "TH",
  thur: "TH",
  thurs: "TH",
  friday: "FR",
  fri: "FR",
  saturday: "SA",
  sat: "SA",
  SU: "SU",
  MO: "MO",
  TU: "TU",
  WE: "WE",
  TH: "TH",
  FR: "FR",
  SA: "SA",
};

function formatUtcCompact(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function laDateTimeToEpoch(dateStr, timeStr = "00:00") {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hour, minute] = String(timeStr).split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0);
  let epoch = target;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 2; pass += 1) {
    const out = {};
    for (const part of formatter.formatToParts(new Date(epoch))) {
      if (part.type !== "literal") out[part.type] = Number(part.value);
    }
    const actual = Date.UTC(out.year, (out.month || 1) - 1, out.day || 1, out.hour === 24 ? 0 : (out.hour || 0), out.minute || 0, 0);
    const drift = target - actual;
    if (drift === 0) break;
    epoch += drift;
  }

  return epoch;
}

function toAllDayUntil(dateStr) {
  return String(dateStr || "").replaceAll("-", "");
}

function normalizeWeekdayToken(value) {
  const token = WEEKDAY_TO_RRULE[String(value || "").trim()];
  if (!token) {
    throwCalendarError(400, "calendar_validation_error", `Unsupported weekday "${value}".`);
  }
  return token;
}

function parseRecurrenceRule(ruleLine) {
  if (typeof ruleLine !== "string" || !ruleLine.startsWith("RRULE:")) return null;
  return ruleLine
    .slice(6)
    .split(";")
    .filter(Boolean)
    .reduce((acc, segment) => {
      const [key, ...rest] = segment.split("=");
      acc[key] = rest.join("=");
      return acc;
    }, {});
}

function serializeRecurrenceRule(parts) {
  return `RRULE:${Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(";")}`;
}

function getRecurrenceRuleLine(recurrence) {
  if (!Array.isArray(recurrence)) return null;
  return recurrence.find((line) => String(line).startsWith("RRULE:")) || null;
}

function parseRecurrenceEnds(parts) {
  if (parts.COUNT) {
    return {
      type: "afterCount",
      count: Number(parts.COUNT),
    };
  }
  if (parts.UNTIL) {
    const until = parts.UNTIL;
    if (/^\d{8}$/.test(until)) {
      return {
        type: "onDate",
        untilDate: `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
      };
    }
    const iso = until.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6.000Z",
    );
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      const untilDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: DASHBOARD_CALENDAR_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
      return { type: "onDate", untilDate };
    }
  }
  return { type: "never" };
}

export function extractStructuredRecurrence(recurrence) {
  if (!Array.isArray(recurrence) || !recurrence.length) return null;

  const parts = parseRecurrenceRule(getRecurrenceRuleLine(recurrence));
  if (!parts?.FREQ || !RECURRENCE_FREQ.has(parts.FREQ)) return null;

  return {
    frequency: parts.FREQ.toLowerCase(),
    interval: Number(parts.INTERVAL || 1),
    weekdays: parts.BYDAY ? parts.BYDAY.split(",").filter(Boolean) : [],
    monthDay: parts.BYMONTHDAY ? Number(parts.BYMONTHDAY) : null,
    month: parts.BYMONTH ? Number(parts.BYMONTH) : null,
    ends: parseRecurrenceEnds(parts),
  };
}

function buildUntilValue({ allDay, untilDate, startTime }) {
  if (allDay) return toAllDayUntil(untilDate);
  const epoch = laDateTimeToEpoch(untilDate, startTime || "00:00");
  return formatUtcCompact(new Date(epoch));
}

export function buildGoogleRecurrenceRules(input, timing = {}) {
  if (!input) return null;
  if (Array.isArray(input)) return input.filter(Boolean);

  const frequency = String(input.frequency || "").trim().toUpperCase();
  if (!RECURRENCE_FREQ.has(frequency)) {
    throwCalendarError(400, "calendar_validation_error", "Recurrence frequency is required.");
  }

  const interval = Number(input.interval || 1);
  if (!Number.isInteger(interval) || interval <= 0) {
    throwCalendarError(400, "calendar_validation_error", "Recurrence interval must be a positive integer.");
  }

  const startDate = toIsoDate(timing.startDate);
  const startTime = timing.startTime || "00:00";
  const parts = {
    FREQ: frequency,
    INTERVAL: String(interval),
  };

  if (frequency === "WEEKLY") {
    const weekdays = (input.weekdays || []).map(normalizeWeekdayToken);
    if (!weekdays.length) {
      throwCalendarError(400, "calendar_validation_error", "Weekly recurrence requires at least one weekday.");
    }
    parts.BYDAY = [...new Set(weekdays)].join(",");
  }

  if (frequency === "MONTHLY") {
    const monthDay = Number(input.monthDay || Number(startDate.slice(-2)));
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      throwCalendarError(400, "calendar_validation_error", "Monthly recurrence requires a valid month day.");
    }
    parts.BYMONTHDAY = String(monthDay);
  }

  if (frequency === "YEARLY") {
    const month = Number(input.month || Number(startDate.slice(5, 7)));
    const monthDay = Number(input.monthDay || Number(startDate.slice(-2)));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throwCalendarError(400, "calendar_validation_error", "Yearly recurrence requires a valid month.");
    }
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      throwCalendarError(400, "calendar_validation_error", "Yearly recurrence requires a valid month day.");
    }
    parts.BYMONTH = String(month);
    parts.BYMONTHDAY = String(monthDay);
  }

  const ends = input.ends || { type: "never" };
  if (ends.type === "onDate") {
    const untilDate = toIsoDate(ends.untilDate);
    parts.UNTIL = buildUntilValue({
      allDay: !!timing.allDay,
      untilDate,
      startTime,
    });
  } else if (ends.type === "afterCount") {
    const count = Number(ends.count);
    if (!Number.isInteger(count) || count <= 0) {
      throwCalendarError(400, "calendar_validation_error", "Recurrence count must be a positive integer.");
    }
    parts.COUNT = String(count);
  } else if (ends.type !== "never") {
    throwCalendarError(400, "calendar_validation_error", "Unsupported recurrence end condition.");
  }

  return [serializeRecurrenceRule(parts)];
}

function normalizeOriginalStartTime(originalStartTime) {
  if (!originalStartTime) return null;
  return originalStartTime.dateTime || originalStartTime.date || null;
}

function recurrenceKindForEvent(event) {
  if (Array.isArray(event?.recurrence) && event.recurrence.length) return "series";
  if (event?.recurringEventId || event?.originalStartTime) return "instance";
  return null;
}

function normalizeGoogleEventType(event) {
  return String(event?.eventType || "default");
}

function normalizeBirthdayProperties(value) {
  if (!value) return null;
  return {
    type: value.type || "birthday",
    customTypeName: value.customTypeName || "",
    contact: value.contact || "",
  };
}

function googleEventReadOnlyReason(event) {
  const eventType = normalizeGoogleEventType(event);
  if (eventType === "default") return null;
  return eventType === "birthday" ? "birthday" : "google_event_type";
}

function googleEventDisplaySource(event, calendar, account) {
  if (normalizeGoogleEventType(event) === "birthday") {
    return {
      label: GOOGLE_BIRTHDAY_SOURCE_LABEL,
      color: GOOGLE_BIRTHDAY_SOURCE_COLOR,
    };
  }
  return {
    label: calendar.summary,
    color: calendar.backgroundColor || account.color || "#4285f4",
  };
}

export function assertMutableGoogleEvent(event) {
  const reason = googleEventReadOnlyReason(event);
  if (!reason) return;
  throwCalendarError(
    403,
    "calendar_event_read_only",
    reason === "birthday"
      ? "Birthday events are read-only in the dashboard."
      : "This Google Calendar event type is read-only in the dashboard.",
    { eventType: normalizeGoogleEventType(event), readOnlyReason: reason },
  );
}

export function normalizeGoogleCalendarLink(rawUrl, accountEmail) {
  if (!rawUrl || !accountEmail) return rawUrl || null;

  try {
    const url = new URL(rawUrl);
    const isCalendarGoogleHost = /calendar\.google\.com$/i.test(url.hostname);
    const isGoogleEventRedirect = /(^|\.)google\.com$/i.test(url.hostname)
      && url.pathname === "/calendar/event"
      && !!url.searchParams.get("eid");

    if (!isCalendarGoogleHost && !isGoogleEventRedirect) return rawUrl;

    if (isGoogleEventRedirect) {
      const eventId = url.searchParams.get("eid");
      const normalized = new URL(`https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(eventId)}`);
      normalized.searchParams.set("authuser", accountEmail);
      return normalized.toString();
    }

    url.searchParams.set("authuser", accountEmail);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function normalizeGoogleEvent({ account, calendar, event, isMultiDayRange = false }) {
  const isAllDay = !event.start?.dateTime && !!event.start?.date;
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date;
  const startMs = isAllDay ? allDayAnchorMs(startValue) : new Date(startValue).getTime();
  const endMs = isAllDay ? allDayAnchorMs(endValue) : new Date(endValue).getTime();
  const openUrl = normalizeGoogleCalendarLink(event.htmlLink || null, account.email);
  const recurrence = extractStructuredRecurrence(event.recurrence);
  const colorId = normalizeGoogleEventColorId(event.colorId);
  const explicitColor = googleEventColorForId(colorId)?.hex || null;
  const inheritedColor = calendar.backgroundColor || account.color || "#4285f4";
  const eventType = normalizeGoogleEventType(event);
  const readOnlyReason = googleEventReadOnlyReason(event);
  const displaySource = googleEventDisplaySource(event, calendar, account);
  const sourceEventColor = googleEventColorForSourceHex(displaySource.color);

  return {
    id: event.id,
    etag: event.etag || null,
    eventType,
    birthdayProperties: normalizeBirthdayProperties(event.birthdayProperties),
    htmlLink: openUrl,
    openUrl,
    title: event.summary || "(No title)",
    time: isAllDay ? "All day" : formatTime(startValue),
    duration: isAllDay ? formatAllDayDuration(startValue, endValue) : formatDuration(startValue, endValue),
    location: event.location || "",
    description: event.description || "",
    attendees: normalizeAttendees(event.attendees),
    hangoutLink: findConferenceLink(event),
    source: displaySource.label,
    sourceColor: displaySource.color,
    sourceColorId: sourceEventColor?.colorId || null,
    accountId: account.id,
    accountLabel: account.label,
    accountEmail: account.email,
    calendarId: calendar.id,
    calendarName: displaySource.label,
    colorId,
    color: explicitColor || sourceEventColor?.hex || displaySource.color || inheritedColor,
    flag: null,
    allDay: isAllDay,
    startMs,
    endMs,
    writable: !!calendar.writable && !readOnlyReason,
    readOnlyReason,
    isRecurring: isRecurringEventResource(event),
    recurringEventId: event.recurringEventId || (Array.isArray(event.recurrence) && event.recurrence.length ? event.id : null),
    originalStartTime: normalizeOriginalStartTime(event.originalStartTime),
    recurringKind: recurrenceKindForEvent(event),
    status: event.status || "confirmed",
    recurrence: recurrence
      ? {
          ...recurrence,
          rules: [...(event.recurrence || [])],
        }
      : null,
    passed: false,
    ...(isMultiDayRange && {
      dayLabel: new Date(isAllDay ? `${startValue}T12:00:00Z` : startValue).toLocaleDateString("en-US", {
        timeZone: DASHBOARD_CALENDAR_TZ,
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    }),
  };
}

export function normalizeCancelledGoogleOccurrence({ account, calendar, event }) {
  const originalStartTime = normalizeOriginalStartTime(event.originalStartTime);
  return {
    id: event.id,
    etag: event.etag || null,
    title: event.summary || "(Deleted event)",
    time: "",
    duration: "",
    location: event.location || "",
    description: event.description || "",
    source: calendar.summary,
    sourceColor: calendar.backgroundColor || account.color || "#4285f4",
    accountId: account.id,
    accountLabel: account.label,
    accountEmail: account.email,
    calendarId: calendar.id,
    calendarName: calendar.summary,
    allDay: false,
    startMs: originalStartTime ? Date.parse(originalStartTime) || 0 : 0,
    endMs: originalStartTime ? Date.parse(originalStartTime) || 0 : 0,
    isRecurring: !!(event.recurringEventId || event.originalStartTime),
    recurringEventId: event.recurringEventId || null,
    originalStartTime,
    recurringKind: recurrenceKindForEvent(event),
    status: "cancelled",
  };
}

export function toIsoDate(dateValue) {
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throwCalendarError(400, "calendar_validation_error", "Dates must use YYYY-MM-DD.");
  }
  return dateValue;
}

export function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stripRecurringEnds(ruleParts) {
  const next = { ...ruleParts };
  delete next.UNTIL;
  delete next.COUNT;
  return next;
}

function assertSimpleSeriesRecurrence(event, { allowCount = false } = {}) {
  const rules = event?.recurrence || [];
  const ruleLine = getRecurrenceRuleLine(rules);
  if (!ruleLine) {
    throwCalendarError(400, "calendar_recurring_unsupported", "Only simple RRULE recurring events are supported in the dashboard.");
  }
  const parts = parseRecurrenceRule(ruleLine);
  if (!parts?.FREQ) {
    throwCalendarError(400, "calendar_recurring_unsupported", "Recurring rule could not be parsed.");
  }
  if (!allowCount && parts.COUNT) {
    throwCalendarError(400, "calendar_recurring_unsupported", "This recurring series uses COUNT and can’t be split in the dashboard yet.");
  }
  return parts;
}

export function buildSeriesTrimmedBeforeTarget(parentEvent, targetOriginalStart) {
  const ruleParts = assertSimpleSeriesRecurrence(parentEvent, { allowCount: true });
  const trimmed = { ...ruleParts };
  delete trimmed.COUNT;

  if (targetOriginalStart.includes("T")) {
    const targetDate = new Date(targetOriginalStart);
    trimmed.UNTIL = formatUtcCompact(new Date(targetDate.getTime() - 1000));
  } else {
    trimmed.UNTIL = toAllDayUntil(addDaysIso(targetOriginalStart, -1));
  }

  return [serializeRecurrenceRule(trimmed)];
}

export function buildFollowingSeriesRecurrence(parentEvent, input) {
  if (input.recurrence) {
    return buildGoogleRecurrenceRules(input.recurrence, {
      allDay: !!input.allDay,
      startDate: input.startDate,
      startTime: input.startTime,
    });
  }

  const ruleParts = assertSimpleSeriesRecurrence(parentEvent);
  return [serializeRecurrenceRule(stripRecurringEnds(ruleParts))];
}
