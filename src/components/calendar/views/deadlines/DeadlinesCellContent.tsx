/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from "react";
import type { ComponentProps } from "react";
import CalendarCellItemStack from "../../modal/CalendarCellItemStack";
import { getCalendarCellCapacity } from "../../modal/calendarCellItemMetrics";
import { minutesFromDisplayTime } from "../../ghostPreview.ts";
import { dueDateToMs } from "../../../../lib/shell-helpers";
import {
  DEADLINE_COLOR,
  deadlineAccentFor,
  getDayState,
  getDeadlineSelectionId,
  statusLabel,
} from "./deadlinesModel.ts";
import type { CalendarChipItem, CalendarItemQuickActions } from "../../modal/CalendarCellItemChip";
import type { CalendarCellStackMetrics } from "../../modal/CalendarCellItemStackModel";
import type { CalendarLayoutTier } from "../../modal/calendarCellItemMetrics";
import type { DeadlineItem } from "./deadlinesModel";
import type { DeadlineQuickActions } from "./useDeadlineQuickActions";

interface DeadlineGhost extends DeadlineItem {
  id: string;
  kind: "deadline";
  startDate: string;
  endDate: string;
  dueTime?: string | null;
  dueMinutes?: number | null;
  recurring?: boolean;
}
interface DeadlineDescriptor extends CalendarChipItem {
  itemKind: "deadline";
  detailKind: "deadline";
  sortMinutes: number;
  completeSort: number;
  upcomingReminderCount?: number;
  nextReminderAt?: string | null;
  reminderState?: string | null;
  sortMs?: number;
}
type StackProps = ComponentProps<typeof CalendarCellItemStack>;
interface DeadlinesCellItemsProps extends Omit<StackProps, "items" | "metrics" | "quickActions" | "day"> {
  items: unknown;
  day?: number;
  ghosts?: DeadlineGhost[];
  metrics: CalendarCellStackMetrics;
  quickActions?: DeadlineQuickActions | null;
}
export interface RenderDeadlinesCellContentsProps extends Omit<DeadlinesCellItemsProps, "metrics"> {
  layout?: { tier?: string } | null;
}

const LG_DEADLINE_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_DEADLINE_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

function computeDeadlineChipMetrics(layout?: { tier?: string } | null): CalendarCellStackMetrics {
  const tier = layout?.tier;
  const base = tier === "xl" || tier === "lg" ? LG_DEADLINE_CHIP_METRICS : MD_DEADLINE_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout as { tier?: CalendarLayoutTier }),
  };
}

// `layout` objects are frozen per-tier singletons (see calendarLayout.ts), so a
// WeakMap keyed on the layout object identity gives every cell/render the same
// metrics object for the same tier.
const deadlineChipMetricsCache = new WeakMap<object, CalendarCellStackMetrics>();

export function resolveDeadlineChipMetrics(layout?: { tier?: string } | null): CalendarCellStackMetrics {
  if (!layout || typeof layout !== "object") return computeDeadlineChipMetrics(layout);
  const cached = deadlineChipMetricsCache.get(layout);
  if (cached) return cached;
  const metrics = computeDeadlineChipMetrics(layout);
  deadlineChipMetricsCache.set(layout, metrics);
  return metrics;
}

function toDeadlineDescriptor(task: DeadlineItem): DeadlineDescriptor {
  const accent = deadlineAccentFor(task, DEADLINE_COLOR);
  const timeLabel = task.due_time || "Deadline";

  return {
    id: getDeadlineSelectionId(task) || String(task.id || "deadline"),
    sourceItem: task as CalendarChipItem["sourceItem"],
    itemKind: "deadline",
    detailKind: "deadline",
    title: task.title || task.name || "Untitled",
    detail: [task.class_name || task.project_name, statusLabel(task.status)].filter(Boolean).join(" · "),
    leadingLabel: timeLabel,
    recurring: !!task.is_recurring,
    accent,
    leadingColor: accent,
    complete: task.status === "complete",
    quiet: task.status === "complete",
    sortMinutes: task.due_time ? (minutesFromDisplayTime(task.due_time) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY,
    completeSort: task.status === "complete" ? 1 : 0,
    hasUpcomingReminder: !!task.hasUpcomingReminder,
    upcomingReminderCount: task.upcomingReminderCount || 0,
    nextReminderAt: typeof task.nextReminderAt === "string" ? task.nextReminderAt : null,
    reminderState: typeof task.reminderState === "string" ? task.reminderState : null,
  };
}

export function toDeadlineGhostDescriptor(ghost: DeadlineGhost): DeadlineDescriptor {
  const accent = ghost.color || DEADLINE_COLOR;
  return {
    id: ghost.id,
    isGhost: true,
    itemKind: "deadline",
    detailKind: "deadline",
    ghostKind: "deadline",
    ghostStart: ghost.startDate,
    ghostEnd: ghost.endDate,
    title: ghost.title || "Untitled",
    leadingLabel: ghost.dueTime || "Deadline",
    recurring: !!(ghost.recurring || ghost.is_recurring),
    accent,
    leadingColor: accent,
    complete: false,
    sortMinutes: typeof ghost.dueMinutes === "number" && Number.isFinite(ghost.dueMinutes) ? ghost.dueMinutes : Number.POSITIVE_INFINITY,
    sortMs: dueDateToMs(ghost.startDate, ghost.dueTime) ?? Number.POSITIVE_INFINITY,
    completeSort: 0,
  };
}

function orderDeadlineDescriptors(items: DeadlineDescriptor[]): DeadlineDescriptor[] {
  return [...items].sort((a, b) => {
    if (a.completeSort !== b.completeSort) return a.completeSort - b.completeSort;
    if (a.sortMinutes !== b.sortMinutes) return a.sortMinutes - b.sortMinutes;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

// Builds the ordered chip descriptor array inside useMemo so an untouched
// cell keeps the same array/descriptor identities across re-renders it can't
// avoid (e.g. a sibling cell's selection change re-rendering the whole grid).
const DeadlinesCellItems = memo(function DeadlinesCellItems({
  day = 0,
  dateKey,
  items,
  ghosts = [],
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  pastTone,
  metrics,
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
  suppressedSelectedHiddenAutoOpenKey,
  quickActions,
}: DeadlinesCellItemsProps) {
  const descriptors = useMemo(() => {
    const state = getDayState(items);
    const singleDayGhosts = ghosts.filter((ghost) => (
      ghost?.kind === "deadline" && ghost.startDate === dateKey
    ));
    return orderDeadlineDescriptors([
      ...state.items.map(toDeadlineDescriptor),
      ...singleDayGhosts.map(toDeadlineGhostDescriptor),
    ]);
  }, [items, ghosts, dateKey]);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStack
      day={day}
      dateKey={dateKey}
      items={descriptors}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={metrics}
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
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
      quickActions={quickActions as unknown as CalendarItemQuickActions}
    />
  );
});

export function renderDeadlinesCellContents({
  items,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
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
  suppressedSelectedHiddenAutoOpenKey,
  quickActions,
  layout,
  day,
  dateKey,
  ghosts = [],
}: RenderDeadlinesCellContentsProps) {
  return (
    <DeadlinesCellItems
      day={day}
      dateKey={dateKey}
      items={items}
      ghosts={ghosts}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={resolveDeadlineChipMetrics(layout)}
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
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
      quickActions={quickActions}
    />
  );
}
