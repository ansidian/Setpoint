import { getEventSelectionId } from "../../../../lib/redesign-helpers";
import {
  addDaysYmd,
  pacificYMD,
  parseYmd,
  ymdFromParts,
} from "../../calendarDateUtils.js";
import { visualEventDateRange } from "../../modal/calendarEventSpanLayout.js";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

function localDate(parsed) {
  return new Date(parsed.year, parsed.month, parsed.day);
}

function shortDateLabel(dateKey) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return "";
  const year = String(parsed.year).slice(-2);
  return `${parsed.month + 1}/${parsed.day}/${year}`;
}

export function formatAgendaHeaderLabel(dateKey, todayKey = pacificYMD(Date.now())) {
  if (dateKey === todayKey) return `TODAY ${shortDateLabel(dateKey)}`;
  if (dateKey === addDaysYmd(todayKey, 1)) return `TOMORROW ${shortDateLabel(dateKey)}`;
  const parsed = parseYmd(dateKey);
  const weekday = parsed ? WEEKDAY_FORMATTER.format(localDate(parsed)).toUpperCase() : "DAY";
  return `${weekday} ${shortDateLabel(dateKey)}`;
}

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

function monthBounds(viewYear, viewMonth) {
  const start = ymdFromParts(viewYear, viewMonth, 1);
  const end = ymdFromParts(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());
  return { start, end };
}

function clampRangeToMonth(range, viewYear, viewMonth) {
  if (!range) return null;
  const { start, end } = monthBounds(viewYear, viewMonth);
  if (range.endDate < start || range.startDate > end) return null;
  return {
    startDate: range.startDate < start ? start : range.startDate,
    endDate: range.endDate > end ? end : range.endDate,
  };
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
  viewYear,
  viewMonth,
  weatherData = null,
  todayKey = pacificYMD(Date.now()),
  forceVisibleDateKey = null,
} = {}) {
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthStartDateKey = ymdFromParts(viewYear, viewMonth, 1);
  const groups = Array.from({ length: daysInMonth }, (_, index) => {
    const dateKey = ymdFromParts(viewYear, viewMonth, index + 1);
    return {
      dateKey,
      day: index + 1,
      headerLabel: formatAgendaHeaderLabel(dateKey, todayKey),
      allDay: [],
      timed: [],
      weather: null,
      hasEvents: false,
      isFallback: false,
    };
  });
  const groupMap = new Map(groups.map((group) => [group.dateKey, group]));

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

  const weatherMap = weatherByDate(weatherData);
  const currentWeather = normalizeCurrentWeather(weatherData, todayKey);
  if (currentWeather) weatherMap.set(todayKey, { ...(weatherMap.get(todayKey) || {}), ...currentWeather });
  for (const group of groups) {
    group.allDay = orderedEvents(group.allDay);
    group.timed = orderedEvents(group.timed);
    group.weather = weatherMap.get(group.dateKey) || null;
  }

  let visibleGroups = groups.filter((group) => {
    if (forceVisibleDateKey && group.dateKey === forceVisibleDateKey) return true;
    if (group.hasEvents) return true;
    if (group.weather && group.dateKey >= todayKey) return true;
    return false;
  });

  const monthStart = groups[0];
  if (monthStart && !visibleGroups.some((group) => group.dateKey === monthStart.dateKey)) {
    if (!visibleGroups.length) monthStart.isFallback = true;
    visibleGroups = [monthStart, ...visibleGroups];
  }

  if (!visibleGroups.length) {
    const first = monthStart;
    if (first) {
      first.isFallback = true;
      visibleGroups = [first];
    }
  }

  return {
    groups,
    visibleGroups,
    firstVisibleDateKey: visibleGroups[0]?.dateKey || monthStartDateKey,
    monthStartDateKey,
  };
}
