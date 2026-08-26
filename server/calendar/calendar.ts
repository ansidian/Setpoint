import {
  getAuthorizedAccount,
  googleCalendarFetch,
  listCalendarsForAccount,
} from "./calendar-google-client.ts";
import {
  DASHBOARD_CALENDAR_TZ,
  normalizeCancelledGoogleOccurrence,
  normalizeGoogleEvent,
} from "./calendar-event-normalize.ts";
import type {
  GoogleCalendarSource,
  GoogleEventResource,
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import type { CalendarServiceError, StoredCalendarAccount } from "./calendar-google-client.ts";

interface GoogleEventsResponse {
  items?: GoogleEventResource[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface CalendarMirrorWindow {
  start: string;
  end: string;
}

export {
  CALENDAR_WRITE_SCOPE,
  CALENDAR_FULL_SCOPE,
  invalidateCalendarListCache,
  listCalendarsForAccount,
} from "./calendar-google-client.ts";
export {
  DASHBOARD_CALENDAR_TZ,
  buildGoogleRecurrenceRules,
  extractStructuredRecurrence,
  normalizeGoogleCalendarLink,
  normalizeGoogleEvent,
} from "./calendar-event-normalize.ts";
export {
  createCalendarEvent,
  getCalendarEventIfExists,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "./calendar-mutations.ts";
export { applyCalendarEventWriteEffects } from "./calendar-event-write-effects.ts";
export { validateCalendarRange } from "./calendar-range-model.ts";
export {
  isCalendarSearchInputError,
  searchCalendar,
} from "./calendar-search-service.ts";

/**
 * Returns midnight (start) and 23:59:59.999 (end) for the Pacific-time date
 * that `date` falls on, as proper UTC-anchored Date objects regardless of the
 * server's local timezone.
 */
export function pacificDayBoundaries(date: Date) {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  const offsetMatch = offsetPart?.match(/GMT([+-]\d+(?::\d+)?)/);
  const [offsetHours = -8, offsetMins = 0] = offsetMatch
    ? offsetMatch[1]!.split(":").map(Number)
    : [-8, 0];
  const totalOffsetMs = (offsetHours * 60 + (offsetMins || 0) * Math.sign(offsetHours)) * 60000;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const yyyy = parts.year;
  const mm = parts.month;
  const dd = parts.day;

  const dayStart = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  dayStart.setTime(dayStart.getTime() - totalOffsetMs);

  const dayEnd = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999Z`);
  dayEnd.setTime(dayEnd.getTime() - totalOffsetMs);

  return { dayStart, dayEnd };
}

/**
 * Flags every timed event that strictly overlaps at least one other timed event
 * with `flag = "Conflict"`, mutating the passed events in place. All-day events
 * are ignored. This is a sweep-line replacement for the previous O(n^2) all-pairs
 * scan: sort by start, keep an active set of not-yet-ended intervals, evict the
 * ones that close before the current event begins, and any survivors overlap it.
 * O(n log n) for n timed events; behavior-identical for real (positive-duration)
 * calendar events.
 */
interface CalendarConflictEvent {
  startMs: number;
  endMs: number;
  allDay: boolean;
  flag?: "Conflict" | null;
}

export function markCalendarConflicts<T extends CalendarConflictEvent>(events: T[]): T[] {
  const timed = events.filter(
    (event) => !event.allDay && Number.isFinite(event.startMs) && Number.isFinite(event.endMs),
  );
  timed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const active: T[] = [];
  for (const event of timed) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i]!.endMs <= event.startMs) active.splice(i, 1);
    }
    if (active.length > 0) {
      event.flag = "Conflict";
      for (const other of active) other.flag = "Conflict";
    }
    active.push(event);
  }

  return events;
}

export async function fetchCalendar(
  gmailAccounts: StoredCalendarAccount[],
  {
    startDate,
    endDate,
    query,
    limit,
  }: { startDate?: Date; endDate?: Date; query?: string; limit?: number } = {},
): Promise<NormalizedCalendarEvent[]> {
  const allEvents: NormalizedCalendarEvent[] = [];
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

  // Fan out per account and per calendar concurrently. Each Google fetch is an
  // independent network round-trip; serializing them made calendar-open latency
  // scale with (accounts × calendars). Ordering is preserved by the ordered
  // maps + flat, so the downstream conflict/sort passes are unaffected.
  const perAccountEvents = await Promise.all(gmailAccounts.map(async (account) => {
    try {
      const auth = await getAuthorizedAccount(account);
      const calendars = await listCalendarsForAccount(account);

      const perCalendarEvents = await Promise.all(calendars.map(async (calendar) => {
        const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
          query: {
            timeMin: rangeStart.toISOString(),
            timeMax: rangeEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            q: query,
            maxResults: limit,
          },
        }).catch((err: unknown) => {
          const error = err as CalendarServiceError;
          if (error.code === "calendar_google_forbidden" || error.code === "calendar_google_error") {
            console.warn(`[Calendar] events fetch failed for ${account.email} cal=${calendar.id}: ${error.message}`);
            return null;
          }
          throw err;
        });

        if (!res) return [];
        const data = await res.json() as GoogleEventsResponse;
        return (data.items || []).map((event) => normalizeGoogleEvent({
          account,
          calendar,
          event,
          isMultiDayRange,
        }));
      }));

      return perCalendarEvents.flat();
    } catch (err: unknown) {
      console.error(`Calendar error for ${account.email}:`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }));

  for (const events of perAccountEvents) {
    allEvents.push(...events);
  }

  markCalendarConflicts(allEvents);

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

export async function fetchCalendarMirrorEvents(
  account: StoredCalendarAccount,
  calendar: GoogleCalendarSource,
  {
    window,
    syncToken = null,
    pageSize = 2500,
  }: { window?: CalendarMirrorWindow; syncToken?: string | null; pageSize?: number },
) {
  const auth = await getAuthorizedAccount(account);
  const events: NormalizedCalendarEvent[] = [];
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  do {
    const query = syncToken
      ? {
          syncToken,
          singleEvents: true,
          showDeleted: true,
          maxResults: pageSize,
          pageToken,
        }
      : {
          // No orderBy here: Google omits nextSyncToken from responses when
          // orderBy is set, which would silently force every mirror sync to be
          // a full re-sync. Mirror writes are keyed per occurrence, so response
          // order is irrelevant.
          timeMin: new Date(`${window!.start}T00:00:00.000Z`).toISOString(),
          timeMax: new Date(`${window!.end}T23:59:59.999Z`).toISOString(),
          singleEvents: true,
          showDeleted: true,
          maxResults: pageSize,
          pageToken,
        };

    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
      query,
    });
    const data = await res.json() as GoogleEventsResponse;
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

export async function getCalendarSourceGroups(accounts: StoredCalendarAccount[]) {
  const groups: Array<{
    accountId: string;
    accountLabel: string;
    accountEmail: string;
    calendars: GoogleCalendarSource[];
  }> = [];
  for (const account of accounts) {
    const calendars = await listCalendarsForAccount(account);
    groups.push({
      accountId: account.id,
      accountLabel: account.label || account.email,
      accountEmail: account.email,
      calendars,
    });
  }
  return groups;
}

export function formatCalendarRouteError(err: unknown) {
  const error = err as Partial<CalendarServiceError>;
  return {
    status: error?.status || 500,
    body: {
      code: error?.code || "calendar_unknown_error",
      message: error?.message || "Calendar request failed",
    },
  };
}
