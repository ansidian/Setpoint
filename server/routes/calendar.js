import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import { fetchCTMDeadlinesAll, fetchCTMDeadlinesRange } from "../briefing/ctm.js";
import { fetchTodoistTasksAll, fetchTodoistTasksRange, getTodoistSyncHealth } from "../briefing/todoist.js";
import { getCalendarBillsRange } from "../briefing/actual.js";
import {
  loadCompletedTaskIds,
  separateDeadlines,
  computeDeadlineStats,
} from "../briefing/deadline-helpers.js";
import { loadUserConfig } from "../briefing/config-service.js";
import {
  fetchCalendar,
  pacificDayBoundaries,
  getCalendarSourceGroups,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  formatCalendarRouteError,
} from "../briefing/calendar.js";
import {
  getGooglePlaceDetails,
  suggestGooglePlaces,
} from "../briefing/google-places.js";
import { hydrateRecurringTombstones } from "../briefing/tombstones.js";

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

function unavailableTodoistHealth(err) {
  return {
    state: "unavailable",
    configured: null,
    lastSuccessAt: null,
    lastError: err?.message || "Todoist sync health unavailable",
    syncStartedAt: null,
    ageMs: null,
  };
}

router.get("/deadlines", async (_req, res) => {
  try {
    const userId = process.env.EA_USER_ID;

    const [ctmDeadlines, todoistTasks, todoistSyncHealth] = await Promise.all([
      fetchCTMDeadlinesAll().catch((err) => {
        console.error("[Calendar] CTM fetch failed:", err.message);
        return [];
      }),
      fetchTodoistTasksAll(userId).catch((err) => {
        console.error("[Calendar] Todoist fetch failed:", err.message);
        return [];
      }),
      getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err)),
    ]);

    const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
    const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
    const tombstones = await hydrateRecurringTombstones(userId, null, {
      viewBoundary: "yesterday",
    });

    const todoistWithCompleted = [...separated.todoist, ...tombstones];

    res.json({
      ctm: {
        upcoming: separated.ctm,
        stats: computeDeadlineStats(separated.ctm),
      },
      todoist: {
        upcoming: todoistWithCompleted,
        stats: computeDeadlineStats(todoistWithCompleted),
        syncHealth: todoistSyncHealth,
      },
    });
  } catch (err) {
    console.error("[Calendar] deadlines fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar deadlines" });
  }
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 62;

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, d));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

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

function quietSourceError(source, err) {
  return { source, message: err?.message || `${source} unavailable` };
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

    res.json({ events, fetchedAt: new Date().toISOString() });
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
    const errors = [];
    const [ctmResult, todoistResult, todoistHealthResult] = await Promise.allSettled([
      fetchCTMDeadlinesRange({ start: range.start, end: range.end }),
      fetchTodoistTasksRange(userId, { start: range.start, end: range.end }),
      getTodoistSyncHealth(userId),
    ]);
    const ctmDeadlines = ctmResult.status === "fulfilled" ? ctmResult.value : [];
    const todoistTasks = todoistResult.status === "fulfilled" ? todoistResult.value : [];
    const todoistSyncHealth = todoistHealthResult.status === "fulfilled"
      ? todoistHealthResult.value
      : unavailableTodoistHealth(todoistHealthResult.reason);
    if (ctmResult.status === "rejected") errors.push(quietSourceError("ctm", ctmResult.reason));
    if (todoistResult.status === "rejected") errors.push(quietSourceError("todoist", todoistResult.reason));

    const tombstones = await hydrateRecurringTombstones(userId, null, {
      viewBoundary: "yesterday",
    }).catch((err) => {
      errors.push(quietSourceError("todoist", err));
      return [];
    });
    const rangeTombstones = tombstones.filter((task) =>
      task.due_date && task.due_date >= range.start && task.due_date <= range.end,
    );
    const separated = separateDeadlines(ctmDeadlines, [...todoistTasks, ...rangeTombstones], new Set());

    res.json({
      ctm: {
        upcoming: separated.ctm,
        stats: computeDeadlineStats(separated.ctm),
      },
      todoist: {
        upcoming: separated.todoist,
        stats: computeDeadlineStats(separated.todoist),
        syncHealth: todoistSyncHealth,
      },
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
    const data = await getCalendarBillsRange(userId, { start: range.start, end: range.end })
      .catch((err) => {
        errors.push(quietSourceError("actual", err));
        return { schedules: [], recentTransactions: [], payeeMap: {}, actualBudgetUrl: null };
      });

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
      recurrence,
    });
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
      recurrence,
      scope,
      recurringEventId,
      originalStartTime,
    });
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
    res.json({ ok: true });
  } catch (err) {
    handleCalendarRouteError(res, err, "Failed to delete calendar event");
  }
});

export default router;
