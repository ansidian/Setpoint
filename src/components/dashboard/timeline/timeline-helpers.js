import { dayBucket } from "../../../lib/redesign-helpers";

export const PRIORITY_COLOR = {
  1: "#f38ba8",
  2: "#f9e2af",
  3: "#89b4fa",
};

export const DEADLINE_SOURCE_COLORS = {
  canvas: "#5A8FBF",
  manual: "#5A8FBF",
  todoist: "#E9776A",
};

export const timelineSettleTransition = {
  type: "spring",
  stiffness: 290,
  damping: 32,
  mass: 0.98,
  bounce: 0,
};

export const GUTTER = 130;
export const SPINE_LEFT = GUTTER - 16;
export const PILL_SPINE_GAP = 16;
export const MOBILE_GUTTER = 30;
export const MOBILE_SPINE_LEFT = 6;
export const NOW_MARKER_EDGE_INSET = 14;

export function formatFullDateForOffset(offset, now) {
  const date = new Date(now + offset * 86400000);
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function buildTimelineGroups(items, now, filters, { minDay = null } = {}) {
  const groups = new Map();
  for (const item of items) {
    const ms = item.startMs ?? item.dueAtMs;
    const bucket = dayBucket(ms, now);
    if (minDay != null && bucket < minDay) continue;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(item);
  }
  if ((filters.events || filters.deadlines) && !groups.has(0)) {
    groups.set(0, []);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function clampNowMarkerTop(top, edgeInset = NOW_MARKER_EDGE_INSET) {
  return Math.max(edgeInset, top);
}

export function resolveTimelineNowMarkerTop({
  items,
  now,
  rows,
  edgeInset = NOW_MARKER_EDGE_INSET,
}) {
  if (!items.length) return edgeInset;

  let liveIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "event") continue;
    if (item.data?.allDay) continue;
    if (item.startMs != null && item.endMs != null && item.startMs <= now && now < item.endMs) {
      liveIndex = index;
      break;
    }
  }

  if (liveIndex >= 0 && rows[liveIndex]) {
    const row = rows[liveIndex];
    const item = items[liveIndex];
    const progress = (now - item.startMs) / (item.endMs - item.startMs);
    return clampNowMarkerTop(row.offsetTop + progress * row.offsetHeight, edgeInset);
  }

  let firstFutureIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const ms = items[index].startMs ?? items[index].dueAtMs;
    if (ms != null && ms > now) {
      firstFutureIndex = index;
      break;
    }
  }

  if (firstFutureIndex === 0) return edgeInset;

  if (firstFutureIndex > 0 && rows[firstFutureIndex - 1]) {
    const previousRow = rows[firstFutureIndex - 1];
    return clampNowMarkerTop(previousRow.offsetTop + previousRow.offsetHeight + 2, edgeInset);
  }

  const lastIndex = items.length - 1;
  if (rows[lastIndex]) {
    const lastRow = rows[lastIndex];
    return clampNowMarkerTop(lastRow.offsetTop + lastRow.offsetHeight + 2, edgeInset);
  }

  return edgeInset;
}
