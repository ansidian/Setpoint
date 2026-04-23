import { Router } from "express";
import db from "../db/connection.js";
import { requireCookieSession } from "../middleware/auth.js";
import { fetchCTMDeadlinesAll } from "../briefing/ctm.js";
import { fetchTodoistTasksAll } from "../briefing/todoist.js";
import {
  loadUserConfig,
  separateDeadlines,
  computeDeadlineStats,
  loadCompletedTaskIds,
  carryForwardCompletedTodoist,
} from "../briefing/index.js";
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
import { hydrateRecurringTombstones, addDaysIso } from "../briefing/tombstones.js";

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

    const [ctmDeadlines, todoistTasks, latestBriefingRow] = await Promise.all([
      fetchCTMDeadlinesAll().catch((err) => {
        console.error("[Calendar] CTM fetch failed:", err.message);
        return [];
      }),
      fetchTodoistTasksAll(userId).catch((err) => {
        console.error("[Calendar] Todoist fetch failed:", err.message);
        return [];
      }),
      db.execute({
        sql: `SELECT briefing_json FROM ea_briefings
              WHERE user_id = ? AND status = 'ready'
              ORDER BY generated_at DESC LIMIT 1`,
        args: [userId],
      }).then((result) => result.rows[0] || null).catch(() => null),
    ]);

    const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
    const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
    const liveTodoistIds = new Set(todoistTasks.map((task) => String(task.id)));
    const tombstones = await hydrateRecurringTombstones(userId, liveTodoistIds, {
      viewBoundary: "yesterday",
    });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const yesterday = addDaysIso(today, -1);
    let prevTodoist = null;
    if (latestBriefingRow) {
      try {
        prevTodoist = JSON.parse(latestBriefingRow.briefing_json)?.todoist?.upcoming;
      } catch {
        prevTodoist = null;
      }
    }
    const todoistWithCarried = carryForwardCompletedTodoist(
      [...separated.todoist, ...tombstones],
      prevTodoist,
      yesterday,
    );

    res.json({
      ctm: {
        upcoming: separated.ctm,
        stats: computeDeadlineStats(separated.ctm),
      },
      todoist: {
        upcoming: todoistWithCarried,
        stats: computeDeadlineStats(todoistWithCarried),
      },
    });
  } catch (err) {
    console.error("[Calendar] deadlines fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch calendar deadlines" });
  }
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 62;

router.get("/range", async (req, res) => {
  const { start, end } = req.query;

  if (!start) return res.status(400).json({ message: "start param required (YYYY-MM-DD)" });
  if (!end) return res.status(400).json({ message: "end param required (YYYY-MM-DD)" });
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
    return res.status(400).json({ message: "start/end must be YYYY-MM-DD" });
  }

  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ message: "invalid date value" });
  }
  if (endDate < startDate) {
    return res.status(400).json({ message: "end must be >= start" });
  }
  const spanDays = Math.round((endDate - startDate) / 86400000);
  if (spanDays > MAX_SPAN_DAYS) {
    return res.status(400).json({ message: `span must be <= ${MAX_SPAN_DAYS} days` });
  }

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
    calendarId,
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
    const account = await loadCalendarAccount(accountId);
    const event = await updateCalendarEvent(account, eventId, {
      calendarId,
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
