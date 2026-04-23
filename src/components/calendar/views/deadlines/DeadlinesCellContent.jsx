import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { getDayState, SOURCE_COLORS, sourceLabelFor, sourceOf, statusLabel } from "./deadlinesModel.js";

const LG_DEADLINE_CHIP_METRICS = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_DEADLINE_CHIP_METRICS = {
  itemHeight: 28,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

function resolveDeadlineChipMetrics(layout) {
  const tier = layout?.tier;
  if (tier === "xl" || tier === "lg") return LG_DEADLINE_CHIP_METRICS;
  return MD_DEADLINE_CHIP_METRICS;
}

function toDeadlineDescriptor(task) {
  const source = sourceOf(task);
  const accent = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";
  const timeLabel = task.due_time || sourceLabelFor(task);

  return {
    id: String(task.id),
    title: task.title || task.name || "Untitled",
    detail: [task.class_name || task.project_name, statusLabel(task.status)].filter(Boolean).join(" · "),
    leadingLabel: timeLabel,
    accent,
    leadingColor: accent,
    complete: task.status === "complete",
    quiet: task.status === "complete",
  };
}

export function renderDeadlinesCellContents({
  items,
  contentHeight,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  overflowOpen,
  layout,
  day,
}) {
  const state = getDayState(items);
  const descriptors = state.items.map(toDeadlineDescriptor);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStack
      day={day}
      items={descriptors}
      contentHeight={contentHeight}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={resolveDeadlineChipMetrics(layout)}
      overflowOpen={overflowOpen}
    />
  );
}
