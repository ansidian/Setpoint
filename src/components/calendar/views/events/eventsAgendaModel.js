import { getEventSelectionId } from "../../../../lib/redesign-helpers";
import {
  addDaysYmd,
  pacificYMD,
} from "../../calendarDateUtils.js";
import { visualEventDateRange } from "../../modal/calendarEventSpanLayout.js";
import {
  buildDisplayedMonthGroups,
  clampRangeToMonth,
  formatAgendaHeaderLabel,
  monthBounds,
  sparseVisibleGroups,
} from "../agenda/agendaDateModel.js";
import {
  deadlinePlanningAccent,
  deadlinePlanningSubtitle,
  deadlinePlanningTimeLabel,
  deadlinePlanningTitle,
  getDeadlineOverlayComputed,
  getPlanningItemId,
} from "./eventsPlanningModel.js";

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
      agendaComplete: task.status === "complete",
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

export { formatAgendaHeaderLabel, monthBounds };
