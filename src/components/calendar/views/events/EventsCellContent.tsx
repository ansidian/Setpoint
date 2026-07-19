/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from "react";
import type { ComponentProps, ComponentType } from "react";
import CalendarCellItemStack from "../../modal/CalendarCellItemStack";
import {
  createCalendarCellMetricsResolver,
  getCalendarCellCapacity,
  getVisibleCellItemCount,
} from "../../modal/calendarCellItemMetrics";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { dueDateToMs, getEventSelectionId } from "../../../../lib/shell-helpers";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.ts";
import { formatTime12FromTime24 } from "../../ghostPreview.ts";
import {
  SPAN_LANE_GAP,
  SPAN_LANE_HEIGHT,
  isPinnedCalendarGhost,
} from "../../modal/calendarEventSpanLayout";
import { toDeadlineGhostDescriptor } from "../deadlines/DeadlinesCellContent.tsx";
import {
  deadlinePlanningDescriptor,
  isDeadlinePlanningItem,
} from "./eventsPlanningModel.ts";
import type { CalendarChipItem, CalendarItemQuickActions } from "../../modal/CalendarCellItemChip";
import type { CalendarCellStackMetrics } from "../../modal/CalendarCellItemStackModel";
import type { CalendarGridLayout } from "../../modal/CalendarGrid";
import type { CalendarItemLike } from "../calendarViewTypes";

interface EventGhost extends CalendarItemLike {
  id: string;
  kind: "event" | "deadline";
  startDate: string;
  endDate: string;
  startTime?: string | null;
  recurring?: boolean;
}
interface EventChipDescriptor extends CalendarChipItem {
  sortMs: number;
  upcomingReminderCount?: number;
  nextReminderAt?: string | null;
}
type StackProps = ComponentProps<typeof CalendarCellItemStack>;
interface EventsCellItemsProps extends Omit<StackProps, "items" | "metrics"> {
  items: CalendarItemLike[];
  ghosts: EventGhost[];
  pinnedIdsForDate?: Set<string> | null;
  pinnedOverflowByDate?: Record<string, Set<string>> | null;
  metrics: CalendarCellStackMetrics;
  onOverflowReanchorRequestHandled?: () => void;
  overflowReanchorDateKey?: string | null;
}
export interface RenderEventsCellContentsProps extends Omit<EventsCellItemsProps, "metrics" | "pinnedIdsForDate" | "ghosts"> {
  layout?: CalendarGridLayout | null;
  ghosts?: EventGhost[];
  cellMeta?: unknown;
  pinnedIds?: Set<string> | null;
  pinnedIdsByDate?: Record<string, Set<string>> | null;
}
const CalendarCellItemStackCompat = CalendarCellItemStack as ComponentType<StackProps & {
  onOverflowReanchorRequestHandled?: () => void;
  overflowReanchorDateKey?: string | null;
}>;
const deadlineGhostDescriptor = toDeadlineGhostDescriptor as unknown as (ghost: EventGhost) => EventChipDescriptor;
const pinnedCalendarGhost = isPinnedCalendarGhost as unknown as (ghost: EventGhost) => boolean;
const planningDescriptor = deadlinePlanningDescriptor as unknown as (item: CalendarItemLike) => EventChipDescriptor;
const eventSelectionId = getEventSelectionId as unknown as (event: CalendarItemLike) => string | null;

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

const EMPTY_PINNED_IDS = new Set<string>();

type EventCellLayout = { tier?: string };

function computeEventChipMetrics(layout?: EventCellLayout | null): CalendarCellStackMetrics {
  const tier = layout?.tier;
  const base = tier === "uhd" || tier === "xl" || tier === "lg" ? LG_EVENT_CHIP_METRICS : MD_EVENT_CHIP_METRICS;
  return {
    ...base,
    spanLaneHeight: SPAN_LANE_HEIGHT,
    spanLaneGap: SPAN_LANE_GAP,
    ...getCalendarCellCapacity(layout as Parameters<typeof getCalendarCellCapacity>[0]),
  };
}

// Layouts are frozen per-tier singletons. Stable metric identity lets the
// descriptor-array and downstream chip memoization share the same boundary.
export const resolveEventChipMetrics = createCalendarCellMetricsResolver(computeEventChipMetrics);

const MEETING_PROVIDER_PREFIX = /^\s*(?:\(|\[)?\s*(?:zoom|google meet|meet|teams|webex)(?:\)|\])?\s*[:-]?\s*/i;

function pacificTime(ms: number | null | undefined): string {
  if (typeof ms !== "number") return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function sanitizeEventDisplayTitle(value: unknown): string {
  const title = String(value || "").trim();
  if (!title) return "(No title)";
  const cleaned = title.replace(MEETING_PROVIDER_PREFIX, "").trim();
  return cleaned || title;
}

function condenseLocationLabel(text: string, maxLength = 44): string {
  const label = getLocationDisplayLabel(text);
  if (!label || label.length <= maxLength || label === "Zoom meeting") return label;
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;
  const firstTwo = parts.slice(0, 2).join(", ");
  if (firstTwo.length <= maxLength) return firstTwo;
  return parts[0] || label;
}

function eventDetail(ev: CalendarItemLike): string | null {
  if (ev.location) return condenseLocationLabel(ev.location);
  if (ev.attendees?.length) {
    return `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`;
  }
  return ev.subtitle || null;
}

function toEventDescriptor(ev: CalendarItemLike): EventChipDescriptor {
  const specialDate = isGoogleSpecialDateEvent(ev);
  const accent = specialDate ? googleSpecialDateAccent(ev) : ev?.color || ev?.sourceColor || "#4285f4";
  return {
    id: eventSelectionId(ev) || String(ev.id || "event"),
    sourceItem: ev as CalendarChipItem["sourceItem"],
    sourceEvent: ev as CalendarChipItem["sourceEvent"],
    writable: !!ev?.writable,
    recurring: specialDate ? false : !!ev?.isRecurring,
    title: sanitizeEventDisplayTitle(ev?.title),
    detail: eventDetail(ev) || undefined,
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

function toEventGhostDescriptor(ghost: EventGhost): EventChipDescriptor {
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

function orderEventDescriptors(items: EventChipDescriptor[]): EventChipDescriptor[] {
  return [...items].sort((a, b) => {
    if (!!a.complete !== !!b.complete) return a.complete ? 1 : -1;
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    if ((a.sortMs || 0) !== (b.sortMs || 0)) return (a.sortMs || 0) - (b.sortMs || 0);
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function getVisibleEventCount(itemCount: number, layout?: EventCellLayout | null): number {
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
}: EventsCellItemsProps) {
  const descriptors = useMemo(() => {
    const singleDayEventGhosts = ghosts.filter((ghost) => (
      ghost?.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate && !pinnedCalendarGhost(ghost)
    ));
    const singleDayDeadlineGhosts = ghosts.filter((ghost) => (
      ghost?.kind === "deadline" && ghost.startDate === dateKey
    ));
    return orderEventDescriptors([
      ...(items || [])
        .filter((item) => {
          if (isDeadlinePlanningItem(item)) return true;
          const eid = String(eventSelectionId(item));
          if (!pinnedIdsForDate?.has?.(eid)) return true;
          return !!(dateKey && pinnedOverflowByDate?.[dateKey]?.has?.(eid));
        })
        .map((item) => (isDeadlinePlanningItem(item) ? planningDescriptor(item) : toEventDescriptor(item))),
      ...singleDayEventGhosts.map(toEventGhostDescriptor),
      ...singleDayDeadlineGhosts.map(deadlineGhostDescriptor),
    ]);
  }, [items, ghosts, dateKey, pinnedIdsForDate, pinnedOverflowByDate]);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStackCompat
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
}: RenderEventsCellContentsProps) {
  const pinnedIdsForDate = pinnedIdsByDate && dateKey ? (pinnedIdsByDate[dateKey] || EMPTY_PINNED_IDS) : pinnedIds;

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
