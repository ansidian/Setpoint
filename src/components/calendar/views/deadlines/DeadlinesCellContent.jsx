import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { getCalendarCellCapacity } from "../../modal/calendarCellItemMetrics.js";
import { minutesFromDisplayTime } from "../../ghostPreview.js";
import { getDayState, getDeadlineSelectionId, SOURCE_COLORS, sourceLabelFor, sourceOf, statusLabel } from "./deadlinesModel.js";

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

function resolveDeadlineChipMetrics(layout) {
  const tier = layout?.tier;
  const base = tier === "xl" || tier === "lg" ? LG_DEADLINE_CHIP_METRICS : MD_DEADLINE_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout),
  };
}

function toDeadlineDescriptor(task) {
  const source = sourceOf(task);
  const accent = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";
  const timeLabel = task.due_time || sourceLabelFor(task);

  return {
    id: getDeadlineSelectionId(task),
    sourceItem: task,
    title: task.title || task.name || "Untitled",
    detail: [task.class_name || task.project_name, statusLabel(task.status)].filter(Boolean).join(" · "),
    leadingLabel: timeLabel,
    recurring: source === "todoist" && !!task.is_recurring,
    accent,
    leadingColor: accent,
    complete: task.status === "complete",
    quiet: task.status === "complete",
    sortMinutes: task.due_time ? minutesFromDisplayTime(task.due_time) : Number.POSITIVE_INFINITY,
    completeSort: task.status === "complete" ? 1 : 0,
  };
}

function toDeadlineGhostDescriptor(ghost) {
  const source = ghost.source || "todoist";
  const accent = SOURCE_COLORS[source] || ghost.color || "#89b4fa";
  return {
    id: ghost.id,
    isGhost: true,
    ghostKind: "deadline",
    ghostStart: ghost.startDate,
    ghostEnd: ghost.endDate,
    title: ghost.title || "Untitled",
    leadingLabel: ghost.dueTime || sourceLabelFor({ source }),
    recurring: source === "todoist" && !!(ghost.recurring || ghost.is_recurring),
    accent,
    leadingColor: accent,
    sortMinutes: Number.isFinite(ghost.dueMinutes) ? ghost.dueMinutes : Number.POSITIVE_INFINITY,
    completeSort: 0,
  };
}

function orderDeadlineDescriptors(items) {
  return [...items].sort((a, b) => {
    if (a.completeSort !== b.completeSort) return a.completeSort - b.completeSort;
    if (a.sortMinutes !== b.sortMinutes) return a.sortMinutes - b.sortMinutes;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function renderDeadlinesCellContents({
  items,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowVisibleCount,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  quickActions,
  layout,
  day,
  dateKey,
  ghosts = [],
}) {
  const state = getDayState(items);
  const singleDayGhosts = ghosts.filter((ghost) => (
    ghost?.kind === "deadline" && ghost.startDate === dateKey
  ));
  const descriptors = orderDeadlineDescriptors([
    ...state.items.map(toDeadlineDescriptor),
    ...singleDayGhosts.map(toDeadlineGhostDescriptor),
  ]);

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
      metrics={resolveDeadlineChipMetrics(layout)}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
      quickActions={quickActions}
    />
  );
}
