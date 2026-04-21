import { ExternalLink, Video, Calendar as CalendarIcon } from "lucide-react";
import TimelineDetailRail from "../TimelineDetailRail.jsx";
import { formatEventDuration } from "../../../lib/redesign-helpers";
import { extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../lib/calendar-links";
import EventsHeaderExtras from "./EventsHeaderExtras.jsx";

const EVENT_ROW_HEIGHT = 12;
const STACK_GAP = 2;
const MORE_ROW_HEIGHT = 10;

function getStackHeight(visibleCount, hasMore) {
  if (visibleCount <= 0) return 0;
  const childCount = visibleCount + (hasMore ? 1 : 0);
  return (
    visibleCount * EVENT_ROW_HEIGHT +
    (hasMore ? MORE_ROW_HEIGHT : 0) +
    Math.max(0, childCount - 1) * STACK_GAP
  );
}

function getVisibleEventCount(itemCount, contentHeight) {
  if (itemCount <= 0) return 0;
  const fallback = Math.min(itemCount, 2);

  if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
    return fallback;
  }

  for (let visibleCount = itemCount; visibleCount >= 1; visibleCount -= 1) {
    const hiddenCount = itemCount - visibleCount;
    if (getStackHeight(visibleCount, hiddenCount > 0) <= contentHeight) {
      return visibleCount;
    }
  }

  return 1;
}

function pacificYMD(ms) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ms));
}

function pacificTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

function renderCellContents({ items, contentHeight, pastTone }) {
  if (!items?.length) return null;
  const maxVisible = getVisibleEventCount(items.length, contentHeight);
  const extra = items.length > maxVisible ? items.length - maxVisible : 0;
  const isPast = pastTone === "items";
  const contentOpacity = isPast ? 0.86 : 1;
  const dotOpacity = isPast ? 0.62 : 1;
  const textColor = isPast ? "rgba(205,214,244,0.43)" : "rgba(205,214,244,0.55)";
  const moreColor = isPast ? "rgba(205,214,244,0.36)" : "rgba(205,214,244,0.5)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
        opacity: contentOpacity,
        filter: isPast ? "saturate(0.9)" : "none",
        transition: "opacity 150ms, filter 150ms",
      }}
    >
      {items.slice(0, maxVisible).map((ev, i) => (
        <div
          key={`${ev.id || ev.htmlLink || ev.title || "event"}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10.5,
            lineHeight: 1.1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ev.color || "rgba(205,214,244,0.45)",
              boxShadow: ev.color ? `0 0 4px ${ev.color}${isPast ? "34" : "60"}` : "none",
              opacity: dotOpacity,
            }}
          />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              color: textColor,
            }}
          >
            {ev.title || "(No title)"}
          </span>
        </div>
      ))}
      {extra > 0 && (
        <div
          style={{
            fontSize: 9,
            lineHeight: 1,
            color: moreColor,
            paddingLeft: 11,
          }}
        >
          +{extra} more
        </div>
      )}
    </div>
  );
}

function formatFullDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function eventSubtitle(ev) {
  if (ev.attendees?.length) {
    return `with ${ev.attendees.slice(0, 3).join(", ")}${ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ""}`;
  }
  if (ev.location) return getLocationDisplayLabel(ev.location);
  return ev.subtitle || "";
}

function eventMeta(ev) {
  if (ev.allDay) return ev.duration || "All day";
  return formatEventDuration(ev.startMs, ev.endMs) || ev.duration || "";
}

function isEditableEvent(ev) {
  return !!ev?.writable;
}

// eslint-disable-next-line no-unused-vars -- Icon is used in JSX below
function renderActionLink({ href, label, icon: Icon }) {
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      style={{
        color: "rgba(205,214,244,0.4)",
        padding: 4,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        transform: "translateY(0)",
        transition: "transform 140ms, color 140ms, background 140ms",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "#cba6da";
        event.currentTarget.style.background = "rgba(203,166,218,0.12)";
        event.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = "rgba(205,214,244,0.4)";
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <Icon size={12} />
    </a>
  );
}

function toRailItem(ev, index, onSelectEvent) {
  const editable = isEditableEvent(ev);
  const zoomUrl = extractZoomMeetingUrl(ev);
  const meta = [
    eventMeta(ev),
    ev.isRecurring ? "Recurring" : null,
    ev.writable === false ? "Read-only" : null,
  ].filter(Boolean).join(" · ");

  return {
    id: `${ev.id || ev.htmlLink || ev.title || "event"}-${index}`,
    timeLabel: ev.allDay ? "All day" : pacificTime(ev.startMs),
    title: ev.title || "(No title)",
    subtitle: eventSubtitle(ev),
    meta,
    dotColor: ev.color || ev.sourceColor || "#4285f4",
    onClick: editable ? () => onSelectEvent?.(ev) : undefined,
    trailing: (
      <>
        {renderActionLink({
          href: zoomUrl,
          label: "Join Zoom meeting",
          icon: Video,
        })}
        {renderActionLink({
          href: ev.openUrl || ev.htmlLink,
          label: "Open in Google Calendar",
          icon: ExternalLink,
        })}
      </>
    ),
  };
}

function renderDetail({ selectedDay, viewYear, viewMonth, items, onSelectEvent }) {
  const ordered = [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
  const allDayItems = ordered.filter((item) => item.allDay);
  const timedItems = ordered.filter((item) => !item.allDay);

  return (
    <TimelineDetailRail
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={`${items.length} event${items.length !== 1 ? "s" : ""}`}
      sections={[
        {
          id: "all-day",
          label: "All day",
          items: allDayItems.map((item, index) => toRailItem(item, index, onSelectEvent)),
        },
        {
          id: "timed",
          label: "By time",
          items: timedItems.map((item, index) => toRailItem(item, index, onSelectEvent)),
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
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
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
        padding: "12px 14px",
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
          paddingTop: 8,
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)" }}>
          All-day
        </span>
        <span
          style={{
            fontSize: 13,
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
  renderCellContents,
  renderDetail,
  renderFooter,
  HeaderExtras: EventsHeaderExtras,
  icon: CalendarIcon,
  label: "Events",
};

export default eventsView;
