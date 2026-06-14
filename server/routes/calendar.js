import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import {
  billMirrorRefreshRange,
  isBillsMirrorMaintenanceDue,
  readBillsMirrorRange,
  scheduleBillsMirrorRefresh,
  shouldScheduleImmediateBillsRefresh,
} from "../bills/bills-service.js";
import {
  applyDeadlineCurrentStatus,
  requestBillsCurrentMaintenanceRefresh,
} from "../dashboard/current-service.js";
import {
  readCalendarDeadlines,
  readCalendarDeadlineRange,
} from "../tasks/deadlines-read.js";
import * as tasksService from "../tasks/tasks-service.js";
import { loadUserConfig } from "../platform/config-service.js";
import {
  fetchCalendar,
  pacificDayBoundaries,
  getCalendarSourceGroups,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  formatCalendarRouteError,
} from "../calendar/calendar.js";
import {
  getGooglePlaceDetails,
  suggestGooglePlaces,
} from "../platform/google-places.js";
import {
  deleteSourceReminders,
  recomputeUnsentRemindersForSource,
} from "../reminders/reminder-service.js";
import {
  calendarEventAnchorAt,
  hydrateCalendarEventsWithReminderState,
} from "../reminders/reminder-hydration.js";
import {
  deadlineSearchCandidates,
  normalizeBillSearchCandidate,
  normalizeEventSearchCandidate,
  normalizeLimit,
  rankCalendarSearchCandidates,
} from "../calendar/calendar-search.js";
import {
  deleteCalendarSearchMirrorOccurrence,
  getCalendarSearchMirrorHealth,
  listCalendarSearchMirrorOccurrences,
  markCalendarSearchMirrorDirty,
  requestCalendarSearchMirrorSync,
  upsertCalendarSearchMirrorOccurrence,
} from "../calendar/calendar-search-mirror.js";

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

async function loadCalendarAccount(accountId) {
  const userId = process.env.EA_USER_ID;
  const { accounts } = await loadUserConfig(userId);
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
const MAX_SPAN_DAYS = 62;
const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_HISTORY_MONTHS = 12;
const SEARCH_FUTURE_MONTHS = 18;
const SEARCH_MIRROR_CANDIDATE_LIMIT = 1000;

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, d));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

function calendarSearchRange({ now = new Date() } = {}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
  return {
    start: addMonthsIso(today, -SEARCH_HISTORY_MONTHS),
    end: addMonthsIso(today, SEARCH_FUTURE_MONTHS),
  };
}

function calendarSearchResponse({
  query,
  scope,
  limit,
  candidates,
  coverageSources,
}) {
  const ranked = rankCalendarSearchCandidates(candidates, { query, limit });
  return {
    query,
    scope,
    limit,
    results: ranked.results,
    resultCount: ranked.results.length,
    totalMatches: ranked.totalMatches,
    truncated: ranked.truncated,
    coverage: {
      scope,
      sources: coverageSources,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function shouldRequestCalendarSearchMirrorRepair(syncHealth) {
  return ["initializing", "stale", "degraded", "dirty", "unavailable", "needs_sync"].includes(syncHealth?.state);
}

function calendarSearchMirrorSearched(syncHealth, events) {
  if (events?.length) return true;
  return !["initializing", "unavailable"].includes(syncHealth?.state);
}

function requestCalendarSearchMirrorRepair(userId, syncHealth) {
  if (!shouldRequestCalendarSearchMirrorRepair(syncHealth)) return;
  const hasSuccessfulSource = (syncHealth?.sources || []).some((source) => source.lastSuccessAt);
  requestCalendarSearchMirrorSync(userId, {
    reason: `calendar-search-${syncHealth.state}`,
    forceFull: !hasSuccessfulSource,
  });
}

function cheapEmptyCalendarSearchResponse({ query, scope, limit, reason = "query_too_short" }) {
  return {
    query,
    scope,
    limit,
    results: [],
    resultCount: 0,
    totalMatches: 0,
    truncated: false,
    coverage: {
      scope,
      reason,
      sources: [],
    },
    fetchedAt: new Date().toISOString(),
  };
}

router.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const scope = String(req.query.scope || "events").trim();
  const limit = normalizeLimit(req.query.limit);

  if (scope !== "events" && scope !== "bills") {
    return res.status(400).json({
      code: "calendar_search_scope_invalid",
      message: "scope must be events or bills",
    });
  }
  if (limit === null) {
    return res.status(400).json({
      code: "calendar_search_limit_invalid",
      message: "limit must be a positive integer",
    });
  }
  if (query.length < SEARCH_MIN_QUERY_LENGTH) {
    return res.json(cheapEmptyCalendarSearchResponse({ query, scope, limit }));
  }

  try {
    const userId = process.env.EA_USER_ID;
    if (scope === "events") {
      const range = calendarSearchRange();
      const candidateLimit = Math.max(limit, SEARCH_MIRROR_CANDIDATE_LIMIT);
      const [events, syncHealth, deadlineResult] = await Promise.all([
        listCalendarSearchMirrorOccurrences(userId, {
          start: range.start,
          end: range.end,
          query,
          limit: candidateLimit,
          centerDate: todayPacific(),
        }),
        getCalendarSearchMirrorHealth(userId),
        readCalendarDeadlineRange(userId, range),
      ]);
      requestCalendarSearchMirrorRepair(userId, syncHealth);
      const candidates = [
        ...events.map((event) => normalizeEventSearchCandidate(event)),
        ...deadlineSearchCandidates(deadlineResult.payload),
      ];
      return res.json(calendarSearchResponse({
        query,
        scope,
        limit,
        candidates,
        coverageSources: [
          {
            key: "google_calendar",
            label: "Google Calendar",
            searched: calendarSearchMirrorSearched(syncHealth, events),
            start: range.start,
            end: range.end,
            strategy: "local_mirror",
            syncHealth,
          },
          {
            key: "deadlines",
            label: "Deadline overlays",
            searched: true,
            start: range.start,
            end: range.end,
            errors: deadlineResult.errors || [],
          },
        ],
      }));
    }

    const range = billMirrorRefreshRange({ now: new Date() });
    const data = await readBillsMirrorRange(userId, range);
    if (data.syncHealth?.state === "needs_sync") {
      // Skip the reschedule when a future settle window is already armed, or the
      // 2s poll collapses the 60s post-write settle to now (P1-5).
      if (shouldScheduleImmediateBillsRefresh(data.syncHealth)) {
        scheduleBillsMirrorRefresh(userId).catch((err) => {
          console.error("[Calendar] bills mirror refresh scheduling failed:", err.message);
        });
      }
    } else if (isBillsMirrorMaintenanceDue(data.syncHealth)) {
      requestBillsCurrentMaintenanceRefresh(userId, { now: new Date() }).catch((err) => {
        console.error("[Calendar] bills mirror maintenance refresh scheduling failed:", err.message);
      });
    }

    return res.json(calendarSearchResponse({
      query,
      scope,
      limit,
      candidates: (data.schedules || []).map(normalizeBillSearchCandidate),
      coverageSources: [
        {
          key: "bills_mirror",
          label: "Bills mirror",
          searched: true,
          start: range.start,
          end: range.end,
          syncHealth: data.syncHealth || null,
          actualBudgetUrl: data.actualBudgetUrl || null,
          strategy: "local_mirror",
        },
      ],
    }));
  } catch (err) {
    console.error("[Calendar] search failed:", err);
    return res.status(500).json({ code: "calendar_search_error", message: "Failed to search calendar" });
  }
});

function validateCalendarRange(req, res, { enforceHistoryWindow = false } = {}) {
  const { start, end } = req.query;

  if (!start) {
    res.status(400).json({ message: "start param required (YYYY-MM-DD)" });
    return null;
  }
  if (!end) {
    res.status(400).json({ message: "end param required (YYYY-MM-DD)" });
    return null;
  }
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
    res.status(400).json({ message: "start/end must be YYYY-MM-DD" });
    return null;
  }

  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    res.status(400).json({ message: "invalid date value" });
    return null;
  }
  if (endDate < startDate) {
    res.status(400).json({ message: "end must be >= start" });
    return null;
  }
  const spanDays = Math.round((endDate - startDate) / 86400000);
  if (spanDays > MAX_SPAN_DAYS) {
    res.status(400).json({ message: `span must be <= ${MAX_SPAN_DAYS} days` });
    return null;
  }
  if (enforceHistoryWindow) {
    const minDate = addMonthsIso(todayPacific(), -12);
    if (end < minDate) {
      res.status(400).json({ message: "range must overlap the rolling 12-month calendar window" });
      return null;
    }
    return { start, end, startDate, endDate, minDate };
  }

  return { start, end, startDate, endDate };
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
    const errors = [];
    const data = await readBillsMirrorRange(userId, { start: range.start, end: range.end });
    if (data.syncHealth?.state === "needs_sync") {
      // Skip the reschedule when a future settle window is already armed, or the
      // 2s poll collapses the 60s post-write settle to now (P1-5).
      if (shouldScheduleImmediateBillsRefresh(data.syncHealth)) {
        scheduleBillsMirrorRefresh(userId).catch((err) => {
          console.error("[Calendar] bills mirror refresh scheduling failed:", err.message);
        });
      }
    } else if (isBillsMirrorMaintenanceDue(data.syncHealth)) {
      requestBillsCurrentMaintenanceRefresh(userId, { now: new Date() }).catch((err) => {
        console.error("[Calendar] bills mirror maintenance refresh scheduling failed:", err.message);
      });
    }

    res.json({
      ...data,
      minDate: range.minDate,
      errors,
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

router.get("/places/suggest", async (req, res) => {
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

router.get("/places/:placeId", async (req, res) => {
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

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      try {
        const account = await loadCalendarAccount(item.accountId);
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
      await recomputeUnsentRemindersForSource({
        userId: process.env.EA_USER_ID,
        sourceType: "calendar_event",
        sourceItemId: eventId,
        sourceOccurrenceId: eventOccurrenceIdentity({ event, originalStartTime, scope }),
        anchorKind: "event_start",
        anchorAt,
      });
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
    res.json({ ok: true });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to delete calendar event");
  }
});

export default router;
