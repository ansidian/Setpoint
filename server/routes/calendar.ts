import { Router, type Request, type Response } from "express";
import type { Row } from "@libsql/client";
import { requireCookieSession } from "../middleware/auth.ts";
import { applyDeadlineCurrentStatus } from "../dashboard/current-service.ts";
import {
  readCalendarDeadlines,
  readCalendarDeadlineRange,
} from "../tasks/deadlines-read.ts";
import * as tasksService from "../tasks/tasks-service.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import {
  fetchCalendar,
  pacificDayBoundaries,
  getCalendarSourceGroups,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  formatCalendarRouteError,
  isCalendarSearchInputError,
  searchCalendar,
  validateCalendarRange as validateCalendarRangeQuery,
} from "../calendar/calendar.ts";
import {
  getGooglePlaceDetails,
  suggestGooglePlaces,
} from "../platform/google-places.ts";
import { placesLimiter } from "../middleware/rate-limits.ts";
import {
  deleteSourceReminders,
  recomputeUnsentRemindersForSource,
} from "../reminders/reminder-service.ts";
import {
  calendarEventAnchorAt,
  hydrateCalendarEventsWithReminderState,
} from "../reminders/reminder-hydration.ts";
import {
  deleteCalendarSearchMirrorOccurrence,
  markCalendarSearchMirrorDirty,
  upsertCalendarSearchMirrorOccurrence,
} from "../calendar/calendar-search-mirror.ts";
import { readCalendarBillsRange } from "./calendar-bills-range.ts";
import type {
  CalendarRecurrenceScope,
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import type { StoredCalendarAccount } from "../calendar/calendar-google-client.ts";

type RouteError = Error & { status?: number; code?: string };
type CalendarIdentityEvent = Partial<Pick<
  NormalizedCalendarEvent,
  "isRecurring" | "originalStartTime" | "recurringEventId" | "recurrence" | "accountId" | "calendarId" | "id"
>>;

function calendarUserId(): string {
  return process.env.EA_USER_ID!;
}

function routeError(error: unknown): RouteError {
  return error as RouteError;
}

const router = Router();
router.use(requireCookieSession);

function handleCalendarRouteError(res: Response, err: unknown, fallbackMessage: string) {
  const error = routeError(err);
  if (error?.status && error?.code) {
    const formatted = formatCalendarRouteError(error);
    return res.status(formatted.status).json(formatted.body);
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ code: "calendar_route_error", message: fallbackMessage });
}

function resolveCalendarAccount(accounts: Row[], accountId: string): StoredCalendarAccount {
  const account = accounts.find(
    (entry) => entry.id === accountId && entry.type === "gmail" && entry.calendar_enabled,
  );
  if (!account) {
    const err = new Error("Calendar account not found") as RouteError;
    err.status = 404;
    err.code = "calendar_account_not_found";
    throw err;
  }
  return account as unknown as StoredCalendarAccount;
}

async function loadCalendarAccount(accountId: string) {
  const userId = calendarUserId();
  const { accounts } = await loadUserConfig(userId);
  return resolveCalendarAccount(accounts, accountId);
}

router.get("/deadlines", async (_req, res) => {
  try {
    const userId = calendarUserId();
    res.json(await readCalendarDeadlines(userId));
  } catch (err) {
    console.error("[Calendar] deadlines fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar deadlines" });
  }
});

function handleDeadlineMutationError(res: Response, err: unknown, fallbackMessage: string) {
  const error = routeError(err);
  const status = error?.status || 500;
  if (status >= 500) console.error(fallbackMessage, err);
  return res.status(status).json({ message: error?.message || fallbackMessage });
}

router.post("/deadlines", async (req, res) => {
  try {
    const userId = calendarUserId();
    const deadline = await tasksService.createDeadline(userId, req.body || {});
    res.status(201).json({ deadline });
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to create deadline");
  }
});

router.patch("/deadlines/:deadlineId", async (req, res) => {
  try {
    const userId = calendarUserId();
    const deadline = await tasksService.updateDeadline(userId, req.params.deadlineId, req.body || {});
    res.json({ deadline });
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to update deadline");
  }
});

router.delete("/deadlines/:deadlineId", async (req, res) => {
  try {
    const userId = calendarUserId();
    await tasksService.deleteDeadline(userId, req.params.deadlineId);
    res.json({ ok: true });
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to delete deadline");
  }
});

router.post("/deadlines/:deadlineId/completed-occurrences/:date", async (req, res) => {
  if (!ISO_DATE_RE.test(req.params.date)) {
    return res.status(400).json({ message: "Deadline occurrence date must be YYYY-MM-DD" });
  }
  try {
    const userId = calendarUserId();
    const result = await tasksService.completeDeadlineOccurrence(
      userId,
      req.params.deadlineId,
      req.params.date,
    );
    applyDeadlineCurrentStatus(userId, req.params.deadlineId, "complete").catch((err: unknown) => {
      console.error("[Calendar] Failed to update current Todoist deadline cache:", routeError(err).message);
    });
    res.json(result);
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to complete deadline occurrence");
  }
  return undefined;
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/search", async (req, res) => {
  try {
    return res.json(await searchCalendar(calendarUserId(), req.query));
  } catch (err) {
    if (isCalendarSearchInputError(err)) {
      const error = routeError(err);
      return res.status(error.status || 400).json({ code: error.code, message: error.message });
    }
    console.error("[Calendar] search failed:", err);
    return res.status(500).json({ code: "calendar_search_error", message: "Failed to search calendar" });
  }
});

function validateCalendarRange(
  req: Request,
  res: Response,
  { enforceHistoryWindow = false }: { enforceHistoryWindow?: boolean } = {},
) {
  const result = validateCalendarRangeQuery(req.query, { enforceHistoryWindow });
  if (result.ok) return result.value;
  res.status(400).json({ message: result.message });
  return null;
}

function eventOccurrenceIdentity({
  event,
  originalStartTime,
  scope,
}: {
  event: CalendarIdentityEvent;
  originalStartTime?: string | null;
  scope?: CalendarRecurrenceScope;
}) {
  if (scope && scope !== "one") return undefined;
  if (originalStartTime) return originalStartTime;
  if (event?.isRecurring) {
    if (event.originalStartTime) return event.originalStartTime;
    return calendarEventAnchorAt(event);
  }
  return undefined;
}

function isRecurringCalendarMirrorWrite(
  event: CalendarIdentityEvent | null,
  {
    scope,
    recurringEventId,
    originalStartTime,
  }: {
    scope?: CalendarRecurrenceScope;
    recurringEventId?: string | null;
    originalStartTime?: string | null;
  } = {},
) {
  return !!(
    event?.isRecurring
    || event?.recurringEventId
    || event?.recurrence
    || scope
    || recurringEventId
    || originalStartTime
  );
}

function scheduleCalendarMirrorDirty({
  userId,
  accountId,
  calendarId,
  reason = "calendar-write",
}: { userId: string; accountId: string; calendarId: string; reason?: string }) {
  markCalendarSearchMirrorDirty(userId, { accountId, calendarId, reason }).catch((err: unknown) => {
    console.error("[Calendar] search mirror dirty marking failed:", routeError(err).message);
  });
}

function scheduleCalendarMirrorUpsert(userId: string, event: NormalizedCalendarEvent) {
  if (!event?.accountId || !event?.calendarId) return;
  if (isRecurringCalendarMirrorWrite(event)) {
    scheduleCalendarMirrorDirty({
      userId,
      accountId: event.accountId,
      calendarId: event.calendarId,
    });
    return;
  }
  upsertCalendarSearchMirrorOccurrence(userId, event).catch((err: unknown) => {
    console.error("[Calendar] search mirror write-through failed:", routeError(err).message);
  });
}

function scheduleCalendarMirrorDelete(userId: string, {
  accountId,
  calendarId,
  eventId,
  scope,
  recurringEventId,
  originalStartTime,
}: {
  accountId?: string;
  calendarId?: string;
  eventId?: string;
  scope?: CalendarRecurrenceScope;
  recurringEventId?: string | null;
  originalStartTime?: string | null;
}) {
  if (!accountId || !calendarId || !eventId) return;
  if (isRecurringCalendarMirrorWrite(null, { scope, recurringEventId, originalStartTime })) {
    scheduleCalendarMirrorDirty({ userId, accountId, calendarId });
    return;
  }
  deleteCalendarSearchMirrorOccurrence(userId, {
    accountId,
    calendarId,
    eventId,
  }).catch((err: unknown) => {
    console.error("[Calendar] search mirror delete write-through failed:", routeError(err).message);
  });
}

router.get("/range", async (req, res) => {
  const range = validateCalendarRange(req, res);
  if (!range) return undefined;
  const { startDate, endDate } = range;

  try {
    const userId = calendarUserId();
    const { accounts } = await loadUserConfig(userId);
    const calendarAccounts = accounts.filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );

    const { dayStart } = pacificDayBoundaries(startDate);
    const { dayEnd } = pacificDayBoundaries(endDate);

    const events = await fetchCalendar(calendarAccounts as unknown as StoredCalendarAccount[], {
      startDate: dayStart,
      endDate: dayEnd,
    });
    const hydratedEvents = await hydrateCalendarEventsWithReminderState(userId, events);

    res.json({ events: hydratedEvents, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Calendar] range fetch failed:", routeError(err).message);
    res.status(500).json({ message: "Failed to fetch calendar range" });
  }
});

router.get("/deadlines/range", async (req, res) => {
  const range = validateCalendarRange(req, res, { enforceHistoryWindow: true });
  if (!range) return undefined;

  try {
    const userId = calendarUserId();
    const { payload, errors } = await readCalendarDeadlineRange(userId, range);

    res.json({
      ...payload,
      minDate: range.minDate,
      errors,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Calendar] deadlines range fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar deadlines range" });
  }
  return undefined;
});

router.get("/bills/range", async (req, res) => {
  const range = validateCalendarRange(req, res, { enforceHistoryWindow: true });
  if (!range) return undefined;

  try {
    const userId = calendarUserId();
    res.json({
      ...await readCalendarBillsRange(userId, range),
      minDate: range.minDate,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Calendar] bills range fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar bills range" });
  }
  return undefined;
});

router.get("/calendars", async (_req, res) => {
  try {
    const userId = calendarUserId();
    const { accounts } = await loadUserConfig(userId);
    const calendarAccounts = accounts.filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );
    const groups = await getCalendarSourceGroups(calendarAccounts as unknown as StoredCalendarAccount[]);
    res.json({ accounts: groups });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to fetch calendar sources");
  }
});

router.get("/places/suggest", placesLimiter, async (req, res) => {
  const query = String(req.query.q || "").trim();
  const sessionToken = String(req.query.sessionToken || "").trim();
  if (!query) {
    return res.status(400).json({
      code: "calendar_places_query_required",
      message: "q parameter required",
    });
  }

  try {
    const userId = calendarUserId();
    const { settings } = await loadUserConfig(userId);
    const places = await suggestGooglePlaces(query, {
      sessionToken: sessionToken || undefined,
      lat: typeof settings?.weather_lat === "number" ? settings.weather_lat : undefined,
      lng: typeof settings?.weather_lng === "number" ? settings.weather_lng : undefined,
    });
    res.json({ places });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to fetch place suggestions");
  }
});

router.get("/places/:placeId", placesLimiter, async (req, res) => {
  const { placeId } = req.params;
  const sessionToken = String(req.query.sessionToken || "").trim();

  try {
    const place = await getGooglePlaceDetails(placeId, {
      sessionToken: sessionToken || undefined,
    });
    res.json({ place });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to load place details");
  }
});

router.post("/events", async (req, res) => {
  const {
    accountId,
    calendarId,
    title,
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    location,
    description,
    colorId,
    recurrence,
  } = req.body || {};
  try {
    const account = await loadCalendarAccount(accountId);
    const event = await createCalendarEvent(account, {
      accountId,
      calendarId,
      title,
      allDay,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      description,
      colorId,
      recurrence,
    });
    scheduleCalendarMirrorUpsert(calendarUserId(), event);
    res.status(201).json({ event });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to create calendar event");
  }
});

router.post("/events/batch", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({
      code: "calendar_batch_required",
      message: "items[] is required.",
    });
  }

  try {
    const created = [];
    const failed = [];
    const { accounts } = await loadUserConfig(calendarUserId());

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      try {
        const account = resolveCalendarAccount(accounts, item.accountId);
        const event = await createCalendarEvent(account, item);
        scheduleCalendarMirrorUpsert(calendarUserId(), event);
        created.push({ index, event });
      } catch (err) {
        const error = routeError(err);
        failed.push({
          index,
          input: item,
          code: error?.code || "calendar_batch_item_failed",
          message: error?.message || "Failed to create event.",
        });
      }
    }

    res.status(created.length ? 201 : 207).json({
      created,
      failed,
    });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to create calendar events");
  }
});

router.patch("/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const {
    accountId,
    sourceAccountId,
    calendarId,
    sourceCalendarId,
    etag,
    title,
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    location,
    description,
    colorId,
    recurrence,
    scope,
    recurringEventId,
    originalStartTime,
  } = req.body || {};
  try {
    if (sourceAccountId && sourceAccountId !== accountId) {
      return res.status(400).json({
        code: "calendar_cross_account_move_unsupported",
        message: "Move events between calendars on the same Google account.",
      });
    }
    const account = await loadCalendarAccount(accountId);
    const event = await updateCalendarEvent(account, eventId, {
      calendarId,
      sourceCalendarId,
      etag,
      title,
      allDay,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      description,
      colorId,
      recurrence,
      scope,
      recurringEventId,
      originalStartTime,
    });
    if (sourceCalendarId && sourceCalendarId !== calendarId && !isRecurringCalendarMirrorWrite(event, { scope, recurringEventId, originalStartTime })) {
      scheduleCalendarMirrorDelete(calendarUserId(), {
        accountId,
        calendarId: sourceCalendarId,
        eventId,
      });
    }
    scheduleCalendarMirrorUpsert(calendarUserId(), event);
    const anchorAt = calendarEventAnchorAt(event);
    if (anchorAt) {
      // Reminder bookkeeping runs AFTER Google has already applied the update.
      // A failure here must not 500 the route — that would make the client revert
      // an edit Google has kept (the inverse ghost). A stale/unsent reminder is
      // benign next to a diverged UI, so log and still return the updated event.
      try {
        await recomputeUnsentRemindersForSource({
          userId: calendarUserId(),
          sourceType: "calendar_event",
          sourceItemId: eventId,
          sourceOccurrenceId: eventOccurrenceIdentity({ event, originalStartTime, scope }),
          anchorKind: "event_start",
          anchorAt,
        });
      } catch (err) {
        console.error("[Calendar] reminder recompute after event update failed:", routeError(err).message);
      }
    }
    res.json({ event });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to update calendar event");
  }
});

router.delete("/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const { accountId, calendarId, etag, scope, recurringEventId, originalStartTime } = req.body || {};
  try {
    const account = await loadCalendarAccount(accountId);
    await deleteCalendarEvent(account, eventId, {
      calendarId,
      etag,
      scope,
      recurringEventId,
      originalStartTime,
    });
    scheduleCalendarMirrorDelete(calendarUserId(), {
      accountId,
      calendarId,
      eventId,
      scope,
      recurringEventId,
      originalStartTime,
    });
    // Google has already deleted the event; reminder cleanup is post-success
    // bookkeeping. Never fail the response on it — a 500 here would revert a
    // deletion Google has applied (the inverse ghost). Log and still return ok.
    try {
      await deleteSourceReminders({
        userId: calendarUserId(),
        sourceType: "calendar_event",
        sourceItemId: eventId,
        sourceOccurrenceId: eventOccurrenceIdentity({
          event: { isRecurring: !!(recurringEventId || originalStartTime), originalStartTime },
          originalStartTime,
          scope,
        }),
      });
    } catch (err) {
      console.error("[Calendar] reminder cleanup after event delete failed:", routeError(err).message);
    }
    res.json({ ok: true });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to delete calendar event");
  }
});

export default router;
