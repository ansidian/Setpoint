/* eslint-disable react-refresh/only-export-components */
import { Calendar as CalendarIcon, ExternalLink, Pencil, Video } from "lucide-react";
import TimelineDetailRail from "../TimelineDetailRail.jsx";
import {
  RailAction,
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../DetailRailPrimitives.jsx";
import { formatEventDuration } from "../../../lib/redesign-helpers";
import { extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../lib/calendar-links";
import EventsHeaderExtras from "./EventsHeaderExtras.jsx";
import { getVisibleEventCount, renderEventsCellContents } from "./events/EventsCellContent.jsx";
import { renderEventsWorkspaceSupport } from "./events/EventsWorkspaceSupport.jsx";

const MEETING_PROVIDER_PREFIX = /^\s*(?:\(|\[)?\s*(?:zoom|google meet|meet|teams|webex)(?:\)|\])?\s*[:-]?\s*/i;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const PACIFIC_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const PACIFIC_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function pacificYMD(ms) {
  return PACIFIC_YMD_FORMATTER.format(new Date(ms));
}

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
    return { itemsByDay: {}, totalEvents: 0, allDayEvents: 0 };

  const itemsByDay = {};
  let totalEvents = 0;
  let allDayEvents = 0;
  for (const ev of events) {
    if (!ev.startMs) continue;
    const ymd = pacificYMD(ev.startMs); // e.g. "2026-04-20"
    const [y, m, d] = ymd.split("-").map(Number);
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
  return { itemsByDay, totalEvents, allDayEvents };
}

function canNavigateBack() {
  return true;
}

function formatFullDate(year, month, day) {
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

function selectedEventAccessoryLabel(ev) {
  if (ev.location) return condenseLocationLabel(ev.location, 56);
  if (ev.attendees?.length) {
    return `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`;
  }
  return null;
}

function shouldCompressSelectedCard(ev) {
  if (!ev) return false;
  const displayTitle = sanitizeEventDisplayTitle(ev.title);
  const accessoryLabel = selectedEventAccessoryLabel(ev) || "";
  const titleWordCount = displayTitle.split(/\s+/).filter(Boolean).length;
  return Boolean(
    extractZoomMeetingUrl(ev)
    || displayTitle.length >= 34
    || titleWordCount >= 6
    || accessoryLabel.length >= 44
  );
}

function isEditableEvent(ev) {
  return !!ev?.writable;
}

function getEventSelectionId(ev) {
  if (!ev) return null;
  return String(ev?.id || ev?.iCalUID || ev?.htmlLink || ev?.openUrl || `${ev?.startMs || 0}-${ev?.endMs || 0}-${ev?.title || "event"}`);
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

function EventSelectedCard({ ev, onEditEvent, compact = false, ultraCompact = false }) {
  const editable = isEditableEvent(ev);
  const zoomUrl = extractZoomMeetingUrl(ev);
  const displayTitle = sanitizeEventDisplayTitle(ev.title);
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length
    ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`
    : null;
  const calendarUrl = ev.openUrl || ev.htmlLink;
  const durationLabel = !ev.allDay ? eventMeta(ev) : null;
  const accessoryLabel = location || attendeeSummary || null;
  const density = ultraCompact ? "compressed" : compact ? "compact" : "default";

  if (ultraCompact) {
    return (
      <div data-testid="calendar-selected-event-card" data-density={density}>
        <RailHeroCard accent="#89b4fa" compact>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "rgba(205,214,244,0.56)",
              }}
            >
              Selected event
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
              {durationLabel ? <RailMetaChip tone="quiet">{durationLabel}</RailMetaChip> : null}
              {ev.isRecurring ? <RailMetaChip tone="quiet">Recurring</RailMetaChip> : null}
              {!editable ? <RailMetaChip tone="quiet">Read-only</RailMetaChip> : null}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
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
            </div>
            <div
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
            </div>
          </div>

          <div
            style={{
              paddingTop: 10,
              borderTop: "1px solid rgba(255,255,255,0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {zoomUrl ? (
                <RailAction
                  icon={Video}
                  label="Join Zoom"
                  href={zoomUrl}
                  accent="#89b4fa"
                  tone="accent"
                  size="compact"
                />
              ) : null}
              {editable ? (
                <RailAction
                  icon={Pencil}
                  label="Edit"
                  onClick={() => onEditEvent?.(ev)}
                  accent="#89b4fa"
                  size="compact"
                />
              ) : null}
            </div>
            {calendarUrl ? (
              <RailAction
                icon={ExternalLink}
                label="Open Calendar"
                href={calendarUrl}
                accent="#89b4fa"
                tone={zoomUrl || editable ? "ghost" : "accent"}
                size="compact"
              />
            ) : null}
          </div>
        </RailHeroCard>
      </div>
    );
  }

  return (
    <div data-testid="calendar-selected-event-card" data-density={density}>
      <RailHeroCard accent="#89b4fa">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.56)",
            }}
          >
            Selected event
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
            {durationLabel ? <RailMetaChip tone="quiet">{durationLabel}</RailMetaChip> : null}
            {ev.allDay ? <RailMetaChip tone="quiet">All day</RailMetaChip> : null}
            {ev.isRecurring ? <RailMetaChip tone="quiet">Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip tone="quiet">Read-only</RailMetaChip> : null}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
          <div
            data-testid="calendar-selected-event-title"
            style={{
              fontSize: compact ? 20 : 24,
              lineHeight: 1.08,
              letterSpacing: -0.4,
              color: "#fff",
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: compact ? 2 : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {displayTitle}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: accessoryLabel ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
            gap: 8,
          }}
        >
          <RailFactTile
            label="Time"
            value={eventTimeRange(ev)}
            color="#89b4fa"
            valueNoWrap
            valueFontSize={11}
          />
          {accessoryLabel ? (
            <RailFactTile
              label={location ? "Where" : "People"}
              value={accessoryLabel}
            />
          ) : null}
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: compact ? 10 : 12,
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {zoomUrl ? (
              <RailAction
                icon={Video}
                label="Join Zoom meeting"
                href={zoomUrl}
                accent="#89b4fa"
                tone="accent"
              />
            ) : null}
            {editable ? (
              <RailAction
                icon={Pencil}
                label="Edit details"
                onClick={() => onEditEvent?.(ev)}
                accent="#89b4fa"
              />
            ) : null}
          </div>
          {calendarUrl ? (
            <RailAction
              icon={ExternalLink}
              label="Open in Google Calendar"
              href={calendarUrl}
              accent="#89b4fa"
              tone={zoomUrl || editable ? "ghost" : "accent"}
            />
          ) : null}
        </div>
      </RailHeroCard>
    </div>
  );
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
  viewYear,
  viewMonth,
  items,
  selectedItemId,
  onSelectItem,
  onEditEvent,
  supportBandActive = false,
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

  const compactDetail = ordered.length >= 3;
  const compressedSelectedCard = selectedEvent ? shouldCompressSelectedCard(selectedEvent) : false;
  const ultraCompactDetail = ordered.length >= 3 || compressedSelectedCard;
  const effectiveCompactDetail = compactDetail || compressedSelectedCard;

  return (
    <TimelineDetailRail
      eyebrow="Events ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={`${items.length} event${items.length !== 1 ? "s" : ""}`}
      accent="#89b4fa"
      supportBandActive={supportBandActive}
      headerContent={selectedEvent ? (
        <EventSelectedCard
          ev={selectedEvent}
          onEditEvent={onEditEvent}
          compact={effectiveCompactDetail}
          ultraCompact={ultraCompactDetail}
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
  renderWorkspaceSupport: renderEventsWorkspaceSupport,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  getDefaultSelectedItemId,
  getItemId: getEventSelectionId,
  label: "Events",
};

export default eventsView;
