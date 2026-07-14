import { renderedRows } from "./calendarGridRowModel.js";

// How far (in months) the calendar can navigate away from the mount-time
// month. The grid's scroll span and the agenda's fetchable range must agree
// on this number, or programmatic jumps land where the agenda cannot follow.
export const NAVIGABLE_MONTH_RADIUS = 24;

export function monthBlockHeight({ year, month, cellHeight, gridGap, headerHeight = 0 }) {
  const rows = renderedRows(year, month);
  return rows * cellHeight + (rows - 1) * gridGap + headerHeight;
}

export function monthIndexToDate(index, referenceYear, referenceMonth) {
  const totalMonths = referenceYear * 12 + referenceMonth + index;
  return { year: Math.floor(totalMonths / 12), month: ((totalMonths % 12) + 12) % 12 };
}

export function dateToMonthIndex(year, month, referenceYear, referenceMonth) {
  return (year - referenceYear) * 12 + (month - referenceMonth);
}

export function clampCalendarMonthTarget({
  targetYear,
  targetMonth,
  currentYear,
  currentMonth,
  radius = NAVIGABLE_MONTH_RADIUS,
}) {
  const index = dateToMonthIndex(
    targetYear,
    targetMonth,
    currentYear,
    currentMonth,
  );
  const clampedIndex = Math.max(-radius, Math.min(radius, index));
  return monthIndexToDate(clampedIndex, currentYear, currentMonth);
}

export function visibleMonthIndices({ scrollOffset, containerHeight, getMonthHeight }) {
  const viewportEnd = scrollOffset + containerHeight;
  let first, last;

  if (scrollOffset >= 0) {
    let offset = 0;
    let i = 0;
    while (offset + getMonthHeight(i) <= scrollOffset) {
      offset += getMonthHeight(i);
      i++;
    }
    first = i;
    while (offset < viewportEnd) {
      last = i;
      offset += getMonthHeight(i);
      i++;
    }
  } else {
    let offset = 0;
    let i = -1;
    while (offset > scrollOffset) {
      offset -= getMonthHeight(i);
      i--;
    }
    first = i + 1;
    let fwdOffset = offset;
    for (let j = first; fwdOffset < viewportEnd; j++) {
      last = j;
      fwdOffset += getMonthHeight(j);
    }
  }

  return { first, last };
}

export function activeMonthIndex({ visibleIndices, scrollOffset, getMonthOffset }) {
  let active = visibleIndices.first;
  for (let i = visibleIndices.first; i <= visibleIndices.last; i++) {
    if (getMonthOffset(i) <= scrollOffset) active = i;
  }
  return active;
}

export const LABEL_MONTH_THRESHOLD = 1 / 3;

// Quiet window after the last scroll event before the grid announces where it
// settled (fetch anchor + trailing agenda sync + week-row alignment).
export const SCROLL_SETTLE_MS = 150;

// P3-11: shared keep-overflow-open window. A keep-overflow-open chip interaction
// in a child CalendarGrid triggers a programmatic alignment scroll; the parent
// CalendarScrollContainer's overflow-close dispatcher must skip that scroll so it
// does not dismiss the overflow the user just acted in. The interaction
// (markOverflowInteraction) and the scroll dispatcher live in sibling components
// with no shared ref, so the window is bridged through this module (already
// imported by both areas).

// How long after an overflow keep-open interaction a programmatic grid scroll
// must NOT dispatch calendar-overflow-close. Matches the per-grid
// ignoreOverflowScrollUntilRef window in useCalendarGridOverflow.js.
export const OVERFLOW_INTERACTION_IGNORE_MS = 220;

let overflowInteractionUntil = 0;

// Record a keep-overflow-open interaction; opens the ignore window.
export function markOverflowScrollIgnoreWindow(now = performance.now()) {
  overflowInteractionUntil = now + OVERFLOW_INTERACTION_IGNORE_MS;
}

// Pure predicate: should a programmatic grid scroll dispatch
// calendar-overflow-close? False while inside the keep-open window (a scroll
// the user's own interaction provoked); true otherwise. The escape/hotkey
// close path dispatches from a different site and is never routed through here,
// so escape always closes immediately.
export function shouldDispatchOverflowCloseOnScroll(now = performance.now()) {
  return now >= overflowInteractionUntil;
}

export function midpointActiveMonthIndex({ scrollOffset, containerHeight, getMonthOffset, searchFirst, searchLast, threshold = 0.5 }) {
  const point = scrollOffset + containerHeight * threshold;
  let active = searchFirst;
  for (let i = searchFirst; i <= searchLast; i++) {
    if (getMonthOffset(i) <= point) active = i;
    else break;
  }
  return active;
}

// Settle-time replacement for native CSS scroll snap. Native `y proximity`
// snapping fought Windows notch scrolling: Chromium filters wheel events that
// arrive while a snap animation is in flight, and the mounted-window swaps
// re-snap mid-gesture, so discrete-wheel scrolling kept dying until the
// animation landed. Aligning to the nearest week row only after the scroll
// settles keeps the EAD-276 resting alignment without ever competing with
// live input.
export function nearestWeekRowOffset({ scrollOffset, cellHeight, gridGap, getMonthOffset, getMonthHeight, searchFirst, searchLast }) {
  let containing = searchFirst;
  for (let i = searchFirst; i <= searchLast; i++) {
    if (getMonthOffset(i) <= scrollOffset) containing = i;
    else break;
  }
  const base = getMonthOffset(containing);
  const pitch = cellHeight + gridGap;
  // The block has no trailing gap, so its last row starts cellHeight (not a
  // full pitch) above the next month's start.
  const lastRowStart = base + getMonthHeight(containing) - cellHeight;
  const row = Math.max(0, Math.round((scrollOffset - base) / pitch));
  const withinMonth = Math.min(base + row * pitch, lastRowStart);
  const nextMonthStart = base + getMonthHeight(containing);
  return Math.abs(nextMonthStart - scrollOffset) < Math.abs(withinMonth - scrollOffset)
    ? nextMonthStart
    : withinMonth;
}

export function prefetchRange({ visibleFirst, visibleLast, scrollDirection }) {
  if (scrollDirection === "forward") {
    return { first: visibleFirst - 1, last: visibleLast + 4 };
  }
  if (scrollDirection === "backward") {
    return { first: visibleFirst - 4, last: visibleLast + 1 };
  }
  return { first: visibleFirst - 3, last: visibleLast + 3 };
}

export function mountedWindow(activeIndex) {
  return { first: activeIndex - 2, last: activeIndex + 2 };
}

export function deriveScrollDirection(previousIndex, currentIndex) {
  if (previousIndex == null || previousIndex === currentIndex) return "idle";
  return currentIndex > previousIndex ? "forward" : "backward";
}
