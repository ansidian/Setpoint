import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { getCalendarCellCapacity, getVisibleCellItemCount } from "../../modal/calendarCellItemMetrics.js";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { getEventSelectionId } from "../../../../lib/redesign-helpers";
import { formatTime12FromTime24 } from "../../ghostPreview.js";

const LG_EVENT_CHIP_METRICS = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_EVENT_CHIP_METRICS = {
  itemHeight: 28,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

function resolveEventChipMetrics(layout) {
  const tier = layout?.tier;
  const base = tier === "uhd" || tier === "xl" || tier === "lg" ? LG_EVENT_CHIP_METRICS : MD_EVENT_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout),
  };
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
  return {
    id: getEventSelectionId(ev),
    sourceItem: ev,
    sourceEvent: ev,
    writable: !!ev?.writable,
    recurring: !!ev?.isRecurring,
    title: sanitizeEventDisplayTitle(ev?.title),
    detail: eventDetail(ev),
    leadingLabel: ev?.allDay ? "All day" : pacificTime(ev?.startMs),
    accent: ev?.color || ev?.sourceColor || "#4285f4",
    leadingColor: ev?.allDay ? "rgba(205,214,244,0.7)" : ev?.color || ev?.sourceColor || "#89b4fa",
    allDay: !!ev?.allDay,
    sortMs: ev?.startMs || 0,
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
    accent,
    leadingColor: ghost.allDay ? "rgba(205,214,244,0.7)" : accent,
    allDay: !!ghost.allDay,
    sortMs: ghost.startMs || 0,
  };
}

function orderEventDescriptors(items) {
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if ((a.sortMs || 0) !== (b.sortMs || 0)) return (a.sortMs || 0) - (b.sortMs || 0);
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function getVisibleEventCount(itemCount, layout) {
  return getVisibleCellItemCount(itemCount, resolveEventChipMetrics(layout));
}

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
  inlineOverflowVisibleCount,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onBeforeItemAction,
  layout,
  day,
  dateKey,
  ghosts = [],
}) {
  const singleDayGhosts = ghosts.filter((ghost) => (
    ghost?.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate
  ));
  if (!items?.length && !singleDayGhosts.length) return null;
  const descriptors = orderEventDescriptors([
    ...(items || []).map(toEventDescriptor),
    ...singleDayGhosts.map(toEventGhostDescriptor),
  ]);

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
      metrics={resolveEventChipMetrics(layout)}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onBeforeItemAction={onBeforeItemAction}
    />
  );
}
