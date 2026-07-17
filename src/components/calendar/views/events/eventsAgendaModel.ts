import { getEventSelectionId } from "../../../../lib/shell-helpers";
import {
  addDaysYmd,
  pacificYMD,
  ymdFromParts,
} from "../../calendarDateUtils.ts";
import { visualEventDateRange } from "../../modal/calendarEventSpanLayout";
import { sameEventList } from "../../modal/calendarMonthPreviewModel";
import {
  buildDisplayedMonthGroups,
  clampRangeToMonth,
  formatAgendaHeaderLabel,
  monthBounds,
  sparseVisibleGroups,
} from "../agenda/agendaDateModel.ts";
import {
  deadlinePlanningAccent,
  deadlinePlanningStatusIcon,
  deadlinePlanningSubtitle,
  deadlinePlanningTimeLabel,
  deadlinePlanningTitle,
  getDeadlineOverlayComputed,
  getPlanningItemId,
} from "./eventsPlanningModel.ts";
import { normalizeStatus, statusLabel } from "../deadlines/deadlinesModel.ts";
import type {
  CalendarDeadlineOverlay,
  CalendarItemLike,
  CalendarWeatherData,
  CalendarWeatherDay,
} from "../calendarViewTypes";
import type { AgendaDateGroup } from "../agenda/agendaDateModel";

export interface AgendaEvent extends CalendarItemLike {
  agendaDateKey: string;
  agendaItemId: string | null;
  agendaTitle: string;
  agendaTimeRange: string;
  agendaSourceColor: string;
}
export interface AgendaDeadline extends CalendarItemLike {
  agendaDateKey?: string | null;
  agendaItemId: string | null;
  agendaTitle: string;
  agendaSubtitle: string;
  agendaTimeRange: string;
  agendaSourceColor: string;
  agendaItemKind?: "deadline";
  agendaComplete?: boolean;
  agendaStatus: string;
  agendaStatusIcon?: "complete" | "in_progress" | null;
}
export interface EventsAgendaGroup extends AgendaDateGroup {
  allDay: AgendaEvent[];
  timed: AgendaEvent[];
  deadlines: AgendaDeadline[];
  weather: CalendarWeatherDay | null;
  hasEvents: boolean;
  hasDeadlines: boolean;
}
export interface AgendaMonth { year: number; month: number }
export interface EventsAgendaMonthResult {
  monthKey: string;
  year: number;
  month: number;
  groups: EventsAgendaGroup[];
  visibleGroups: EventsAgendaGroup[];
  firstVisibleDateKey: string;
  monthStartDateKey: string;
}
interface AgendaCacheEntry {
  inputs: {
    monthEvents: CalendarItemLike[];
    deadlineOverlay: CalendarDeadlineOverlay | null;
    weatherData: CalendarWeatherData | null;
    todayKey: string;
    forceKey: string | null;
  };
  value: EventsAgendaMonthResult;
}

const eventSelectionId = getEventSelectionId as unknown as (event: CalendarItemLike) => string | null;
const eventVisualRange = visualEventDateRange as unknown as (event: CalendarItemLike) => { startDate: string; endDate: string } | null;
const sameCalendarEventList = sameEventList as unknown as (left: CalendarItemLike[], right: CalendarItemLike[]) => boolean;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export function formatAgendaEventTitle(value: unknown): string {
  return String(value || "").trim() || "(No title)";
}

export function resolveAgendaSourceColor(event: CalendarItemLike): string {
  return event?.color || event?.sourceColor || "#89b4fa";
}

function formatTime(ms: number | null | undefined): string {
  if (!Number.isFinite(ms)) return "";
  return DATE_TIME_FORMATTER.format(new Date(ms as number)).replace(/\s/g, " ");
}

export function formatAgendaTimeRange(event: CalendarItemLike): string {
  if (event?.allDay) return "All day";
  const start = formatTime(event?.startMs);
  const end = formatTime(event?.endMs);
  if (start && end && start !== end) return `${start}-${end}`;
  return start || end || "";
}

function orderedEvents<T extends CalendarItemLike>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    if ((a.startMs || 0) !== (b.startMs || 0)) return (a.startMs || 0) - (b.startMs || 0);
    if ((a.endMs || 0) !== (b.endMs || 0)) return (a.endMs || 0) - (b.endMs || 0);
    return formatAgendaEventTitle(a.title).localeCompare(formatAgendaEventTitle(b.title));
  });
}

function weatherByDate(weatherData: CalendarWeatherData | null): Map<string, CalendarWeatherDay> {
  const map = new Map<string, CalendarWeatherDay>();
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

function normalizeCurrentWeather(weatherData: CalendarWeatherData | null, todayKey: string): CalendarWeatherDay | null {
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

function miniCalendarBounds(viewYear: number, viewMonth: number): { startDate: string; endDate: string } {
  const monthStart = ymdFromParts(viewYear, viewMonth, 1);
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const startDate = addDaysYmd(monthStart, -firstDay);
  return {
    startDate,
    endDate: addDaysYmd(startDate, 41),
  };
}

function rangeOverlaps(range: { startDate: string; endDate: string } | null, bounds: { startDate: string; endDate: string }): boolean {
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
}: {
  events?: CalendarItemLike[];
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  viewYear: number;
  viewMonth: number;
  weatherData?: CalendarWeatherData | null;
  todayKey?: string;
  forceVisibleDateKey?: string | null;
}) {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups<EventsAgendaGroup>({
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
    const range = clampRangeToMonth(eventVisualRange(event), viewYear, viewMonth);
    if (!range) continue;
    let cursor = range.startDate;
    while (cursor <= range.endDate) {
      const group = groupMap.get(cursor);
      if (group) {
        const agendaEvent = {
          ...event,
          agendaDateKey: cursor,
          agendaItemId: eventSelectionId(event),
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
    hasVisibleItems: (group) => group.hasEvents || group.hasDeadlines || !!(group.weather && group.dateKey >= todayKey),
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
}: {
  events?: CalendarItemLike[];
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  viewYear: number;
  viewMonth: number;
}): CalendarItemLike[] {
  const bounds = miniCalendarBounds(viewYear, viewMonth);
  const eventItems = (events || [])
    .filter((event) => event?.startMs && rangeOverlaps(eventVisualRange(event), bounds))
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
}: {
  months?: AgendaMonth[];
  events?: CalendarItemLike[];
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  weatherData?: CalendarWeatherData | null;
  todayKey?: string;
  forceVisibleDateKey?: string | null;
}): EventsAgendaMonthResult[] {
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
}: {
  previous?: Map<string, AgendaCacheEntry> | null;
  months?: AgendaMonth[];
  getMonthEvents?: ((year: number, month: number) => CalendarItemLike[]) | null;
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  weatherData?: CalendarWeatherData | null;
  todayKey?: string;
  forceVisibleDateKey?: string | null;
}): { list: EventsAgendaMonthResult[]; cache: Map<string, AgendaCacheEntry> } {
  const cache = new Map<string, AgendaCacheEntry>();
  const list = months.map(({ year, month }) => {
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthEvents = getMonthEvents ? getMonthEvents(year, month) || [] : [];
    const forceKey = forceVisibleDateKey?.startsWith(mk) ? forceVisibleDateKey : null;
    const prior = previous?.get(mk);
    if (
      prior
      && sameCalendarEventList(prior.inputs.monthEvents, monthEvents)
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
export function agendaHasSelectedHiddenAllDay(
  group: { dateKey: string; allDay: Array<{ agendaItemId?: unknown }> } | null | undefined,
  visibleCount: number,
  selectedItemId: unknown,
  selectedDateKey: string | null | undefined,
): boolean {
  if (!group || selectedDateKey !== group.dateKey) return false;
  const selected = String(selectedItemId || "");
  if (!selected) return false;
  return (group.allDay || []).slice(visibleCount).some((event) => String(event?.agendaItemId || "") === selected);
}

export { formatAgendaHeaderLabel, monthBounds };
