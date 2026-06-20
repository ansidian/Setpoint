import { dayBucket, eventState, pacificClock } from "../../../lib/shell-helpers";

// NOTE: literal hexes (not --sp-* tokens) because these values are consumed via
// `${color}NN` hex-alpha string concat in TimelineRow (e.g. `${color}1e`); a
// `var(--sp-*)NN` concat is invalid CSS. Same Scope-B carve-out as the inbox /
// calendar concat-fed color maps. Values equal --sp-rose / --sp-cream / --sp-blue.
export const PRIORITY_COLOR = {
  1: "#f38ba8",
  2: "#f9e2af",
  3: "#89b4fa",
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

/**
 * Decide whether to blank the timeline to skeletons instead of rendering groups.
 *
 * We only hold back on a genuine cold load (`empty_loading` = no seeded events
 * yet). While a warm refresh is in flight (`refreshing` = seeded events already
 * on screen) we keep the existing groups visible; blanking them there made the
 * timeline flash empty on every SSE refresh and on every return to the
 * dashboard, which reads as "the calendar stopped loading".
 */
export function shouldHoldPartialTimeline({ eventLoadingState, filtersEvents }) {
  return !!filtersEvents && eventLoadingState === "empty_loading";
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

/**
 * Fraction (0..1) of the way `nowMs` is through the [startMs, endMs) window.
 * Before the start -> 0, at/after the end -> 1, zero-length/inverted -> 0.
 * Drives the in-card live progress line on the today timeline.
 */
export function percentElapsed(startMs, endMs, nowMs) {
  const span = endMs - startMs;
  if (!(span > 0)) return 0;
  const raw = (nowMs - startMs) / span;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}

/**
 * Bare Pacific clock without the meridiem ("1:18"). pacificClock returns
 * "1:18 PM"; both now-marker labels drop the meridiem to match the mockup.
 */
export function formatNowMarkerClock(nowMs) {
  return pacificClock(new Date(nowMs)).split(" ")[0];
}

/**
 * "NOW 1:18 · 30% elapsed" — the in-card live marker label.
 */
export function formatNowMarkerLabel(nowMs, percent) {
  return `NOW ${formatNowMarkerClock(nowMs)} · ${Math.round(percent * 100)}% elapsed`;
}

/**
 * Where the standalone "NOW" marker sits among a today group's chronologically
 * sorted items — the focus-window marker shown when nothing is live. Returns the
 * insertion index (0..items.length) so it renders just before the next upcoming
 * item, or null when an event is currently live (the in-card progress line owns
 * the marker then) or the day has no items.
 */
export function resolveTodayNowMarkerIndex(items, now) {
  if (!items || items.length === 0) return null;
  const liveInCard = items.some(
    (it) => it.kind === "event"
      && !it.data?.allDay
      && it.startMs != null
      && it.endMs != null
      && eventState(it.data, now) === "live",
  );
  if (liveInCard) return null;
  let index = 0;
  for (const it of items) {
    const ms = it.startMs ?? it.dueAtMs;
    if (ms != null && ms <= now) index += 1;
    else break;
  }
  return index;
}

/**
 * Partition timeline items into today / tomorrow / rest-of-this-week for the
 * collapsible "Tomorrow" group and the "Rest of this week" count affordance.
 * Buckets: 0 = today, 1 = tomorrow, 2..6 = rest of this week (>6 is excluded).
 */
export function buildTodayTomorrowRestGroups(items, now, filters) {
  const groups = buildTimelineGroups(items, now, filters, { minDay: 0 });
  const byDay = new Map(groups);
  const today = byDay.get(0) ?? [];
  const tomorrow = byDay.get(1) ?? [];

  const tomorrowCount = { events: 0, deadlines: 0 };
  for (const it of tomorrow) {
    if (it.kind === "event") tomorrowCount.events += 1;
    else if (it.kind === "deadline") tomorrowCount.deadlines += 1;
  }

  // Keep the `[day, items]` shape from buildTimelineGroups so the disclosure can
  // render each rest-of-week day as its own TimelineDayGroup.
  const rest = groups.filter(([day]) => day >= 2 && day <= 6);
  const restCount = rest.reduce((sum, [, dayItems]) => sum + dayItems.length, 0);

  return { today, tomorrow, tomorrowCount, rest, restCount };
}

