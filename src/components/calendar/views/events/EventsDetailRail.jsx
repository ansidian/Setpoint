/* eslint-disable react-refresh/only-export-components */
import { CheckCircle2, CircleDashed, ExternalLink, Pencil, Video } from "lucide-react";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.jsx";
import { getEventSelectionId } from "../../../../lib/shell-helpers";
import { extractNonZoomEventUrl, extractZoomMeetingUrl } from "../../../../lib/calendar-links";
import { formatReminderSummary } from "../../reminderDisplay.js";
import {
  getPlanningItemId,
  isDeadlinePlanningItem,
  orderPlanningItems,
} from "./eventsPlanningModel.js";
import { deadlineAccentFor, normalizeStatus, statusLabel } from "../deadlines/deadlinesModel.js";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.js";
import EventSelectedCard from "./EventSelectedCard.jsx";
import {
  calendarActionUrl,
  eventAccent,
  eventMeta,
  eventSubtitle,
  formatFullDate,
  isEditableEvent,
  pacificTime,
  sanitizeEventDisplayTitle,
  specialEventLabel,
} from "./eventDetailModel.js";

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

function DeadlineTimelineStatus({ task, compact = false }) {
  const status = normalizeStatus(task?.status);
  if (status !== "complete" && status !== "in_progress") return null;
  const Icon = status === "complete" ? CheckCircle2 : CircleDashed;
  const color = status === "complete" ? "var(--sp-green)" : "var(--sp-cyan)";

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

function EventSelectedActions({ ev, onEditEvent, compact = false, accent = "#89b4fa", hideEdit = false }) {
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
      {editable && !hideEdit ? (
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

export function renderEventsFloatingDetail({ items, selectedItemId, onEditEvent, hideEdit = false }) {
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
          hideEdit={hideEdit}
        />
      ) : null}
    />
  );
}
