import db from "../db/connection.js";
import { decrypt, encrypt } from "./encryption.js";

export const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";
export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_FULL_SCOPE = "https://www.googleapis.com/auth/calendar";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

class CalendarServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "CalendarServiceError";
    this.status = status;
    this.code = code;
  }
}

function throwCalendarError(status, code, message) {
  throw new CalendarServiceError(status, code, message);
}

/**
 * Returns midnight (start) and 23:59:59.999 (end) for the Pacific-time date
 * that `date` falls on, as proper UTC-anchored Date objects regardless of the
 * server's local timezone.
 */
export function pacificDayBoundaries(date) {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  const offsetMatch = offsetPart?.match(/GMT([+-]\d+(?::\d+)?)/);
  const [offsetHours, offsetMins] = offsetMatch
    ? offsetMatch[1].split(":").map(Number)
    : [-8, 0];
  const totalOffsetMs = (offsetHours * 60 + (offsetMins || 0) * Math.sign(offsetHours)) * 60000;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const yyyy = parts.year;
  const mm = parts.month;
  const dd = parts.day;

  const dayStart = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  dayStart.setTime(dayStart.getTime() - totalOffsetMs);

  const dayEnd = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999Z`);
  dayEnd.setTime(dayEnd.getTime() - totalOffsetMs);

  return { dayStart, dayEnd };
}

function getStoredScopes(credentials) {
  if (!Array.isArray(credentials?.scopes)) return [];
  return credentials.scopes.filter(Boolean);
}

function hasCalendarWriteScope(credentials) {
  const scopes = getStoredScopes(credentials);
  return scopes.includes(CALENDAR_WRITE_SCOPE) || scopes.includes(CALENDAR_FULL_SCOPE);
}

async function getAccountCredentials(account) {
  if (!account?.credentials_encrypted) {
    throwCalendarError(400, "calendar_auth_missing", "Calendar credentials are missing for this account");
  }
  try {
    return JSON.parse(decrypt(account.credentials_encrypted));
  } catch {
    throwCalendarError(500, "calendar_auth_invalid", "Calendar credentials could not be read");
  }
}

async function persistCredentials(accountId, credentials) {
  await db.execute({
    sql: `UPDATE ea_accounts
          SET credentials_encrypted = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [encrypt(JSON.stringify(credentials)), accountId],
  });
}

async function getAuthorizedAccount(account) {
  const credentials = await getAccountCredentials(account);

  if (credentials.expires_at < Date.now() + 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwCalendarError(401, "calendar_token_refresh_failed", `Calendar token refresh failed: ${text || res.status}`);
    }

    const data = await res.json();
    credentials.access_token = data.access_token;
    credentials.expires_at = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) credentials.refresh_token = data.refresh_token;
    if (data.scope) credentials.scopes = data.scope.split(" ").filter(Boolean);

    await persistCredentials(account.id, credentials);
  }

  return {
    account,
    accessToken: credentials.access_token,
    credentials,
    hasWriteScope: hasCalendarWriteScope(credentials),
  };
}

async function googleCalendarFetch(auth, path, { method = "GET", query, body, headers = {} } = {}) {
  const url = new URL(path, "https://www.googleapis.com/calendar/v3/");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 412) {
    throwCalendarError(409, "calendar_event_conflict", "This event changed elsewhere. Reload and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => "");
    throwCalendarError(403, "calendar_google_forbidden", text || "Google Calendar rejected this request");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throwCalendarError(502, "calendar_google_error", text || `Google Calendar request failed: ${res.status}`);
  }

  return res;
}

function buildSyntheticPrimaryCalendar(account, writable) {
  return {
    id: "primary",
    summary: "Primary",
    backgroundColor: account.color || "#4285f4",
    accessRole: writable ? "writer" : "reader",
    primary: true,
    writable,
  };
}

function normalizeCalendarEntry(account, raw, hasWriteScope) {
  const accessRole = raw.accessRole || "reader";
  const writable = hasWriteScope && (accessRole === "owner" || accessRole === "writer");
  return {
    id: raw.id,
    summary: raw.summary || raw.summaryOverride || raw.id || "Untitled calendar",
    backgroundColor: raw.backgroundColor || account.color || "#4285f4",
    accessRole,
    primary: !!raw.primary,
    writable,
  };
}

export async function listCalendarsForAccount(account) {
  const auth = await getAuthorizedAccount(account);
  let rawCalendars = [];
  let pageToken = null;

  do {
    const res = await googleCalendarFetch(auth, "users/me/calendarList", {
      query: { pageToken, maxResults: 250, showHidden: false },
    }).catch((err) => {
      if (err.code === "calendar_google_forbidden" || err.code === "calendar_google_error") {
        return null;
      }
      throw err;
    });

    if (!res) break;
    const data = await res.json();
    rawCalendars.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  if (rawCalendars.length === 0) {
    return [buildSyntheticPrimaryCalendar(account, auth.hasWriteScope)];
  }

  return rawCalendars
    .map((entry) => normalizeCalendarEntry(account, entry, auth.hasWriteScope))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      if (a.writable !== b.writable) return a.writable ? -1 : 1;
      return a.summary.localeCompare(b.summary);
    });
}

function findConferenceLink(event) {
  if (event?.hangoutLink) return event.hangoutLink;
  const entry = event?.conferenceData?.entryPoints?.find((item) => item.entryPointType === "video");
  return entry?.uri || null;
}

function isRecurringEventResource(event) {
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
  if (recurrence.some((line) => !String(line).startsWith("RRULE:"))) return null;

  const parts = parseRecurrenceRule(recurrence[0]);
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

  return {
    id: event.id,
    etag: event.etag || null,
    htmlLink: openUrl,
    openUrl,
    title: event.summary || "(No title)",
    time: isAllDay ? "All day" : formatTime(startValue),
    duration: isAllDay ? formatAllDayDuration(startValue, endValue) : formatDuration(startValue, endValue),
    location: event.location || "",
    description: event.description || "",
    attendees: normalizeAttendees(event.attendees),
    hangoutLink: findConferenceLink(event),
    source: calendar.summary,
    sourceColor: account.color || calendar.backgroundColor || "#4285f4",
    accountId: account.id,
    accountLabel: account.label,
    accountEmail: account.email,
    calendarId: calendar.id,
    calendarName: calendar.summary,
    color: calendar.backgroundColor || account.color || "#4285f4",
    flag: null,
    allDay: isAllDay,
    startMs,
    endMs,
    writable: !!calendar.writable,
    isRecurring: isRecurringEventResource(event),
    recurringEventId: event.recurringEventId || (Array.isArray(event.recurrence) && event.recurrence.length ? event.id : null),
    originalStartTime: normalizeOriginalStartTime(event.originalStartTime),
    recurringKind: recurrenceKindForEvent(event),
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

export async function fetchCalendar(gmailAccounts, { startDate, endDate } = {}) {
  const allEvents = [];
  if (!gmailAccounts?.length) return allEvents;

  let rangeStart;
  let rangeEnd;
  if (startDate && endDate) {
    rangeStart = startDate;
    rangeEnd = endDate;
  } else {
    const { dayStart, dayEnd } = pacificDayBoundaries(new Date());
    rangeStart = dayStart;
    rangeEnd = dayEnd;
  }
  const isMultiDayRange = !!(startDate && endDate);

  for (const account of gmailAccounts) {
    try {
      const auth = await getAuthorizedAccount(account);
      const calendars = await listCalendarsForAccount(account);

      for (const calendar of calendars) {
        const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
          query: {
            timeMin: rangeStart.toISOString(),
            timeMax: rangeEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
          },
        }).catch((err) => {
          if (err.code === "calendar_google_forbidden" || err.code === "calendar_google_error") {
            console.warn(`[Calendar] events fetch failed for ${account.email} cal=${calendar.id}: ${err.message}`);
            return null;
          }
          throw err;
        });

        if (!res) continue;
        const data = await res.json();
        for (const event of data.items || []) {
          allEvents.push(normalizeGoogleEvent({
            account,
            calendar,
            event,
            isMultiDayRange,
          }));
        }
      }
    } catch (err) {
      console.error(`Calendar error for ${account.email}:`, err.message);
    }
  }

  for (let i = 0; i < allEvents.length; i += 1) {
    if (allEvents[i].allDay) continue;
    for (let j = i + 1; j < allEvents.length; j += 1) {
      if (allEvents[j].allDay) continue;
      const a = allEvents[i];
      const b = allEvents[j];
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        a.flag = "Conflict";
        b.flag = "Conflict";
      }
    }
  }

  const nowMs = Date.now();
  const isFutureRange = startDate && startDate.getTime() > nowMs;
  allEvents.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.startMs - b.startMs;
  });

  return allEvents.map((event) => ({
    ...event,
    passed: isFutureRange ? false : (event.allDay ? false : event.endMs <= nowMs),
  }));
}

export async function getCalendarSourceGroups(accounts) {
  const groups = [];
  for (const account of accounts) {
    const calendars = await listCalendarsForAccount(account);
    groups.push({
      accountId: account.id,
      accountLabel: account.label,
      accountEmail: account.email,
      calendars,
    });
  }
  return groups;
}

function assertWriteAccess(auth, calendar) {
  if (!auth.hasWriteScope) {
    throwCalendarError(403, "calendar_reauth_required", "Reconnect this Gmail account to edit calendar events.");
  }
  if (!calendar?.writable) {
    throwCalendarError(403, "calendar_not_writable", "This calendar is read-only in the dashboard.");
  }
}

async function getWritableCalendarContext(account, calendarId) {
  const auth = await getAuthorizedAccount(account);
  const calendars = await listCalendarsForAccount(account);
  const calendar = calendars.find((entry) => entry.id === calendarId);
  if (!calendar) {
    throwCalendarError(404, "calendar_not_found", "Calendar source not found.");
  }
  assertWriteAccess(auth, calendar);
  return { auth, calendar };
}

function toIsoDate(dateValue) {
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throwCalendarError(400, "calendar_validation_error", "Dates must use YYYY-MM-DD.");
  }
  return dateValue;
}

function toTime(value, label) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throwCalendarError(400, "calendar_validation_error", `${label} must use HH:MM.`);
  }
  return value;
}

function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toCalendarMutationPayload(input) {
  const title = String(input.title || "").trim();
  if (!title) {
    throwCalendarError(400, "calendar_validation_error", "Title is required.");
  }

  const allDay = !!input.allDay;
  const startDate = toIsoDate(input.startDate);
  const endDate = toIsoDate(input.endDate || input.startDate);
  const location = typeof input.location === "string" ? input.location.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const recurrence = buildGoogleRecurrenceRules(input.recurrence, {
    allDay,
    startDate,
    startTime: input.startTime,
  });

  if (allDay) {
    if (endDate < startDate) {
      throwCalendarError(400, "calendar_validation_error", "End date must be on or after the start date.");
    }
    const payload = {
      summary: title,
      location,
      description,
      start: { date: startDate },
      end: { date: addDaysIso(endDate, 1) },
    };
    if (recurrence?.length) payload.recurrence = recurrence;
    return payload;
  }

  const startTime = toTime(input.startTime, "Start time");
  const endTime = toTime(input.endTime, "End time");
  const startIso = `${startDate}T${startTime}:00`;
  const endIso = `${endDate}T${endTime}:00`;
  if (endIso < startIso) {
    throwCalendarError(400, "calendar_validation_error", "End time must be on or after start time.");
  }

  const payload = {
    summary: title,
    location,
    description,
    start: { dateTime: startIso, timeZone: DASHBOARD_CALENDAR_TZ },
    end: { dateTime: endIso, timeZone: DASHBOARD_CALENDAR_TZ },
  };
  if (recurrence?.length) payload.recurrence = recurrence;
  return payload;
}

async function getRawEvent(account, calendarId, eventId) {
  const auth = await getAuthorizedAccount(account);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  const event = await res.json();
  return { auth, event };
}

async function getMutableEventContext(account, calendarId, eventId) {
  const { auth, calendar } = await getWritableCalendarContext(account, calendarId);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  const event = await res.json();
  return { auth, calendar, event };
}

function toDraftFromGoogleEvent(event, fallback = {}) {
  const allDay = !event.start?.dateTime && !!event.start?.date;
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date;
  const startDate = allDay ? startValue : startValue.slice(0, 10);
  const endDate = allDay ? addDaysIso(endValue, -1) : endValue.slice(0, 10);
  return {
    title: event.summary || fallback.title || "",
    allDay,
    startDate,
    endDate,
    startTime: allDay ? "" : startValue.slice(11, 16),
    endTime: allDay ? "" : endValue.slice(11, 16),
    location: event.location || fallback.location || "",
    description: event.description || fallback.description || "",
    recurrence: fallback.recurrence,
  };
}

function getTargetOriginalStart(event) {
  return event?.originalStartTime?.dateTime || event?.originalStartTime?.date || event?.start?.dateTime || event?.start?.date || null;
}

function stripRecurringEnds(ruleParts) {
  const next = { ...ruleParts };
  delete next.UNTIL;
  delete next.COUNT;
  return next;
}

function assertSimpleSeriesRecurrence(event, { allowCount = false } = {}) {
  const rules = event?.recurrence || [];
  if (!rules.length || rules.some((line) => !String(line).startsWith("RRULE:"))) {
    throwCalendarError(400, "calendar_recurring_unsupported", "Only simple RRULE recurring events are supported in the dashboard.");
  }
  const parts = parseRecurrenceRule(rules[0]);
  if (!parts?.FREQ) {
    throwCalendarError(400, "calendar_recurring_unsupported", "Recurring rule could not be parsed.");
  }
  if (!allowCount && parts.COUNT) {
    throwCalendarError(400, "calendar_recurring_unsupported", "This recurring series uses COUNT and can’t be split in the dashboard yet.");
  }
  return parts;
}

function buildSeriesTrimmedBeforeTarget(parentEvent, targetOriginalStart) {
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

function buildFollowingSeriesRecurrence(parentEvent, input) {
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

async function getRecurringMutationContext(account, calendarId, eventId, input = {}) {
  const selected = await getMutableEventContext(account, calendarId, eventId);
  const parentEventId = input.recurringEventId || selected.event.recurringEventId || selected.event.id;
  const parentEvent = parentEventId === selected.event.id
    ? selected.event
    : (await getRawEvent(account, calendarId, parentEventId)).event;

  return {
    ...selected,
    selectedEvent: selected.event,
    parentEvent,
    parentEventId,
    targetOriginalStart: input.originalStartTime || getTargetOriginalStart(selected.event),
  };
}

export async function createCalendarEvent(account, input) {
  const { auth, calendar } = await getWritableCalendarContext(account, input.calendarId);
  const payload = toCalendarMutationPayload(input);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
    method: "POST",
    body: payload,
  });
  const event = await res.json();
  return normalizeGoogleEvent({ account, calendar, event });
}

export async function updateCalendarEvent(account, eventId, input) {
  const scope = input.scope || null;
  const { auth, calendar, event } = await getMutableEventContext(account, input.calendarId, eventId);

  if (!isRecurringEventResource(event)) {
    const payload = toCalendarMutationPayload(input);
    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: payload,
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() });
  }

  if (!scope) {
    throwCalendarError(400, "calendar_recurring_scope_required", "Choose whether to edit all events, upcoming only, or just this one.");
  }

  if (scope === "one") {
    const payload = toCalendarMutationPayload({
      ...toDraftFromGoogleEvent(event),
      ...input,
      recurrence: undefined,
    });
    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: payload,
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() });
  }

  const recurring = await getRecurringMutationContext(account, input.calendarId, eventId, input);
  if (!recurring.targetOriginalStart) {
    throwCalendarError(400, "calendar_recurring_unsupported", "Could not determine the target recurring instance.");
  }

  const parentDraft = toDraftFromGoogleEvent(recurring.parentEvent);
  const selectedDraft = toDraftFromGoogleEvent(recurring.selectedEvent, { recurrence: input.recurrence });

  if (scope === "all" || recurring.parentEventId === eventId) {
    const payload = toCalendarMutationPayload({
      ...parentDraft,
      ...input,
      recurrence: input.recurrence || recurring.parentEvent.recurrence,
    });
    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "PATCH",
      body: payload,
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() });
  }

  if (scope !== "following") {
    throwCalendarError(400, "calendar_validation_error", "Unsupported recurring edit scope.");
  }

  const parentStart = getTargetOriginalStart(recurring.parentEvent);
  if (parentStart === recurring.targetOriginalStart) {
    const payload = toCalendarMutationPayload({
      ...parentDraft,
      ...input,
      recurrence: input.recurrence || recurring.parentEvent.recurrence,
    });
    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "PATCH",
      body: payload,
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() });
  }

  const trimmedRecurrence = buildSeriesTrimmedBeforeTarget(recurring.parentEvent, recurring.targetOriginalStart);
  await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
    method: "PATCH",
    body: { recurrence: trimmedRecurrence },
  });

  const followingRecurrence = buildFollowingSeriesRecurrence(recurring.parentEvent, {
    ...selectedDraft,
    ...input,
    startDate: input.startDate || selectedDraft.startDate,
    endDate: input.endDate || selectedDraft.endDate,
    startTime: input.startTime || selectedDraft.startTime,
    endTime: input.endTime || selectedDraft.endTime,
    allDay: input.allDay ?? selectedDraft.allDay,
  });
  const insertPayload = toCalendarMutationPayload({
    ...selectedDraft,
    ...input,
    startDate: input.startDate || selectedDraft.startDate,
    endDate: input.endDate || selectedDraft.endDate,
    startTime: input.startTime || selectedDraft.startTime,
    endTime: input.endTime || selectedDraft.endTime,
    allDay: input.allDay ?? selectedDraft.allDay,
    recurrence: followingRecurrence,
  });
  const inserted = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
    method: "POST",
    body: insertPayload,
  });
  return normalizeGoogleEvent({ account, calendar, event: await inserted.json() });
}

export async function deleteCalendarEvent(account, eventId, input) {
  const scope = input.scope || null;
  const { auth, event } = await getMutableEventContext(account, input.calendarId, eventId);

  if (!isRecurringEventResource(event)) {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return;
  }

  if (!scope) {
    throwCalendarError(400, "calendar_recurring_scope_required", "Choose whether to delete all events, upcoming only, or just this one.");
  }

  if (scope === "one") {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: { status: "cancelled" },
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return;
  }

  const recurring = await getRecurringMutationContext(account, input.calendarId, eventId, input);
  if (scope === "all") {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "DELETE",
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return;
  }

  if (scope !== "following") {
    throwCalendarError(400, "calendar_validation_error", "Unsupported recurring delete scope.");
  }

  const parentStart = getTargetOriginalStart(recurring.parentEvent);
  if (parentStart === recurring.targetOriginalStart) {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "DELETE",
      headers: input.etag ? { "If-Match": input.etag } : {},
    });
    return;
  }

  const trimmedRecurrence = buildSeriesTrimmedBeforeTarget(recurring.parentEvent, recurring.targetOriginalStart);
  await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
    method: "PATCH",
    body: { recurrence: trimmedRecurrence },
  });
}

export async function getCalendarEvent(account, calendarId, eventId) {
  const calendars = await listCalendarsForAccount(account);
  const calendar = calendars.find((entry) => entry.id === calendarId) || buildSyntheticPrimaryCalendar(account, false);
  const { event } = await getRawEvent(account, calendarId, eventId);
  return normalizeGoogleEvent({ account, calendar, event });
}

export function formatCalendarRouteError(err) {
  return {
    status: err?.status || 500,
    body: {
      code: err?.code || "calendar_unknown_error",
      message: err?.message || "Calendar request failed",
    },
  };
}

export function getNextWeekRange() {
  const now = new Date();
  const dayOfWeekStr = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    weekday: "short",
  }).format(now);
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayOfWeekStr);
  const daysUntilNextSunday = (7 - dayOfWeek) % 7 || 7;
  const nextSundayMs = now.getTime() + daysUntilNextSunday * 86400000;
  const { dayStart: startDate } = pacificDayBoundaries(new Date(nextSundayMs));
  const nextSaturdayMs = nextSundayMs + 6 * 86400000;
  const { dayEnd: endDate } = pacificDayBoundaries(new Date(nextSaturdayMs));
  return { startDate, endDate };
}

export function getTomorrowRange() {
  const tomorrow = new Date(Date.now() + 86400000);
  const { dayStart, dayEnd } = pacificDayBoundaries(tomorrow);
  return { startDate: dayStart, endDate: dayEnd };
}
