/* eslint-disable react-refresh/only-export-components */
import { Calendar as CalendarIcon, ExternalLink, Pencil, Video } from "lucide-react";
import { motion as Motion } from "motion/react";
import TimelineDetailRail from "../TimelineDetailRail.jsx";
import {
  RailAction,
  RailActionGroup,
  RailHeroCard,
  RailMetaChip,
} from "../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../detailRailMotion.js";
import { formatEventDuration, getEventSelectionId } from "../../../lib/redesign-helpers";
import { extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../lib/calendar-links";
import EventsHeaderExtras from "./EventsHeaderExtras.jsx";
import { getVisibleEventCount, renderEventsCellContents } from "./events/EventsCellContent.jsx";
import { pacificYMD, parseYmd } from "../calendarDateUtils.js";

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

function compute({ data, viewYear, viewMonth }) {
  const events = data?.events || [];
  if (!events.length)
    return { itemsByDay: {}, itemsByDate: {}, totalEvents: 0, allDayEvents: 0 };

  const itemsByDay = {};
  const itemsByDate = {};
  let totalEvents = 0;
  let allDayEvents = 0;
  for (const ev of events) {
    if (!ev.startMs) continue;
    const ymd = pacificYMD(ev.startMs); // e.g. "2026-04-20"
    const [y, m, d] = ymd.split("-").map(Number);
    if (!itemsByDate[ymd]) itemsByDate[ymd] = [];
    itemsByDate[ymd].push(ev);
    if (y !== viewYear || m !== viewMonth + 1) continue;
    if (!itemsByDay[d]) itemsByDay[d] = [];
    itemsByDay[d].push(ev);
    totalEvents += 1;
    if (ev.allDay) allDayEvents += 1;
  }
  // Sort each day's events chronologically
  for (const d of Object.keys(itemsByDay)) {
    itemsByDay[d].sort((a, b) => a.startMs - b.startMs);
  }
  for (const dateKey of Object.keys(itemsByDate)) {
    itemsByDate[dateKey].sort((a, b) => a.startMs - b.startMs);
  }
  return { itemsByDay, itemsByDate, totalEvents, allDayEvents };
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
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
}

export function getDefaultSelectedItemId(items = []) {
  const ordered = orderDetailEvents(Array.isArray(items) ? items : items?.items || []);
  return ordered[0] ? getEventSelectionId(ordered[0]) : null;
}

function EventSelectedCard({ ev, actions }) {
  const motion = useDetailRailMotion();
  const editable = isEditableEvent(ev);
  const displayTitle = sanitizeEventDisplayTitle(ev.title);
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length
    ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`
    : null;
  const durationLabel = !ev.allDay ? eventMeta(ev) : null;
  const accessoryLabel = location || attendeeSummary || null;

  return (
    <Motion.div
      layout
      transition={motion.layout}
      data-testid="calendar-selected-event-card"
      data-density="compressed"
      style={{ flexShrink: 0 }}
    >
      <RailHeroCard accent="#89b4fa" compact actions={actions}>
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
              style={{
                fontSize: 12.5,
                lineHeight: 1.35,
                color: "#89b4fa",
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

        {(durationLabel || ev.allDay || ev.isRecurring || !editable) ? (
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {durationLabel ? <RailMetaChip tone="quiet" compact>{durationLabel}</RailMetaChip> : null}
            {ev.allDay ? <RailMetaChip tone="quiet" compact>All day</RailMetaChip> : null}
            {ev.isRecurring ? <RailMetaChip tone="quiet" compact>Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip tone="quiet" compact>Read-only</RailMetaChip> : null}
          </Motion.div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}

function EventSelectedActions({ ev, onEditEvent, compact = false }) {
  if (!ev) return null;
  const editable = isEditableEvent(ev);
  const zoomUrl = extractZoomMeetingUrl(ev);
  const calendarUrl = ev.openUrl || ev.htmlLink;
  const size = compact ? "compact" : "default";
  const hasPrimaryActions = zoomUrl || editable;

  if (!hasPrimaryActions && !calendarUrl) return null;

  return (
    <RailActionGroup>
      {zoomUrl ? (
        <RailAction
          icon={Video}
          label={compact ? "Join Zoom" : "Join Zoom meeting"}
          href={zoomUrl}
          accent="#89b4fa"
          tone="accent"
          size={size}
        />
      ) : null}
      {editable ? (
        <RailAction
          icon={Pencil}
          label="Edit details"
          onClick={() => onEditEvent?.(ev)}
          accent="#89b4fa"
          size={size}
        />
      ) : null}
      {calendarUrl ? (
        <RailAction
          icon={ExternalLink}
          label={compact ? "Open Calendar" : "Open in Google Calendar"}
          href={calendarUrl}
          accent="#89b4fa"
          tone={hasPrimaryActions ? "ghost" : "accent"}
          size={size}
        />
      ) : null}
    </RailActionGroup>
  );
}

function hasEventActions(ev) {
  if (!ev) return false;
  return Boolean(isEditableEvent(ev) || extractZoomMeetingUrl(ev) || ev.openUrl || ev.htmlLink);
}

function toRailItem(ev, onSelectItem, selectedItemId) {
  const meta = [
    eventMeta(ev),
    ev.isRecurring ? "Recurring" : null,
    ev.writable === false ? "Read-only" : null,
  ].filter(Boolean).join(" · ");
  const selectionId = getEventSelectionId(ev);
  const isSelected = String(selectionId) === String(selectedItemId);

  return {
    id: selectionId,
    timeLabel: ev.allDay ? "All day" : pacificTime(ev.startMs),
    title: sanitizeEventDisplayTitle(ev.title),
    subtitle: eventSubtitle(ev),
    meta,
    selected: isSelected,
    dotColor: ev.color || ev.sourceColor || "#4285f4",
    onClick: !isSelected && onSelectItem
        ? () => onSelectItem(selectionId)
        : undefined,
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
  const allDayItems = [];
  const timedItems = [];
  let selectedEvent = null;

  for (const item of ordered) {
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

  return (
    <TimelineDetailRail
      eyebrow="Events ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay, selectedDateKey)}
      summary={`${items.length} event${items.length !== 1 ? "s" : ""}`}
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
        {
          id: "all-day",
          label: "All day",
          items: allDayItems,
        },
        {
          id: "timed",
          label: "By time",
          items: timedItems,
        },
      ]}
    />
  );
}

function renderFooter({ computed }) {
  const totalEvents = computed?.totalEvents || 0;
  const allDayEvents = computed?.allDayEvents || 0;
  const activeDays = Object.keys(computed?.itemsByDay || {}).length;

  const StatRow = ({ value, label }) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <StatRow value={totalEvents} label="Events this month" />
      <StatRow value={activeDays} label="Active days" />
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingTop: 6,
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)" }}>
          All-day
        </span>
        <span
          style={{
            fontSize: 12,
            color: "rgba(205,214,244,0.8)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {allDayEvents}
        </span>
      </div>
    </div>
  );
}

const eventsView = {
  compute,
  canNavigateBack,
  getVisibleEventCount,
  renderCellContents: renderEventsCellContents,
  renderDetail,
  renderFooter,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  getDefaultSelectedItemId,
  getItemId: getEventSelectionId,
  label: "Events",
};

export default eventsView;
