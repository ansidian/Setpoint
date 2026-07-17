// Mirror invalidation is intentionally not synchronous here: routes/calendar
// triggers calendar-search-mirror via requestCalendarSearchMirrorSync (1 s
// debounce + 15 min backstop worker, D-CAL-10).
import {
  type AuthorizedCalendarAccount,
  getAuthorizedAccount,
  getRawEvent,
  googleCalendarFetch,
  ifMatchHeaders,
  invalidateCalendarListCache,
  isGoogleEventAlreadyExistsError,
  isGoogleEventNotFoundError,
  listCalendarsForAccount,
  throwCalendarError,
} from "./calendar-google-client.ts";
import {
  addDaysIso,
  assertMutableGoogleEvent,
  buildFollowingSeriesRecurrence,
  buildGoogleRecurrenceRules,
  buildSeriesTrimmedBeforeTarget,
  DASHBOARD_CALENDAR_TZ,
  isRecurringEventResource,
  normalizeGoogleEvent,
  toIsoDate,
} from "./calendar-event-normalize.ts";
import { normalizeGoogleEventColorId } from "../../shared/calendar-event-colors.ts";
import type {
  CalendarAccount,
  CalendarEventMutationInput,
  GoogleCalendarSource,
  GoogleEventDateTime,
  GoogleEventResource,
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import type { StoredCalendarAccount } from "./calendar-google-client.ts";

interface GoogleCalendarMutationPayload {
  summary: string;
  location: string;
  description: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  colorId?: string;
  recurrence?: string[];
}

interface MutableEventContext {
  auth: AuthorizedCalendarAccount;
  calendar: GoogleCalendarSource;
  event: GoogleEventResource;
}

type CalendarMutationDraft = CalendarEventMutationInput & {
  calendarId: string;
};

function assertWriteAccess(auth: AuthorizedCalendarAccount, calendar: GoogleCalendarSource) {
  if (!auth.hasWriteScope) {
    throwCalendarError(403, "calendar_reauth_required", "Reconnect this Gmail account to edit calendar events.");
  }
  if (!calendar?.writable) {
    throwCalendarError(403, "calendar_not_writable", "This calendar is read-only in the dashboard.");
  }
}

async function getWritableCalendarContext(account: StoredCalendarAccount, calendarId: string) {
  const auth = await getAuthorizedAccount(account);
  const calendars = await listCalendarsForAccount(account);
  const calendar = calendars.find((entry) => entry.id === calendarId);
  if (!calendar) {
    throwCalendarError(404, "calendar_not_found", "Calendar source not found.");
  }
  assertWriteAccess(auth, calendar);
  return { auth, calendar };
}

function toTime(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throwCalendarError(400, "calendar_validation_error", `${label} must use HH:MM.`);
  }
  return value;
}

function toCalendarMutationPayload(input: CalendarEventMutationInput): GoogleCalendarMutationPayload {
  const title = String(input.title || "").trim();
  if (!title) {
    throwCalendarError(400, "calendar_validation_error", "Title is required.");
  }

  const allDay = !!input.allDay;
  const startDate = toIsoDate(input.startDate);
  const endDate = toIsoDate(input.endDate || input.startDate);
  const location = typeof input.location === "string" ? input.location.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const colorId = normalizeGoogleEventColorId(input.colorId);
  if (input.colorId != null && input.colorId !== "" && !colorId) {
    throwCalendarError(400, "calendar_validation_error", "Event color is not supported.");
  }
  const recurrence = buildGoogleRecurrenceRules(input.recurrence, {
    allDay,
    startDate,
    startTime: input.startTime,
  });

  if (allDay) {
    if (endDate < startDate) {
      throwCalendarError(400, "calendar_validation_error", "End date must be on or after the start date.");
    }
    const payload: GoogleCalendarMutationPayload = {
      summary: title,
      location,
      description,
      start: { date: startDate },
      end: { date: addDaysIso(endDate, 1) },
    };
    if (colorId) payload.colorId = colorId;
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

  const payload: GoogleCalendarMutationPayload = {
    summary: title,
    location,
    description,
    start: { dateTime: startIso, timeZone: DASHBOARD_CALENDAR_TZ },
    end: { dateTime: endIso, timeZone: DASHBOARD_CALENDAR_TZ },
  };
  if (colorId) payload.colorId = colorId;
  if (recurrence?.length) payload.recurrence = recurrence;
  return payload;
}

async function getMutableEventContext(
  account: StoredCalendarAccount,
  calendarId: string,
  eventId: string,
): Promise<MutableEventContext> {
  const { auth, calendar } = await getWritableCalendarContext(account, calendarId);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  const event = await res.json() as GoogleEventResource;
  assertMutableGoogleEvent(event);
  return { auth, calendar, event };
}

async function moveCalendarEvent(
  auth: AuthorizedCalendarAccount,
  sourceCalendarId: string,
  eventId: string,
  destinationCalendarId: string,
  etag?: string | null,
): Promise<GoogleEventResource> {
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move`, {
    method: "POST",
    query: { destination: destinationCalendarId },
    headers: ifMatchHeaders(etag),
  });
  return res.json() as Promise<GoogleEventResource>;
}

function toDraftFromGoogleEvent(
  event: GoogleEventResource,
  fallback: CalendarEventMutationInput = {},
): CalendarEventMutationInput {
  const allDay = !event.start?.dateTime && !!event.start?.date;
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date;
  const startDate = allDay ? startValue! : startValue!.slice(0, 10);
  const endDate = allDay ? addDaysIso(endValue!, -1) : endValue!.slice(0, 10);
  return {
    title: event.summary || fallback.title || "",
    allDay,
    startDate,
    endDate,
    startTime: allDay ? "" : startValue!.slice(11, 16),
    endTime: allDay ? "" : endValue!.slice(11, 16),
    location: event.location || fallback.location || "",
    description: event.description || fallback.description || "",
    recurrence: fallback.recurrence,
  };
}

function getTargetOriginalStart(event: GoogleEventResource): string | null {
  return event?.originalStartTime?.dateTime || event?.originalStartTime?.date || event?.start?.dateTime || event?.start?.date || null;
}

function isSameRecurringStart(left: string | null, right: string | null) {
  if (!left || !right) return false;
  const leftHasTime = String(left).includes("T");
  const rightHasTime = String(right).includes("T");

  if (leftHasTime && rightHasTime) {
    const leftMs = Date.parse(left);
    const rightMs = Date.parse(right);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return leftMs === rightMs;
  }

  return String(left).slice(0, 10) === String(right).slice(0, 10);
}

async function getRecurringMutationContext(
  account: StoredCalendarAccount,
  calendarId: string,
  eventId: string,
  input: CalendarEventMutationInput = {},
) {
  const selected = await getMutableEventContext(account, calendarId, eventId);
  const parentEventId = input.recurringEventId || selected.event.recurringEventId || selected.event.id;
  const parentEvent = parentEventId === selected.event.id
    ? selected.event
    : (await getRawEvent(account, calendarId, parentEventId, { auth: selected.auth })).event;

  return {
    ...selected,
    selectedEvent: selected.event,
    parentEvent,
    parentEventId,
    targetOriginalStart: input.originalStartTime || getTargetOriginalStart(selected.event),
  };
}

async function createCalendarEventImpl(
  account: StoredCalendarAccount,
  input: CalendarMutationDraft,
): Promise<NormalizedCalendarEvent> {
  const { auth, calendar } = await getWritableCalendarContext(account, input.calendarId);
  const payload = toCalendarMutationPayload(input);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events`, {
    method: "POST",
    body: payload,
  });
  const event = await res.json() as GoogleEventResource;
  return normalizeGoogleEvent({ account, calendar, event });
}

async function getMutableEventContextIfExists(
  account: StoredCalendarAccount,
  calendarId: string,
  eventId: string,
): Promise<MutableEventContext | null> {
  try {
    return await getMutableEventContext(account, calendarId, eventId);
  } catch (err) {
    if (isGoogleEventNotFoundError(err)) return null;
    throw err;
  }
}

async function patchSingleCalendarEvent(
  account: CalendarAccount,
  {
    auth,
    calendar,
    event,
    eventId,
    input,
  }: MutableEventContext & { eventId: string; input: CalendarMutationDraft },
): Promise<NormalizedCalendarEvent> {
  const payload = toCalendarMutationPayload(input);
  const targetEventId = event?.id || eventId;
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(targetEventId)}`, {
    method: "PATCH",
    body: payload,
    headers: ifMatchHeaders(event?.etag || input.etag),
  });
  return normalizeGoogleEvent({ account, calendar, event: await res.json() as GoogleEventResource });
}

async function updateCalendarEventImpl(
  account: StoredCalendarAccount,
  eventId: string,
  input: CalendarMutationDraft,
): Promise<NormalizedCalendarEvent> {
  const scope = input.scope || null;
  const sourceCalendarId = input.sourceCalendarId || input.calendarId;
  const targetCalendarId = input.calendarId;
  const calendarChanged = sourceCalendarId !== targetCalendarId;
  let sourceContext;
  try {
    sourceContext = await getMutableEventContext(account, sourceCalendarId, eventId);
  } catch (err) {
    if (calendarChanged && isGoogleEventNotFoundError(err)) {
      const recoveredTargetContext = await getMutableEventContextIfExists(account, targetCalendarId, eventId);
      if (recoveredTargetContext && !isRecurringEventResource(recoveredTargetContext.event)) {
        return patchSingleCalendarEvent(account, {
          ...recoveredTargetContext,
          eventId,
          input,
        });
      }
    }
    throw err;
  }
  const { auth, calendar, event } = sourceContext;

  if (!isRecurringEventResource(event)) {
    let targetCalendar = calendar;
    let targetEvent = event;

    if (calendarChanged) {
      const targetContext = await getWritableCalendarContext(account, targetCalendarId);
      targetCalendar = targetContext.calendar;
      try {
        targetEvent = await moveCalendarEvent(
          auth,
          sourceCalendarId,
          eventId,
          targetCalendarId,
          event.etag || input.etag,
        );
      } catch (err) {
        if (!isGoogleEventNotFoundError(err) && !isGoogleEventAlreadyExistsError(err)) throw err;
        const recoveredTargetContext = await getMutableEventContextIfExists(account, targetCalendarId, eventId);
        if (!recoveredTargetContext || isRecurringEventResource(recoveredTargetContext.event)) throw err;
        targetCalendar = recoveredTargetContext.calendar;
        targetEvent = recoveredTargetContext.event;
      }
    }

    return patchSingleCalendarEvent(account, {
      auth,
      calendar: targetCalendar,
      event: targetEvent,
      eventId,
      input,
    });
  }

  if (calendarChanged) {
    throwCalendarError(400, "calendar_recurring_move_unsupported", "Move recurring events from Google Calendar for now.");
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
      headers: ifMatchHeaders(event.etag || input.etag),
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() as GoogleEventResource });
  }

  const recurring = await getRecurringMutationContext(account, sourceCalendarId, eventId, input);
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
      headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() as GoogleEventResource });
  }

  if (scope !== "following") {
    throwCalendarError(400, "calendar_validation_error", "Unsupported recurring edit scope.");
  }

  const parentStart = getTargetOriginalStart(recurring.parentEvent);
  if (isSameRecurringStart(parentStart, recurring.targetOriginalStart)) {
    const payload = toCalendarMutationPayload({
      ...parentDraft,
      ...input,
      recurrence: input.recurrence || recurring.parentEvent.recurrence,
    });
    const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "PATCH",
      body: payload,
      headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
    });
    return normalizeGoogleEvent({ account, calendar, event: await res.json() as GoogleEventResource });
  }

  const trimmedRecurrence = buildSeriesTrimmedBeforeTarget(recurring.parentEvent, recurring.targetOriginalStart!);
  await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
    method: "PATCH",
    body: { recurrence: trimmedRecurrence },
    headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
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
  return normalizeGoogleEvent({ account, calendar, event: await inserted.json() as GoogleEventResource });
}

async function deleteCalendarEventImpl(
  account: StoredCalendarAccount,
  eventId: string,
  input: CalendarMutationDraft,
): Promise<void> {
  const scope = input.scope || null;
  const { auth, event } = await getMutableEventContext(account, input.calendarId, eventId);

  if (!isRecurringEventResource(event)) {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: ifMatchHeaders(event.etag || input.etag),
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
      headers: ifMatchHeaders(event.etag || input.etag),
    });
    return;
  }

  const recurring = await getRecurringMutationContext(account, input.calendarId, eventId, input);
  if (scope === "all") {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "DELETE",
      headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
    });
    return;
  }

  if (scope !== "following") {
    throwCalendarError(400, "calendar_validation_error", "Unsupported recurring delete scope.");
  }

  const parentStart = getTargetOriginalStart(recurring.parentEvent);
  if (isSameRecurringStart(parentStart, recurring.targetOriginalStart)) {
    await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
      method: "DELETE",
      headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
    });
    return;
  }

  const trimmedRecurrence = buildSeriesTrimmedBeforeTarget(recurring.parentEvent, recurring.targetOriginalStart!);
  await googleCalendarFetch(auth, `calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(recurring.parentEventId)}`, {
    method: "PATCH",
    body: { recurrence: trimmedRecurrence },
    headers: ifMatchHeaders(recurring.parentEvent.etag || input.etag),
  });
}

// Public mutation entry points invalidate the cached calendar list for the
// account on completion, so the next /range or /calendars read re-fetches a
// fresh list rather than serving a pre-write snapshot for up to the cache TTL.
export async function createCalendarEvent(
  account: StoredCalendarAccount,
  input: CalendarMutationDraft,
): Promise<NormalizedCalendarEvent> {
  try {
    return await createCalendarEventImpl(account, input);
  } finally {
    invalidateCalendarListCache(account?.id);
  }
}

export async function updateCalendarEvent(
  account: StoredCalendarAccount,
  eventId: string,
  input: CalendarMutationDraft,
): Promise<NormalizedCalendarEvent> {
  try {
    return await updateCalendarEventImpl(account, eventId, input);
  } finally {
    invalidateCalendarListCache(account?.id);
  }
}

export async function deleteCalendarEvent(
  account: StoredCalendarAccount,
  eventId: string,
  input: CalendarMutationDraft,
): Promise<void> {
  try {
    return await deleteCalendarEventImpl(account, eventId, input);
  } finally {
    invalidateCalendarListCache(account?.id);
  }
}
