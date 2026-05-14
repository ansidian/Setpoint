import { Calendar as CalendarIcon } from "lucide-react";
import EventsHeaderExtras from "./EventsHeaderExtras.jsx";
import { getVisibleEventCount, renderEventsCellContents } from "./events/EventsCellContent.jsx";
import { renderEventsFooter } from "./events/EventsFooter.jsx";
import { addDaysYmd, pacificYMD, parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { isPinnedCalendarEvent, visualEventDateRange } from "../modal/calendarEventSpanLayout.js";
import {
  getDeadlineOverlayComputed,
  getPlanningItemId,
  mergeDeadlineOverlayIntoEvents,
  orderPlanningItems,
} from "./events/eventsPlanningModel.js";
import {
  getDefaultSelectedItemId,
  renderEventsDetail,
  renderEventsFloatingDetail,
} from "./events/EventsDetailRail.jsx";

function buildWeatherCellMeta(weatherData) {
  const cellMetaByDate = {};
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

function compute({ data, viewYear, viewMonth, weatherData = null }) {
  const events = data?.events || [];
  const cellMetaByDate = buildWeatherCellMeta(weatherData);
  const deadlineOverlayComputed = data?.deadlineOverlay?.enabled
    ? getDeadlineOverlayComputed({
        deadlineData: data.deadlineOverlay.data,
        viewYear,
        viewMonth,
        showCompleted: !!data.deadlineOverlay.showCompleted,
      })
    : null;
  if (!events.length) {
    return mergeDeadlineOverlayIntoEvents({
      eventComputed: { itemsByDay: {}, itemsByDate: {}, totalEvents: 0, allDayEvents: 0, cellMetaByDate },
      deadlineOverlayComputed,
    });
  }

  const itemsByDay = {};
  const itemsByDate = {};
  let totalEvents = 0;
  let allDayEvents = 0;
  const monthStart = ymdFromParts(viewYear, viewMonth, 1);
  const monthEnd = ymdFromParts(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());

  for (const ev of events) {
    if (!ev.startMs) continue;
    const range = isPinnedCalendarEvent(ev)
      ? visualEventDateRange(ev)
      : { startDate: pacificYMD(ev.startMs), endDate: pacificYMD(ev.startMs) };
    if (!range) continue;

    let cursor = range.startDate;
    while (cursor <= range.endDate) {
      if (!itemsByDate[cursor]) itemsByDate[cursor] = [];
      itemsByDate[cursor].push(ev);

      const parsed = parseYmd(cursor);
      if (parsed?.year === viewYear && parsed.month === viewMonth) {
        if (!itemsByDay[parsed.day]) itemsByDay[parsed.day] = [];
        itemsByDay[parsed.day].push(ev);
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

function canNavigateBack() {
  return true;
}

const eventsView = {
  compute,
  canNavigateBack,
  getVisibleEventCount,
  renderCellContents: renderEventsCellContents,
  renderDetail: renderEventsDetail,
  renderFloatingDetail: renderEventsFloatingDetail,
  renderFooter: renderEventsFooter,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  getDefaultSelectedItemId,
  getItemId: getPlanningItemId,
  label: "Events",
};

export default eventsView;
