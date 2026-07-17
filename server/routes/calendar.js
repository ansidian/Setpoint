import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import { applyDeadlineCurrentStatus } from "../dashboard/current-service.js";
import {
  readCalendarDeadlines,
  readCalendarDeadlineRange,
} from "../tasks/deadlines-read.js";
import * as tasksService from "../tasks/tasks-service.js";
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
} from "../calendar/calendar.js";
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
} from "../calendar/calendar-search-mirror.js";
import { readCalendarBillsRange } from "./calendar-bills-range.js";

const router = Router();
router.use(requireCookieSession);

function handleCalendarRouteError(res, err, fallbackMessage) {
  if (err?.status && err?.code) {
    const formatted = formatCalendarRouteError(err);
    return res.status(formatted.status).json(formatted.body);
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ code: "calendar_route_error", message: fallbackMessage });
}

function resolveCalendarAccount(accounts, accountId) {
  const account = accounts.find(
    (entry) => entry.id === accountId && entry.type === "gmail" && entry.calendar_enabled,
  );
  if (!account) {
    const err = new Error("Calendar account not found");
    err.status = 404;
    err.code = "calendar_account_not_found";
    throw err;
  }
  return account;
}

async function loadCalendarAccount(accountId) {
  const userId = process.env.EA_USER_ID;
  const { accounts } = await loadUserConfig(userId);
  return resolveCalendarAccount(accounts, accountId);
}

router.get("/deadlines", async (_req, res) => {
  try {
    const userId = process.env.EA_USER_ID;
    res.json(await readCalendarDeadlines(userId));
  } catch (err) {
    console.error("[Calendar] deadlines fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar deadlines" });
  }
});

function handleDeadlineMutationError(res, err, fallbackMessage) {
  const status = err?.status || 500;
  if (status >= 500) console.error(fallbackMessage, err);
  return res.status(status).json({ message: err?.message || fallbackMessage });
}

router.post("/deadlines", async (req, res) => {
  try {
    const userId = process.env.EA_USER_ID;
    const deadline = await tasksService.createDeadline(userId, req.body || {});
    res.status(201).json({ deadline });
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to create deadline");
  }
});

router.patch("/deadlines/:deadlineId", async (req, res) => {
  try {
    const userId = process.env.EA_USER_ID;
    const deadline = await tasksService.updateDeadline(userId, req.params.deadlineId, req.body || {});
    res.json({ deadline });
  } catch (err) {
    handleDeadlineMutationError(res, err, "Failed to update deadline");
  }
});

router.delete("/deadlines/:deadlineId", async (req, res) => {
  try {
    const userId = process.env.EA_USER_ID;
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
    const userId = process.env.EA_USER_ID;
    const result = await tasksService.completeDeadlineOccurrence(
      userId,
      req.params.deadlineId,
      req.params.date,
    );
    applyDeadlineCurrentStatus(userId, req.params.deadlineId, "complete").catch((err) => {
      console.error("[Calendar] Failed to update current Todoist deadline cache:", err.message);
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
    return res.json(await searchCalendar(process.env.EA_USER_ID, req.query));
  } catch (err) {
    if (isCalendarSearchInputError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    console.error("[Calendar] search failed:", err);
    return res.status(500).json({ code: "calendar_search_error", message: "Failed to search calendar" });
  }
});

function validateCalendarRange(req, res, { enforceHistoryWindow = false } = {}) {
  const result = validateCalendarRangeQuery(req.query, { enforceHistoryWindow });
  if (result.ok) return result.value;
  res.status(400).json({ message: result.message });
  return null;
}

function eventOccurrenceIdentity({ event, originalStartTime, scope }) {
  if (scope && scope !== "one") return undefined;
  if (originalStartTime) return originalStartTime;
  if (event?.isRecurring) {
    if (event.originalStartTime) return event.originalStartTime;
    return calendarEventAnchorAt(event);
  }
  return undefined;
}

function isRecurringCalendarMirrorWrite(event, { scope, recurringEventId, originalStartTime } = {}) {
  return !!(
    event?.isRecurring
    || event?.recurringEventId
    || event?.recurrence
    || scope
    || recurringEventId
    || originalStartTime
  );
}

function scheduleCalendarMirrorDirty({ userId, accountId, calendarId, reason = "calendar-write" }) {
  markCalendarSearchMirrorDirty(userId, { accountId, calendarId, reason }).catch((err) => {
    console.error("[Calendar] search mirror dirty marking failed:", err.message);
  });
}

function scheduleCalendarMirrorUpsert(userId, event) {
  if (!event?.accountId || !event?.calendarId) return;
  if (isRecurringCalendarMirrorWrite(event)) {
    scheduleCalendarMirrorDirty({
      userId,
      accountId: event.accountId,
      calendarId: event.calendarId,
    });
    return;
  }
  upsertCalendarSearchMirrorOccurrence(userId, event).catch((err) => {
    console.error("[Calendar] search mirror write-through failed:", err.message);
  });
}

function scheduleCalendarMirrorDelete(userId, {
  accountId,
  calendarId,
  eventId,
  scope,
  recurringEventId,
  originalStartTime,
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
  }).catch((err) => {
    console.error("[Calendar] search mirror delete write-through failed:", err.message);
  });
}

router.get("/range", async (req, res) => {
  const range = validateCalendarRange(req, res);
  if (!range) return undefined;
  const { startDate, endDate } = range;

  try {
    const userId = process.env.EA_USER_ID;
    const { accounts } = await loadUserConfig(userId);
    const calendarAccounts = accounts.filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );

    const { dayStart } = pacificDayBoundaries(startDate);
    const { dayEnd } = pacificDayBoundaries(endDate);

    const events = await fetchCalendar(calendarAccounts, {
      startDate: dayStart,
      endDate: dayEnd,
    });
    const hydratedEvents = await hydrateCalendarEventsWithReminderState(userId, events);

    res.json({ events: hydratedEvents, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Calendar] range fetch failed:", err.message);
    res.status(500).json({ message: "Failed to fetch calendar range" });
  }
});

router.get("/deadlines/range", async (req, res) => {
  const range = validateCalendarRange(req, res, { enforceHistoryWindow: true });
  if (!range) return undefined;

  try {
    const userId = process.env.EA_USER_ID;
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
    const userId = process.env.EA_USER_ID;
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
    const userId = process.env.EA_USER_ID;
    const { accounts } = await loadUserConfig(userId);
    const calendarAccounts = accounts.filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );
    const groups = await getCalendarSourceGroups(calendarAccounts);
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
    const userId = process.env.EA_USER_ID;
    const { settings = {} } = await loadUserConfig(userId);
    const places = await suggestGooglePlaces(query, {
      sessionToken: sessionToken || null,
      lat: settings.weather_lat,
      lng: settings.weather_lng,
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
      sessionToken: sessionToken || null,
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
    scheduleCalendarMirrorUpsert(process.env.EA_USER_ID, event);
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
    const { accounts } = await loadUserConfig(process.env.EA_USER_ID);

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      try {
        const account = resolveCalendarAccount(accounts, item.accountId);
        const event = await createCalendarEvent(account, item);
        scheduleCalendarMirrorUpsert(process.env.EA_USER_ID, event);
        created.push({ index, event });
      } catch (err) {
        failed.push({
          index,
          input: item,
          code: err?.code || "calendar_batch_item_failed",
          message: err?.message || "Failed to create event.",
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
      scheduleCalendarMirrorDelete(process.env.EA_USER_ID, {
        accountId,
        calendarId: sourceCalendarId,
        eventId,
      });
    }
    scheduleCalendarMirrorUpsert(process.env.EA_USER_ID, event);
    const anchorAt = calendarEventAnchorAt(event);
    if (anchorAt) {
      // Reminder bookkeeping runs AFTER Google has already applied the update.
      // A failure here must not 500 the route — that would make the client revert
      // an edit Google has kept (the inverse ghost). A stale/unsent reminder is
      // benign next to a diverged UI, so log and still return the updated event.
      try {
        await recomputeUnsentRemindersForSource({
          userId: process.env.EA_USER_ID,
          sourceType: "calendar_event",
          sourceItemId: eventId,
          sourceOccurrenceId: eventOccurrenceIdentity({ event, originalStartTime, scope }),
          anchorKind: "event_start",
          anchorAt,
        });
      } catch (err) {
        console.error("[Calendar] reminder recompute after event update failed:", err.message);
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
    scheduleCalendarMirrorDelete(process.env.EA_USER_ID, {
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
        userId: process.env.EA_USER_ID,
        sourceType: "calendar_event",
        sourceItemId: eventId,
        sourceOccurrenceId: eventOccurrenceIdentity({
          event: { isRecurring: !!(recurringEventId || originalStartTime), originalStartTime },
          originalStartTime,
          scope,
        }),
      });
    } catch (err) {
      console.error("[Calendar] reminder cleanup after event delete failed:", err.message);
    }
    res.json({ ok: true });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to delete calendar event");
  }
});

export default router;
