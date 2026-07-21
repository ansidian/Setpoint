import { Calendar as CalendarIcon } from "lucide-react";
import EventsHeaderExtras from "./EventsHeaderExtras.tsx";
import { getVisibleEventCount, renderEventsCellContents } from "./events/EventsCellContent.tsx";
import { addDaysYmd, pacificYMD, parseYmd, ymdFromParts } from "../calendarDateUtils.ts";
import { isPinnedCalendarEvent, visualEventDateRange } from "../modal/calendarEventSpanLayout";
import {
  getDeadlineOverlayComputed,
  getPlanningItemId,
  matchesPlanningItemId,
  mergeDeadlineOverlayIntoEvents,
  orderPlanningItems,
} from "./events/eventsPlanningModel.ts";
import { renderEventsDetail, renderEventsFloatingDetail } from "./events/EventsDetailRail.tsx";
import { getDefaultSelectedItemId } from "./events/eventDetailModel.ts";
import type {
  CalendarCellMeta,
  CalendarDeadlineOverlay,
  CalendarItemLike,
  CalendarViewDefinition,
  CalendarWeatherData,
} from "./calendarViewTypes";
import type { PlanningItem } from "./events/eventsPlanningModel";

export interface EventsComputed {
  itemsByDay: Record<string, PlanningItem[]>;
  itemsByDate: Record<string, PlanningItem[]>;
  totalEvents: number;
  allDayEvents: number;
  cellMetaByDate: Record<string, CalendarCellMeta>;
  [key: string]: unknown;
}

export interface EventsViewData {
  events?: unknown[];
  deadlineOverlay?: unknown;
}

const eventVisualDateRange = visualEventDateRange as unknown as (event: CalendarItemLike) => { startDate: string; endDate: string } | null;
const pinnedCalendarEvent = isPinnedCalendarEvent as unknown as (event: CalendarItemLike) => boolean;

function buildWeatherCellMeta(weatherData?: CalendarWeatherData | null): Record<string, CalendarCellMeta> {
  const cellMetaByDate: Record<string, CalendarCellMeta> = {};
  for (const day of weatherData?.dailyForecast || []) {
    if (!day?.dateKey) continue;
    cellMetaByDate[day.dateKey] = {
      ...(cellMetaByDate[day.dateKey] || {}),
      weather: {
        dateKey: day.dateKey,
        high: day.high,
        low: day.low,
        icon: day.icon,
        summary: day.summary || "",
      },
    };
  }
  return cellMetaByDate;
}

function compute({ data, viewYear, viewMonth, weatherData = null }: {
  data?: EventsViewData | null;
  viewYear: number;
  viewMonth: number;
  weatherData?: CalendarWeatherData | null;
}): EventsComputed {
  const events = (data?.events || []) as CalendarItemLike[];
  const cellMetaByDate = buildWeatherCellMeta(weatherData);
  const deadlineOverlay = data?.deadlineOverlay as CalendarDeadlineOverlay | null | undefined;
  const deadlineOverlayComputed = deadlineOverlay?.enabled
    ? getDeadlineOverlayComputed({
        deadlineData: deadlineOverlay.data,
        viewYear,
        viewMonth,
        showCompleted: !!deadlineOverlay.showCompleted,
      })
    : null;
  if (!events.length) {
    return mergeDeadlineOverlayIntoEvents({
      eventComputed: { itemsByDay: {}, itemsByDate: {}, totalEvents: 0, allDayEvents: 0, cellMetaByDate },
      deadlineOverlayComputed,
    });
  }

  const itemsByDay: Record<string, PlanningItem[]> = {};
  const itemsByDate: Record<string, PlanningItem[]> = {};
  let totalEvents = 0;
  let allDayEvents = 0;
  const monthStart = ymdFromParts(viewYear, viewMonth, 1);
  const monthEnd = ymdFromParts(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());

  for (const ev of events) {
    if (!ev.startMs) continue;
    const range = pinnedCalendarEvent(ev)
      ? eventVisualDateRange(ev)
      : { startDate: pacificYMD(ev.startMs), endDate: pacificYMD(ev.startMs) };
    if (!range) continue;

    let cursor = range.startDate;
    while (cursor <= range.endDate) {
      if (!itemsByDate[cursor]) itemsByDate[cursor] = [];
      itemsByDate[cursor]!.push(ev);

      const parsed = parseYmd(cursor);
      if (parsed && parsed.year === viewYear && parsed.month === viewMonth) {
        if (!itemsByDay[parsed.day]) itemsByDay[parsed.day] = [];
        itemsByDay[parsed.day]!.push(ev);
      }
      cursor = addDaysYmd(cursor, 1);
    }

    if (range.startDate <= monthEnd && range.endDate >= monthStart) {
      totalEvents += 1;
      if (ev.allDay) allDayEvents += 1;
    }
  }

  for (const d of Object.keys(itemsByDay)) {
    itemsByDay[d] = orderPlanningItems(itemsByDay[d]);
  }
  for (const dateKey of Object.keys(itemsByDate)) {
    itemsByDate[dateKey] = orderPlanningItems(itemsByDate[dateKey]);
  }
  return mergeDeadlineOverlayIntoEvents({
    eventComputed: { itemsByDay, itemsByDate, totalEvents, allDayEvents, cellMetaByDate },
    deadlineOverlayComputed,
  });
}

function canNavigateBack(_input?: Record<string, unknown>) {
  return true;
}

const eventsView = {
  compute,
  canNavigateBack,
  getVisibleEventCount,
  renderCellContents: renderEventsCellContents,
  renderDetail: renderEventsDetail,
  renderFloatingDetail: renderEventsFloatingDetail,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  getDefaultSelectedItemId,
  getItemId: getPlanningItemId,
  matchesItemId: matchesPlanningItemId,
  label: "Events",
} satisfies CalendarViewDefinition<EventsViewData, PlanningItem, EventsComputed>;

export default eventsView;
