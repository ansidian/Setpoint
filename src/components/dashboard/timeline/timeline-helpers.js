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

export function formatFullDateForOffset(offset, now) {
  const date = new Date(now + offset * 86400000);
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function buildTimelineGroups(items, now, filters) {
  const groups = new Map();
  for (const item of items) {
    const ms = item.startMs ?? item.dueAtMs;
    const bucket = dayBucket(ms, now);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(item);
  }
  if (filters.events && !filters.deadlines && !groups.has(0)) {
    groups.set(0, []);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}
