/* eslint-disable react-refresh/only-export-components */
import { CheckCircle2, CircleDashed, ExternalLink, Pencil, Video } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import TimelineDetailRail from "../../TimelineDetailRail.tsx";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.tsx";
import { getEventSelectionId } from "../../../../lib/shell-helpers";
import { extractNonZoomEventUrl, extractZoomMeetingUrl } from "../../../../lib/calendar-links";
import { formatReminderSummary } from "../../reminderDisplay.ts";
import {
  getPlanningItemId,
  isDeadlinePlanningItem,
} from "./eventsPlanningModel.ts";
import { deadlineAccentFor, normalizeStatus, statusLabel } from "../deadlines/deadlinesModel.ts";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.ts";
import EventSelectedCard from "./EventSelectedCard.tsx";
import {
  calendarActionUrl,
  eventAccent,
  eventMeta,
  eventSubtitle,
  formatFullDate,
  isEditableEvent,
  orderDetailEvents,
  pacificTime,
  specialEventLabel,
} from "./eventDetailModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

interface TimelineRailItem {
  id: string | null;
  timeLabel: string;
  title: string;
  subtitle: string;
  meta: string;
  selected: boolean;
  dotColor: string;
  complete?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}
interface TimelineSection { id: string; label: string; items: TimelineRailItem[] }
interface TimelineDetailRailProps {
  eyebrow?: string;
  title: string;
  summary?: string;
  accent?: string;
  headerContent?: ReactNode;
  sections?: TimelineSection[];
}
interface RailActionProps {
  icon: LucideIcon;
  label: string;
  accent?: string;
  tone?: "default" | "ghost" | "accent" | "success";
  size?: "default" | "compact";
  href?: string | null;
  onClick?: () => void;
}
const TimelineDetailRailCompat = TimelineDetailRail as ComponentType<TimelineDetailRailProps>;
const RailActionCompat = RailAction as ComponentType<RailActionProps>;
const eventSelectionId = getEventSelectionId as unknown as (event: CalendarItemLike) => string | null;
const deadlineAccent = deadlineAccentFor as unknown as (task: CalendarItemLike) => string;

function DeadlineTimelineStatus({ task, compact = false }: { task: CalendarItemLike; compact?: boolean }) {
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

function EventSelectedActions({ ev, onEditEvent, compact = false, accent = "#89b4fa", hideEdit = false }: {
  ev: CalendarItemLike;
  onEditEvent?: (event: CalendarItemLike) => void;
  compact?: boolean;
  accent?: string;
  hideEdit?: boolean;
}) {
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
        <RailActionCompat
          icon={Video}
          label={compact ? "Join Zoom" : "Join Zoom meeting"}
          href={zoomUrl}
          accent={accent}
          tone="accent"
          size={size}
        />
      ) : null}
      {eventUrl ? (
        <RailActionCompat
          icon={ExternalLink}
          label="Open URL"
          href={eventUrl}
          accent={accent}
          tone={zoomUrl ? "ghost" : "accent"}
          size={size}
        />
      ) : null}
      {editable && !hideEdit ? (
        <RailActionCompat
          icon={Pencil}
          label="Edit details"
          onClick={() => onEditEvent?.(ev)}
          accent={accent}
          size={size}
        />
      ) : null}
      {calendarUrl ? (
        <RailActionCompat
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

function hasEventActions(ev: CalendarItemLike | null | undefined): boolean {
  if (!ev) return false;
  if (isGoogleSpecialDateEvent(ev)) return false;
  return Boolean(isEditableEvent(ev) || extractZoomMeetingUrl(ev) || extractNonZoomEventUrl(ev) || calendarActionUrl(ev));
}

function toRailItem(ev: CalendarItemLike, onSelectItem?: (itemId: string | null) => void, selectedItemId?: unknown): TimelineRailItem {
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
      dotColor: deadlineAccent(ev),
      complete: status === "complete",
      trailing: <DeadlineTimelineStatus task={ev} />,
      onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
    };
  }

  return {
    id: selectionId,
    timeLabel: specialDate ? "" : ev.allDay ? "All day" : (typeof ev.startMs === "number" ? pacificTime(ev.startMs) : ""),
    title: String(ev.title || "").trim() || "(No title)",
    subtitle: eventSubtitle(ev),
    meta,
    selected: isSelected,
    dotColor: specialDate ? googleSpecialDateAccent(ev) : ev.color || ev.sourceColor || "#4285f4",
    onClick: !isSelected && onSelectItem ? () => onSelectItem(selectionId) : undefined,
  };
}

export interface RenderEventsDetailProps {
  selectedDay: number;
  selectedDateKey?: string | null;
  viewYear: number;
  viewMonth: number;
  items: CalendarItemLike[];
  selectedItemId?: unknown;
  onSelectItem?: (itemId: string | null) => void;
  onEditEvent?: (event: CalendarItemLike) => void;
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
}: RenderEventsDetailProps) {
  const ordered = orderDetailEvents(items);
  const eventItems = ordered.filter((item) => !isDeadlinePlanningItem(item));
  const deadlineItems = ordered.filter(isDeadlinePlanningItem);
  const allDayItems: TimelineRailItem[] = [];
  const timedItems: TimelineRailItem[] = [];
  const deadlineRailItems: TimelineRailItem[] = [];
  let selectedEvent: CalendarItemLike | null = null;

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
    <TimelineDetailRailCompat
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

export function renderEventsFloatingDetail({ items, selectedItemId, onEditEvent, hideEdit = false }: {
  items: CalendarItemLike[];
  selectedItemId?: unknown;
  onEditEvent?: (event: CalendarItemLike) => void;
  hideEdit?: boolean;
}) {
  const ordered = orderDetailEvents(items);
  const selectedEvent = ordered.find((item) => (
    String(eventSelectionId(item)) === String(selectedItemId)
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
