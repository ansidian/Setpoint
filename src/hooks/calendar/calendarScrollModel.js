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

export function midpointActiveMonthIndex({ scrollOffset, containerHeight, getMonthOffset, searchFirst, searchLast, threshold = 0.5 }) {
  const point = scrollOffset + containerHeight * threshold;
  let active = searchFirst;
  for (let i = searchFirst; i <= searchLast; i++) {
    if (getMonthOffset(i) <= point) active = i;
    else break;
  }
  return active;
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
