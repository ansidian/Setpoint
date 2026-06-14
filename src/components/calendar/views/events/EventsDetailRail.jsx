/* eslint-disable react-refresh/only-export-components */
import { Bell, CheckCircle2, CircleDashed, ExternalLink, Pencil, Video } from "lucide-react";
import { motion as Motion } from "motion/react";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import GoogleSpecialDateBadge from "../../GoogleSpecialDateBadge.jsx";
import {
  RailAction,
  RailActionGroup,
  RailHeroCard,
  RailMetaChip,
  RailReminderIndicator,
} from "../../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../../detailRailMotion.js";
import { formatEventDuration, getEventSelectionId } from "../../../../lib/shell-helpers";
import { extractNonZoomEventUrl, extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { formatReminderSummary } from "../../reminderDisplay.js";
import { parseYmd } from "../../calendarDateUtils.js";
import {
  getPlanningItemId,
  isDeadlinePlanningItem,
  orderPlanningItems,
} from "./eventsPlanningModel.js";
import { deadlineAccentFor, normalizeStatus, statusLabel } from "../deadlines/deadlinesModel.js";
import {
  googleSpecialDateAccent,
  googleSpecialDateLabel,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.js";

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

function specialEventLabel(ev) {
  if (isGoogleSpecialDateEvent(ev)) return googleSpecialDateLabel(ev);
  const eventType = ev?.eventType || "default";
  if (eventType === "fromGmail") return "From Gmail";
  if (eventType === "focusTime") return "Focus time";
  if (eventType === "outOfOffice") return "Out of office";
  if (eventType === "workingLocation") return "Working location";
  return null;
}

function isEditableEvent(ev) {
  return !!ev?.writable && (ev.eventType || "default") === "default";
}

function isReadOnlyBirthdayEvent(ev) {
  return isGoogleSpecialDateEvent(ev);
}

function calendarActionUrl(ev) {
  if (isReadOnlyBirthdayEvent(ev)) return null;
  return ev?.openUrl || ev?.htmlLink || null;
}

export function orderDetailEvents(items = []) {
  // When any deadline planning item is present, defer the whole list to
  // orderPlanningItems once: calling it per-pair inside .sort() is non-antisymmetric
  // and non-transitive (it re-buckets a 2-item slice), which can disagree with the
  // agenda/cell ordering on full ties. orderPlanningItems already buckets
  // deadline-vs-event, sorts by time, and breaks full ties stably by title.
  if (items.some(isDeadlinePlanningItem)) return orderPlanningItems([...items]);
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
}

export function getDefaultSelectedItemId(items = []) {
  const ordered = orderDetailEvents(Array.isArray(items) ? items : items?.items || []);
  return ordered[0] ? getEventSelectionId(ordered[0]) : null;
}

function eventAccent(ev) {
  if (isGoogleSpecialDateEvent(ev)) return googleSpecialDateAccent(ev);
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
  const specialDate = isGoogleSpecialDateEvent(ev);
  const editable = isEditableEvent(ev);
  const displayTitle = sanitizeEventDisplayTitle(ev.title);
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length
    ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`
    : null;
  const durationLabel = !ev.allDay && !specialDate ? eventMeta(ev) : null;
  const accessoryLabel = specialDate ? null : location || attendeeSummary || null;
  const reminderSummary = specialDate ? "" : formatReminderSummary(ev);
  const typeLabel = specialEventLabel(ev);
  const showRecurring = ev.isRecurring && !typeLabel && !specialDate;

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

        <Motion.div
          layout
          transition={motion.layout}
          style={{
            display: specialDate ? "grid" : "flex",
            gridTemplateColumns: specialDate ? "32px minmax(0, 1fr)" : undefined,
            alignItems: specialDate ? "center" : undefined,
            flexDirection: specialDate ? undefined : "column",
            gap: specialDate ? 8 : 6,
            flexShrink: 0,
          }}
        >
          {specialDate ? (
            <GoogleSpecialDateBadge
              item={ev}
              color={accent}
              selected
              variant="detail"
            />
          ) : null}
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
          {!specialDate ? (
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
          ) : null}
        </Motion.div>

        {(durationLabel || ev.allDay || typeLabel || showRecurring || !editable || reminderSummary) ? (
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {durationLabel ? <RailMetaChip tone="quiet" compact>{durationLabel}</RailMetaChip> : null}
            {reminderSummary ? (
              <RailReminderIndicator compact>
                <Bell size={10} strokeWidth={2.2} />
                {reminderSummary}
              </RailReminderIndicator>
            ) : null}
            {typeLabel ? <RailMetaChip tone="quiet" compact>{typeLabel}</RailMetaChip> : null}
            {ev.allDay && !specialDate ? <RailMetaChip tone="quiet" compact>All day</RailMetaChip> : null}
            {showRecurring ? <RailMetaChip tone="quiet" compact>Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip tone="quiet" compact>Read-only</RailMetaChip> : null}
          </Motion.div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}

function EventSelectedActions({ ev, onEditEvent, compact = false, accent = "#89b4fa" }) {
  if (!ev) return null;
  if (isGoogleSpecialDateEvent(ev)) return null;
  const editable = isEditableEvent(ev);
  const zoomUrl = extractZoomMeetingUrl(ev);
  const eventUrl = extractNonZoomEventUrl(ev);
  const calendarUrl = calendarActionUrl(ev);
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
  if (isGoogleSpecialDateEvent(ev)) return false;
  return Boolean(isEditableEvent(ev) || extractZoomMeetingUrl(ev) || extractNonZoomEventUrl(ev) || calendarActionUrl(ev));
}

function toRailItem(ev, onSelectItem, selectedItemId) {
  const specialDate = isGoogleSpecialDateEvent(ev);
  const reminderSummary = specialDate ? "" : formatReminderSummary(ev);
  const typeLabel = specialEventLabel(ev);
  const meta = [
    specialDate ? null : eventMeta(ev),
    reminderSummary,
    typeLabel || (!specialDate && ev.isRecurring ? "Recurring" : null),
    !isEditableEvent(ev) && (ev.writable === false || typeLabel) ? "Read-only" : null,
  ].filter(Boolean).join(" · ");
  const selectionId = getPlanningItemId(ev);
  const isSelected = String(selectionId) === String(selectedItemId);

  if (isDeadlinePlanningItem(ev)) {
    const status = normalizeStatus(ev.status);
    return {
      id: selectionId,
      timeLabel: ev.due_time || "End of day",
      title: ev.title || ev.name || "Untitled",
      subtitle: ev.project_name || ev.class_name || "Deadline",
      meta: "",
      selected: isSelected,
      dotColor: deadlineAccentFor(ev),
      complete: status === "complete",
      trailing: <DeadlineTimelineStatus task={ev} />,
      onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
    };
  }

  return {
    id: selectionId,
    timeLabel: specialDate ? "" : ev.allDay ? "All day" : pacificTime(ev.startMs),
    title: sanitizeEventDisplayTitle(ev.title),
    subtitle: eventSubtitle(ev),
    meta,
    selected: isSelected,
    dotColor: specialDate ? googleSpecialDateAccent(ev) : ev.color || ev.sourceColor || "#4285f4",
    onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
  };
}

export function renderEventsDetail({
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
            accent={eventAccent(selectedEvent)}
            actions={hasEventActions(selectedEvent) ? (
              <EventSelectedActions
                ev={selectedEvent}
                onEditEvent={onEditEvent}
                compact
                accent={eventAccent(selectedEvent)}
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

export function renderEventsFloatingDetail({ items, selectedItemId, onEditEvent }) {
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
