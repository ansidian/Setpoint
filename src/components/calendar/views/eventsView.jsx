/* eslint-disable react-refresh/only-export-components */
import { Bell, Calendar as CalendarIcon, CheckCircle2, CircleDashed, ExternalLink, Pencil, Video } from "lucide-react";
import { motion as Motion } from "motion/react";
import TimelineDetailRail from "../TimelineDetailRail.jsx";
import {
  RailAction,
  RailActionGroup,
  RailHeroCard,
  RailMetaChip,
  RailReminderIndicator,
} from "../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../detailRailMotion.js";
import { formatEventDuration, getEventSelectionId } from "../../../lib/redesign-helpers";
import { extractNonZoomEventUrl, extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../lib/calendar-links";
import EventsHeaderExtras from "./EventsHeaderExtras.jsx";
import { formatReminderSummary } from "../reminderDisplay.js";
import { getVisibleEventCount, renderEventsCellContents } from "./events/EventsCellContent.jsx";
import { renderEventsFooter } from "./events/EventsFooter.jsx";
import { addDaysYmd, pacificYMD, parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { isPinnedCalendarEvent, visualEventDateRange } from "../modal/calendarEventSpanLayout.js";
import {
  getDeadlineOverlayComputed,
  getPlanningItemId,
  isDeadlinePlanningItem,
  mergeDeadlineOverlayIntoEvents,
  orderPlanningItems,
} from "./events/eventsPlanningModel.js";
import { normalizeStatus, statusLabel } from "./deadlines/deadlinesModel.js";

const MEETING_PROVIDER_PREFIX = /^\s*(?:\(|\[)?\s*(?:zoom|google meet|meet|teams|webex)(?:\)|\])?\s*[:-]?\s*/i;
const PACIFIC_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function pacificTime(ms) {
  return PACIFIC_TIME_FORMATTER.format(new Date(ms));
}

function eventTimeRange(ev) {
  if (ev?.allDay) return ev.duration || "All day";
  const start = ev?.startMs ? pacificTime(ev.startMs) : null;
  const end = ev?.endMs ? pacificTime(ev.endMs) : null;
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || eventMeta(ev) || "";
}

function sanitizeEventDisplayTitle(value) {
  const title = String(value || "").trim();
  if (!title) return "(No title)";
  const cleaned = title.replace(MEETING_PROVIDER_PREFIX, "").trim();
  return cleaned || title;
}

function condenseLocationLabel(text, maxLength = 56) {
  const label = getLocationDisplayLabel(text);
  if (!label || label.length <= maxLength || label === "Zoom meeting") return label;
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;

  const firstTwo = parts.slice(0, 2).join(", ");
  if (firstTwo.length <= maxLength) return firstTwo;
  return parts[0] || label;
}

function compactEventTimeRange(ev) {
  if (ev?.allDay) return ev.duration || "All day";
  const start = ev?.startMs ? pacificTime(ev.startMs) : null;
  const end = ev?.endMs ? pacificTime(ev.endMs) : null;
  if (!start || !end || start === end) return eventTimeRange(ev);

  const startMatch = start.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/);
  const endMatch = end.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/);
  if (!startMatch || !endMatch) return `${start} - ${end}`;

  const [, startTime, startMeridiem] = startMatch;
  const [, endTime, endMeridiem] = endMatch;
  if (startMeridiem === endMeridiem) return `${startTime}-${endTime} ${endMeridiem}`;
  return `${startTime} ${startMeridiem}-${endTime} ${endMeridiem}`;
}

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
  // Sort each day's events chronologically
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

function formatFullDate(year, month, day, selectedDateKey) {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) return FULL_DATE_FORMATTER.format(new Date(parsed.year, parsed.month, parsed.day));
  return FULL_DATE_FORMATTER.format(new Date(year, month, day));
}

function eventSubtitle(ev) {
  if (ev.attendees?.length) {
    return `with ${ev.attendees.slice(0, 3).join(", ")}${ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ""}`;
  }
  if (ev.location) return condenseLocationLabel(ev.location, 40);
  return ev.subtitle || "";
}

function eventMeta(ev) {
  if (ev.allDay) return ev.duration || "All day";
  return formatEventDuration(ev.startMs, ev.endMs) || ev.duration || "";
}

function isEditableEvent(ev) {
  return !!ev?.writable;
}

function orderDetailEvents(items = []) {
  return [...items].sort((a, b) => {
    if (isDeadlinePlanningItem(a) || isDeadlinePlanningItem(b)) return orderPlanningItems([a, b])[0] === a ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
}

export function getDefaultSelectedItemId(items = []) {
  const ordered = orderDetailEvents(Array.isArray(items) ? items : items?.items || []);
  return ordered[0] ? getEventSelectionId(ordered[0]) : null;
}

function eventAccent(ev) {
  return ev?.color || ev?.sourceColor || "#89b4fa";
}

function DeadlineTimelineStatus({ task, compact = false }) {
  const status = normalizeStatus(task?.status);
  if (status !== "complete" && status !== "in_progress") return null;
  const Icon = status === "complete" ? CheckCircle2 : CircleDashed;
  const color = status === "complete" ? "#a6e3a1" : "#89dceb";

  return (
    <span
      data-testid={`deadline-status-indicator-${task.id}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: compact ? 18 : 20,
        padding: compact ? "2px 5px" : "3px 6px",
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${color} 30%, rgba(255,255,255,0.06))`,
        background: `color-mix(in srgb, ${color} 10%, rgba(255,255,255,0.025))`,
        color,
        fontSize: compact ? 9.5 : 10,
        fontWeight: 750,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <Icon aria-hidden="true" focusable="false" size={compact ? 11 : 12} strokeWidth={2.4} />
      <span>{statusLabel(status)}</span>
    </span>
  );
}

function EventSelectedCard({ ev, actions, accent = "#89b4fa" }) {
  const motion = useDetailRailMotion();
  const editable = isEditableEvent(ev);
  const displayTitle = sanitizeEventDisplayTitle(ev.title);
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length
    ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`
    : null;
  const durationLabel = !ev.allDay ? eventMeta(ev) : null;
  const accessoryLabel = location || attendeeSummary || null;
  const reminderSummary = formatReminderSummary(ev);

  return (
    <Motion.div
      layout
      transition={motion.layout}
      data-testid="calendar-selected-event-card"
      data-density="compressed"
      data-height-mode="auto"
      style={{ flexShrink: 0 }}
    >
      <RailHeroCard accent={accent} compact actions={actions}>
        <Motion.div
          layout
          transition={motion.layout}
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.56)",
            flexShrink: 0,
          }}
        >
          Selected event
        </Motion.div>

        <Motion.div layout transition={motion.layout} style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <Motion.div
            layout="position"
            transition={motion.layout}
            data-testid="calendar-selected-event-title"
            style={{
              fontSize: 17,
              lineHeight: 1.08,
              letterSpacing: -0.3,
              color: "#fff",
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {displayTitle}
          </Motion.div>
          <Motion.div
            layout
            transition={motion.layout}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "2px 8px",
            }}
          >
            <span
              data-testid="calendar-selected-event-time"
              data-nowrap="true"
              style={{
                fontSize: 12.5,
                lineHeight: 1.35,
                color: accent,
                fontWeight: 500,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {compactEventTimeRange(ev)}
            </span>
            {accessoryLabel ? (
              <span
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.4,
                  color: "rgba(205,214,244,0.56)",
                  display: "-webkit-box",
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {accessoryLabel}
              </span>
            ) : null}
          </Motion.div>
        </Motion.div>

        {(durationLabel || ev.allDay || ev.isRecurring || !editable || reminderSummary) ? (
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {durationLabel ? <RailMetaChip tone="quiet" compact>{durationLabel}</RailMetaChip> : null}
            {reminderSummary ? (
              <RailReminderIndicator compact>
                <Bell size={10} strokeWidth={2.2} />
                {reminderSummary}
              </RailReminderIndicator>
            ) : null}
            {ev.allDay ? <RailMetaChip tone="quiet" compact>All day</RailMetaChip> : null}
            {ev.isRecurring ? <RailMetaChip tone="quiet" compact>Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip tone="quiet" compact>Read-only</RailMetaChip> : null}
          </Motion.div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}

function EventSelectedActions({ ev, onEditEvent, compact = false, accent = "#89b4fa" }) {
  if (!ev) return null;
  const editable = isEditableEvent(ev);
  const zoomUrl = extractZoomMeetingUrl(ev);
  const eventUrl = extractNonZoomEventUrl(ev);
  const calendarUrl = ev.openUrl || ev.htmlLink;
  const size = compact ? "compact" : "default";
  const hasPrimaryActions = zoomUrl || eventUrl || editable;

  if (!hasPrimaryActions && !calendarUrl) return null;

  return (
    <RailActionGroup>
      {zoomUrl ? (
        <RailAction
          icon={Video}
          label={compact ? "Join Zoom" : "Join Zoom meeting"}
          href={zoomUrl}
          accent={accent}
          tone="accent"
          size={size}
        />
      ) : null}
      {eventUrl ? (
        <RailAction
          icon={ExternalLink}
          label="Open URL"
          href={eventUrl}
          accent={accent}
          tone={zoomUrl ? "ghost" : "accent"}
          size={size}
        />
      ) : null}
      {editable ? (
        <RailAction
          icon={Pencil}
          label="Edit details"
          onClick={() => onEditEvent?.(ev)}
          accent={accent}
          size={size}
        />
      ) : null}
      {calendarUrl ? (
        <RailAction
          icon={ExternalLink}
          label={compact ? "Open Calendar" : "Open in Google Calendar"}
          href={calendarUrl}
          accent={accent}
          tone={hasPrimaryActions ? "ghost" : "accent"}
          size={size}
        />
      ) : null}
    </RailActionGroup>
  );
}

function hasEventActions(ev) {
  if (!ev) return false;
  return Boolean(isEditableEvent(ev) || extractZoomMeetingUrl(ev) || extractNonZoomEventUrl(ev) || ev.openUrl || ev.htmlLink);
}

function toRailItem(ev, onSelectItem, selectedItemId) {
  const reminderSummary = formatReminderSummary(ev);
  const meta = [
    eventMeta(ev),
    reminderSummary,
    ev.isRecurring ? "Recurring" : null,
    ev.writable === false ? "Read-only" : null,
  ].filter(Boolean).join(" · ");
  const selectionId = getPlanningItemId(ev);
  const isSelected = String(selectionId) === String(selectedItemId);

  if (isDeadlinePlanningItem(ev)) {
    const status = normalizeStatus(ev.status);
    return {
      id: selectionId,
      timeLabel: ev.due_time || "End of day",
      title: ev.title || ev.name || "Untitled",
      subtitle: ev.project_name || ev.class_name || ev.source || "Deadline",
      meta: "",
      selected: isSelected,
      dotColor: ev.source === "todoist" ? "#e8776a" : "#5A8FBF",
      complete: status === "complete",
      trailing: <DeadlineTimelineStatus task={ev} />,
      onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
    };
  }

  return {
    id: selectionId,
    timeLabel: ev.allDay ? "All day" : pacificTime(ev.startMs),
    title: sanitizeEventDisplayTitle(ev.title),
    subtitle: eventSubtitle(ev),
    meta,
    selected: isSelected,
    dotColor: ev.color || ev.sourceColor || "#4285f4",
    onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
  };
}

function renderDetail({
  selectedDay,
  selectedDateKey,
  viewYear,
  viewMonth,
  items,
  selectedItemId,
  onSelectItem,
  onEditEvent,
}) {
  const ordered = orderDetailEvents(items);
  const eventItems = ordered.filter((item) => !isDeadlinePlanningItem(item));
  const deadlineItems = ordered.filter(isDeadlinePlanningItem);
  const allDayItems = [];
  const timedItems = [];
  const deadlineRailItems = [];
  let selectedEvent = null;

  for (const item of eventItems) {
    const railItem = toRailItem(item, onSelectItem, selectedItemId);
    if (item.allDay) {
      allDayItems.push(railItem);
    } else {
      timedItems.push(railItem);
    }

    if (!selectedEvent && String(railItem.id) === String(selectedItemId)) {
      selectedEvent = item;
    }
  }
  for (const item of deadlineItems) {
    deadlineRailItems.push(toRailItem(item, onSelectItem, selectedItemId));
  }

  return (
    <TimelineDetailRail
      eyebrow="Events ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay, selectedDateKey)}
      summary={`${eventItems.length} event${eventItems.length !== 1 ? "s" : ""}${deadlineItems.length ? ` · ${deadlineItems.length} deadline${deadlineItems.length === 1 ? "" : "s"}` : ""}`}
      accent="#89b4fa"
      headerContent={selectedEvent ? (
        <EventSelectedCard
          ev={selectedEvent}
          actions={hasEventActions(selectedEvent) ? (
            <EventSelectedActions
              ev={selectedEvent}
              onEditEvent={onEditEvent}
              compact
            />
          ) : null}
        />
      ) : null}
      sections={[
        { id: "all-day", label: "All day", items: allDayItems },
        { id: "timed", label: "By time", items: timedItems },
        { id: "deadlines", label: "Deadlines", items: deadlineRailItems },
      ]}
    />
  );
}

function renderFloatingDetail({ items, selectedItemId, onEditEvent }) {
  const ordered = orderDetailEvents(items);
  const selectedEvent = ordered.find((item) => (
    String(getEventSelectionId(item)) === String(selectedItemId)
  ));

  if (!selectedEvent) return null;
  const accent = eventAccent(selectedEvent);

  return (
    <EventSelectedCard
      ev={selectedEvent}
      accent={accent}
      actions={hasEventActions(selectedEvent) ? (
        <EventSelectedActions
          ev={selectedEvent}
          onEditEvent={onEditEvent}
          compact
          accent={accent}
        />
      ) : null}
    />
  );
}

const eventsView = {
  compute,
  canNavigateBack,
  getVisibleEventCount,
  renderCellContents: renderEventsCellContents,
  renderDetail,
  renderFloatingDetail,
  renderFooter: renderEventsFooter,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  getDefaultSelectedItemId,
  getItemId: getPlanningItemId,
  label: "Events",
};

export default eventsView;
