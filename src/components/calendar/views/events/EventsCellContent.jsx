/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from "react";
import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { getCalendarCellCapacity, getVisibleCellItemCount } from "../../modal/calendarCellItemMetrics.js";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { dueDateToMs, getEventSelectionId } from "../../../../lib/shell-helpers";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.js";
import { formatTime12FromTime24 } from "../../ghostPreview.js";
import {
  SPAN_LANE_GAP,
  SPAN_LANE_HEIGHT,
  isPinnedCalendarGhost,
} from "../../modal/calendarEventSpanLayout.js";
import { toDeadlineGhostDescriptor } from "../deadlines/DeadlinesCellContent.jsx";
import {
  deadlinePlanningDescriptor,
  isDeadlinePlanningItem,
} from "./eventsPlanningModel.js";

const LG_EVENT_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_EVENT_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

const EMPTY_PINNED_IDS = new Set();

function computeEventChipMetrics(layout) {
  const tier = layout?.tier;
  const base = tier === "uhd" || tier === "xl" || tier === "lg" ? LG_EVENT_CHIP_METRICS : MD_EVENT_CHIP_METRICS;
  return {
    ...base,
    spanLaneHeight: SPAN_LANE_HEIGHT,
    spanLaneGap: SPAN_LANE_GAP,
    ...getCalendarCellCapacity(layout),
  };
}

// `layout` objects are frozen per-tier singletons (see calendarLayout.js), so a
// WeakMap keyed on the layout object identity gives every cell/render the same
// metrics object for the same tier — required for the descriptor-array memo
// below (and downstream chip memoization) to see a stable `metrics` identity.
const eventChipMetricsCache = new WeakMap();

export function resolveEventChipMetrics(layout) {
  if (!layout || typeof layout !== "object") return computeEventChipMetrics(layout);
  const cached = eventChipMetricsCache.get(layout);
  if (cached) return cached;
  const metrics = computeEventChipMetrics(layout);
  eventChipMetricsCache.set(layout, metrics);
  return metrics;
}

const MEETING_PROVIDER_PREFIX = /^\s*(?:\(|\[)?\s*(?:zoom|google meet|meet|teams|webex)(?:\)|\])?\s*[:-]?\s*/i;

function pacificTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function sanitizeEventDisplayTitle(value) {
  const title = String(value || "").trim();
  if (!title) return "(No title)";
  const cleaned = title.replace(MEETING_PROVIDER_PREFIX, "").trim();
  return cleaned || title;
}

function condenseLocationLabel(text, maxLength = 44) {
  const label = getLocationDisplayLabel(text);
  if (!label || label.length <= maxLength || label === "Zoom meeting") return label;
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;
  const firstTwo = parts.slice(0, 2).join(", ");
  if (firstTwo.length <= maxLength) return firstTwo;
  return parts[0] || label;
}

function eventDetail(ev) {
  if (ev.location) return condenseLocationLabel(ev.location);
  if (ev.attendees?.length) {
    return `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`;
  }
  return ev.subtitle || null;
}

function toEventDescriptor(ev) {
  const specialDate = isGoogleSpecialDateEvent(ev);
  const accent = specialDate ? googleSpecialDateAccent(ev) : ev?.color || ev?.sourceColor || "#4285f4";
  return {
    id: getEventSelectionId(ev),
    sourceItem: ev,
    sourceEvent: ev,
    writable: !!ev?.writable,
    recurring: specialDate ? false : !!ev?.isRecurring,
    title: sanitizeEventDisplayTitle(ev?.title),
    detail: eventDetail(ev),
    leadingLabel: specialDate ? "" : ev?.allDay ? "All day" : pacificTime(ev?.startMs),
    accent,
    leadingColor: specialDate ? accent : ev?.allDay ? (ev?.color || ev?.sourceColor || "rgba(205,214,244,0.7)") : ev?.color || ev?.sourceColor || "#89b4fa",
    allDay: !!ev?.allDay,
    sortMs: ev?.startMs || 0,
    specialDate,
    specialDateAccent: accent,
    hasUpcomingReminder: !!ev?.hasUpcomingReminder,
    upcomingReminderCount: ev?.upcomingReminderCount || 0,
    nextReminderAt: ev?.nextReminderAt || null,
    reminderState: ev?.reminderState || null,
  };
}

function toEventGhostDescriptor(ghost) {
  const accent = ghost.color || "#89b4fa";
  return {
    id: ghost.id,
    isGhost: true,
    ghostKind: "event",
    ghostStart: ghost.startDate,
    ghostEnd: ghost.endDate,
    title: sanitizeEventDisplayTitle(ghost.title),
    leadingLabel: ghost.allDay ? "All day" : formatTime12FromTime24(ghost.startTime),
    recurring: !!ghost.recurring,
    accent,
    leadingColor: ghost.allDay ? "rgba(205,214,244,0.7)" : accent,
    allDay: !!ghost.allDay,
    sortMs: ghost.startMs || dueDateToMs(ghost.startDate, ghost.startTime) || 0,
  };
}

function orderEventDescriptors(items) {
  return [...items].sort((a, b) => {
    if (!!a.complete !== !!b.complete) return a.complete ? 1 : -1;
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    if ((a.sortMs || 0) !== (b.sortMs || 0)) return (a.sortMs || 0) - (b.sortMs || 0);
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function getVisibleEventCount(itemCount, layout) {
  return getVisibleCellItemCount(itemCount, resolveEventChipMetrics(layout));
}

// Builds the ordered chip descriptor array inside useMemo so an untouched
// cell keeps the same array (and nested descriptor object) identities across
// re-renders it can't avoid (e.g. a sibling cell's selection/ghost change
// re-rendering the whole grid). Memoized with React.memo so it also skips
// rebuilding when its own inputs are unchanged. This boundary exists purely
// so the plain (hook-free) render*CellContents function below can still get
// useMemo's stability guarantee.
const EventsCellItems = memo(function EventsCellItems({
  day,
  dateKey,
  items,
  ghosts,
  pinnedIdsForDate,
  pinnedOverflowByDate,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  quickActions,
  pastTone,
  metrics,
  reservedLaneCount,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowAutoFocus,
  inlineOverflowVisibleCount,
  inlineOverflowExternal,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  onOverflowReanchorRequestHandled,
  overflowReanchorDateKey,
  suppressedSelectedHiddenAutoOpenKey,
}) {
  const descriptors = useMemo(() => {
    const singleDayEventGhosts = ghosts.filter((ghost) => (
      ghost?.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate && !isPinnedCalendarGhost(ghost)
    ));
    const singleDayDeadlineGhosts = ghosts.filter((ghost) => (
      ghost?.kind === "deadline" && ghost.startDate === dateKey
    ));
    return orderEventDescriptors([
      ...(items || [])
        .filter((item) => {
          if (isDeadlinePlanningItem(item)) return true;
          const eid = String(getEventSelectionId(item));
          if (!pinnedIdsForDate?.has?.(eid)) return true;
          return !!pinnedOverflowByDate?.[dateKey]?.has?.(eid);
        })
        .map((item) => (isDeadlinePlanningItem(item) ? deadlinePlanningDescriptor(item) : toEventDescriptor(item))),
      ...singleDayEventGhosts.map(toEventGhostDescriptor),
      ...singleDayDeadlineGhosts.map(toDeadlineGhostDescriptor),
    ]);
  }, [items, ghosts, dateKey, pinnedIdsForDate, pinnedOverflowByDate]);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStack
      day={day}
      dateKey={dateKey}
      items={descriptors}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      quickActions={quickActions}
      pastTone={pastTone}
      metrics={metrics}
      reservedLaneCount={reservedLaneCount}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowAutoFocus={inlineOverflowAutoFocus}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      inlineOverflowExternal={inlineOverflowExternal}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
      onOverflowReanchorRequestHandled={onOverflowReanchorRequestHandled}
      overflowReanchorDateKey={overflowReanchorDateKey}
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
    />
  );
});

export function renderEventsCellContents({
  items,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  quickActions,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowAutoFocus,
  inlineOverflowVisibleCount,
  inlineOverflowExternal,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  onOverflowReanchorRequestHandled,
  overflowReanchorDateKey,
  suppressedSelectedHiddenAutoOpenKey,
  layout,
  day,
  dateKey,
  ghosts = [],
  pinnedIds = null,
  pinnedIdsByDate = null,
  pinnedOverflowByDate = null,
  reservedLaneCount = 0,
}) {
  const pinnedIdsForDate = pinnedIdsByDate ? (pinnedIdsByDate[dateKey] || EMPTY_PINNED_IDS) : pinnedIds;

  return (
    <EventsCellItems
      day={day}
      dateKey={dateKey}
      items={items}
      ghosts={ghosts}
      pinnedIdsForDate={pinnedIdsForDate}
      pinnedOverflowByDate={pinnedOverflowByDate}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      quickActions={quickActions}
      pastTone={pastTone}
      metrics={resolveEventChipMetrics(layout)}
      reservedLaneCount={reservedLaneCount}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowAutoFocus={inlineOverflowAutoFocus}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      inlineOverflowExternal={inlineOverflowExternal}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
      onOverflowReanchorRequestHandled={onOverflowReanchorRequestHandled}
      overflowReanchorDateKey={overflowReanchorDateKey}
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
    />
  );
}
