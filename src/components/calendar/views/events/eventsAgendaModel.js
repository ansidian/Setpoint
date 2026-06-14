import { getEventSelectionId } from "../../../../lib/shell-helpers";
import {
  addDaysYmd,
  pacificYMD,
  ymdFromParts,
} from "../../calendarDateUtils.js";
import { visualEventDateRange } from "../../modal/calendarEventSpanLayout.js";
import { sameEventList } from "../../modal/calendarMonthPreviewModel.js";
import {
  buildDisplayedMonthGroups,
  clampRangeToMonth,
  formatAgendaHeaderLabel,
  monthBounds,
  sparseVisibleGroups,
} from "../agenda/agendaDateModel.js";
import {
  deadlinePlanningAccent,
  deadlinePlanningStatusIcon,
  deadlinePlanningSubtitle,
  deadlinePlanningTimeLabel,
  deadlinePlanningTitle,
  getDeadlineOverlayComputed,
  getPlanningItemId,
} from "./eventsPlanningModel.js";
import { normalizeStatus, statusLabel } from "../deadlines/deadlinesModel.js";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export function formatAgendaEventTitle(value) {
  return String(value || "").trim() || "(No title)";
}

export function resolveAgendaSourceColor(event) {
  return event?.color || event?.sourceColor || "#89b4fa";
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return "";
  return DATE_TIME_FORMATTER.format(new Date(ms)).replace(/\s/g, " ");
}

export function formatAgendaTimeRange(event) {
  if (event?.allDay) return "All day";
  const start = formatTime(event?.startMs);
  const end = formatTime(event?.endMs);
  if (start && end && start !== end) return `${start}-${end}`;
  return start || end || "";
}

function orderedEvents(events) {
  return [...events].sort((a, b) => {
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    if ((a.startMs || 0) !== (b.startMs || 0)) return (a.startMs || 0) - (b.startMs || 0);
    if ((a.endMs || 0) !== (b.endMs || 0)) return (a.endMs || 0) - (b.endMs || 0);
    return formatAgendaEventTitle(a.title).localeCompare(formatAgendaEventTitle(b.title));
  });
}

function weatherByDate(weatherData) {
  const map = new Map();
  for (const day of weatherData?.dailyForecast || []) {
    if (!day?.dateKey) continue;
    map.set(day.dateKey, {
      dateKey: day.dateKey,
      high: day.high,
      low: day.low,
      icon: day.icon,
      summary: day.summary || "",
    });
  }
  return map;
}

function normalizeCurrentWeather(weatherData, todayKey) {
  if (!weatherData || !todayKey) return null;
  if (weatherData.temp == null && weatherData.high == null && weatherData.low == null && !weatherData.icon) return null;
  return {
    dateKey: todayKey,
    high: weatherData.high ?? weatherData.temp ?? null,
    low: weatherData.low ?? weatherData.temp ?? null,
    icon: weatherData.icon,
    summary: weatherData.summary || "",
  };
}

function miniCalendarBounds(viewYear, viewMonth) {
  const monthStart = ymdFromParts(viewYear, viewMonth, 1);
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const startDate = addDaysYmd(monthStart, -firstDay);
  return {
    startDate,
    endDate: addDaysYmd(startDate, 41),
  };
}

function rangeOverlaps(range, bounds) {
  return !!range && range.startDate <= bounds.endDate && range.endDate >= bounds.startDate;
}

export function buildEventsAgendaGroups({
  events = [],
  deadlineOverlay = null,
  viewYear,
  viewMonth,
  weatherData = null,
  todayKey = pacificYMD(Date.now()),
  forceVisibleDateKey = null,
} = {}) {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups({
    viewYear,
    viewMonth,
    todayKey,
    createGroup: () => ({
      allDay: [],
      timed: [],
      deadlines: [],
      weather: null,
      hasEvents: false,
      hasDeadlines: false,
    }),
  });

  for (const event of events || []) {
    if (!event?.startMs) continue;
    const range = clampRangeToMonth(visualEventDateRange(event), viewYear, viewMonth);
    if (!range) continue;
    let cursor = range.startDate;
    while (cursor <= range.endDate) {
      const group = groupMap.get(cursor);
      if (group) {
        const agendaEvent = {
          ...event,
          agendaDateKey: cursor,
          agendaItemId: getEventSelectionId(event),
          agendaTitle: formatAgendaEventTitle(event.title),
          agendaTimeRange: formatAgendaTimeRange(event),
          agendaSourceColor: resolveAgendaSourceColor(event),
        };
        if (event.allDay) group.allDay.push(agendaEvent);
        else group.timed.push(agendaEvent);
        group.hasEvents = true;
      }
      cursor = addDaysYmd(cursor, 1);
    }
  }

  const deadlineOverlayComputed = getDeadlineOverlayComputed({
    deadlineData: deadlineOverlay?.data,
    viewYear,
    viewMonth,
    showCompleted: !!deadlineOverlay?.showCompleted,
  });
  for (const [dateKey, deadlines] of Object.entries(deadlineOverlayComputed?.itemsByDate || {})) {
    const group = groupMap.get(dateKey);
    if (!group) continue;
    group.deadlines = deadlines.map((task) => ({
      ...task,
      agendaDateKey: dateKey,
      agendaItemId: getPlanningItemId(task),
      agendaTitle: deadlinePlanningTitle(task),
      agendaSubtitle: deadlinePlanningSubtitle(task),
      agendaTimeRange: deadlinePlanningTimeLabel(task),
      agendaSourceColor: deadlinePlanningAccent(task),
      agendaItemKind: "deadline",
      agendaComplete: normalizeStatus(task.status) === "complete",
      agendaStatus: statusLabel(task.status),
      agendaStatusIcon: deadlinePlanningStatusIcon(normalizeStatus(task.status)),
    }));
    group.hasDeadlines = group.deadlines.length > 0;
    group.hasEvents = group.hasEvents || group.hasDeadlines;
  }

  const weatherMap = weatherByDate(weatherData);
  const currentWeather = normalizeCurrentWeather(weatherData, todayKey);
  if (currentWeather) weatherMap.set(todayKey, { ...(weatherMap.get(todayKey) || {}), ...currentWeather });
  for (const group of groups) {
    group.allDay = orderedEvents(group.allDay);
    group.timed = orderedEvents(group.timed);
    group.weather = weatherMap.get(group.dateKey) || null;
  }

  const { visibleGroups, firstVisibleDateKey } = sparseVisibleGroups({
    groups,
    monthStartDateKey,
    forceVisibleDateKey,
    hasVisibleItems: (group) => group.hasEvents || group.hasDeadlines || (group.weather && group.dateKey >= todayKey),
  });

  return {
    groups,
    visibleGroups,
    firstVisibleDateKey,
    monthStartDateKey,
  };
}

export function buildEventsMiniCalendarActivityItems({
  events = [],
  deadlineOverlay = null,
  viewYear,
  viewMonth,
} = {}) {
  const bounds = miniCalendarBounds(viewYear, viewMonth);
  const eventItems = (events || [])
    .filter((event) => event?.startMs && rangeOverlaps(visualEventDateRange(event), bounds))
    .map((event) => ({ ...event, kind: "event" }));
  const deadlineOverlayComputed = getDeadlineOverlayComputed({
    deadlineData: deadlineOverlay?.data,
    viewYear,
    viewMonth,
    showCompleted: !!deadlineOverlay?.showCompleted,
  });
  const deadlineItems = Object.entries(deadlineOverlayComputed?.itemsByDate || {})
    .filter(([dateKey]) => dateKey >= bounds.startDate && dateKey <= bounds.endDate)
    .flatMap(([dateKey, deadlines]) => deadlines.map((task) => ({
      ...task,
      kind: "deadline",
      dateKey,
      agendaDateKey: dateKey,
      agendaItemId: getPlanningItemId(task),
      agendaSourceColor: deadlinePlanningAccent(task),
    })));

  return [...eventItems, ...deadlineItems];
}

export function buildMultiMonthAgendaGroups({
  months = [],
  events = [],
  deadlineOverlay = null,
  weatherData = null,
  todayKey = pacificYMD(Date.now()),
  forceVisibleDateKey = null,
} = {}) {
  return months.map(({ year, month }) => {
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    const forceKey = forceVisibleDateKey?.startsWith(mk) ? forceVisibleDateKey : null;
    const result = buildEventsAgendaGroups({
      events,
      deadlineOverlay,
      viewYear: year,
      viewMonth: month,
      weatherData,
      todayKey,
      forceVisibleDateKey: forceKey,
    });
    return {
      monthKey: mk,
      year,
      month,
      ...result,
    };
  });
}

// Per-month variant of buildMultiMonthAgendaGroups: each month's groups are
// built from that month's cache bucket (getMonthEvents) and the previous
// value is reused by identity when the month's inputs are unchanged, so a
// batch landing mid-scroll rebuilds only the months it actually touched.
// Returns { list, cache }; callers thread `cache` back in as `previous`.
export function reuseMultiMonthAgendaGroups({
  previous = null,
  months = [],
  getMonthEvents,
  deadlineOverlay = null,
  weatherData = null,
  todayKey = pacificYMD(Date.now()),
  forceVisibleDateKey = null,
} = {}) {
  const cache = new Map();
  const list = months.map(({ year, month }) => {
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthEvents = getMonthEvents ? getMonthEvents(year, month) || [] : [];
    const forceKey = forceVisibleDateKey?.startsWith(mk) ? forceVisibleDateKey : null;
    const prior = previous?.get(mk);
    if (
      prior
      && sameEventList(prior.inputs.monthEvents, monthEvents)
      && prior.inputs.deadlineOverlay === deadlineOverlay
      && prior.inputs.weatherData === weatherData
      && prior.inputs.todayKey === todayKey
      && prior.inputs.forceKey === forceKey
    ) {
      cache.set(mk, prior);
      return prior.value;
    }
    const value = {
      monthKey: mk,
      year,
      month,
      ...buildEventsAgendaGroups({
        events: monthEvents,
        deadlineOverlay,
        viewYear: year,
        viewMonth: month,
        weatherData,
        todayKey,
        forceVisibleDateKey: forceKey,
      }),
    };
    cache.set(mk, {
      inputs: { monthEvents, deadlineOverlay, weatherData, todayKey, forceKey },
      value,
    });
    return value;
  });
  return { list, cache };
}

// True when the currently-selected agenda item is an all-day chip that the rail
// truncates out of view (beyond `visibleCount`). Lets the rail auto-expand the
// day so a selected hidden chip still renders, registers its row ref, and can be
// highlighted/scrolled to (instead of staying invisible under the "+N" button).
export function agendaHasSelectedHiddenAllDay(group, visibleCount, selectedItemId, selectedDateKey) {
  if (!group || selectedDateKey !== group.dateKey) return false;
  const selected = String(selectedItemId || "");
  if (!selected) return false;
  return (group.allDay || []).slice(visibleCount).some((event) => String(event?.agendaItemId || "") === selected);
}

export { formatAgendaHeaderLabel, monthBounds };
