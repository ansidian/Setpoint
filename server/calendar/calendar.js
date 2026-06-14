import {
  buildSyntheticPrimaryCalendar,
  getAuthorizedAccount,
  getRawEvent,
  googleCalendarFetch,
  listCalendarsForAccount,
} from "./calendar-google-client.js";
import {
  DASHBOARD_CALENDAR_TZ,
  normalizeCancelledGoogleOccurrence,
  normalizeGoogleEvent,
} from "./calendar-event-normalize.js";

export {
  CALENDAR_WRITE_SCOPE,
  CALENDAR_FULL_SCOPE,
  listCalendarsForAccount,
} from "./calendar-google-client.js";
export {
  DASHBOARD_CALENDAR_TZ,
  buildGoogleRecurrenceRules,
  extractStructuredRecurrence,
  normalizeGoogleCalendarLink,
  normalizeGoogleEvent,
} from "./calendar-event-normalize.js";
export {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "./calendar-mutations.js";

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

export async function fetchCalendar(gmailAccounts, { startDate, endDate, query, limit } = {}) {
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
            q: query,
            maxResults: limit,
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

export async function fetchCalendarMirrorEvents(account, calendar, { window, syncToken = null, pageSize = 2500 } = {}) {
  const auth = await getAuthorizedAccount(account);
  const events = [];
  let pageToken = null;
  let nextSyncToken = null;

  do {
    const query = syncToken
      ? {
          syncToken,
          showDeleted: true,
          maxResults: pageSize,
          pageToken,
        }
      : {
          timeMin: new Date(`${window.start}T00:00:00.000Z`).toISOString(),
          timeMax: new Date(`${window.end}T23:59:59.999Z`).toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          showDeleted: true,
          maxResults: pageSize,
          pageToken,
        };

    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
      query,
    });
    const data = await res.json();
    nextSyncToken = data.nextSyncToken || nextSyncToken;
    for (const event of data.items || []) {
      if (event.status === "cancelled" && (!event.start?.dateTime && !event.start?.date)) {
        events.push(normalizeCancelledGoogleOccurrence({ account, calendar, event }));
      } else {
        events.push(normalizeGoogleEvent({
          account,
          calendar,
          event,
          isMultiDayRange: true,
        }));
      }
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return {
    events,
    nextSyncToken,
    fullSync: !syncToken,
  };
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
