import { monthKey, monthIndex, keyFromMonthIndex } from "./calendarRangeModel.js";
import { NAVIGABLE_MONTH_RADIUS } from "./calendarScrollModel.js";

const INITIAL_RADIUS = 2;
const FETCH_BATCH = 3;
const JUMP_RADIUS = 1;
// How many months to keep loaded on each side of the anchor (topmost) month.
// Must stay comfortably above the prefetch threshold plus batch size so a
// prune never re-triggers a fetch of the months it just dropped.
export const AGENDA_KEEP_RADIUS = 5;

export function agendaMonthRange(todayKey) {
  const [year, monthStr] = todayKey.split("-").map(Number);
  const todayIdx = monthIndex(monthKey(year, monthStr - 1));
  const startIdx = todayIdx - NAVIGABLE_MONTH_RADIUS;
  const endIdx = todayIdx + NAVIGABLE_MONTH_RADIUS;
  const months = [];
  for (let i = startIdx; i <= endIdx; i++) {
    months.push(keyFromMonthIndex(i));
  }
  return {
    startKey: months[0],
    endKey: months[months.length - 1],
    months,
  };
}

export function initialAgendaMonths(todayKey) {
  const range = agendaMonthRange(todayKey);
  const [year, monthStr] = todayKey.split("-").map(Number);
  const todayMk = monthKey(year, monthStr - 1);
  const todayIdx = range.months.indexOf(todayMk);
  const start = Math.max(0, todayIdx - INITIAL_RADIUS);
  const end = Math.min(range.months.length - 1, todayIdx + INITIAL_RADIUS);
  return range.months.slice(start, end + 1);
}

export function computeAgendaFetchPlan({
  topmostMonth,
  loadedMonths,
  totalRange,
  threshold = 2,
}) {
  const empty = { needed: [], direction: null };
  if (!topmostMonth || !loadedMonths.length || !totalRange?.months?.length) {
    return empty;
  }

  const loadedSet = new Set(loadedMonths);
  const allMonths = totalRange.months;

  const topmostIdx = allMonths.indexOf(topmostMonth);
  if (topmostIdx === -1) return empty;

  const loadedIdxes = loadedMonths
    .map((m) => allMonths.indexOf(m))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  const loadedFirst = loadedIdxes[0];
  const loadedLast = loadedIdxes[loadedIdxes.length - 1];

  const fromStart = topmostIdx - loadedFirst;
  const fromEnd = loadedLast - topmostIdx;

  const nearStart = fromStart < threshold;
  const nearEnd = fromEnd < threshold;

  if (!nearStart && !nearEnd) return empty;

  let direction = null;
  let candidates = [];

  if (nearEnd && (!nearStart || fromEnd <= fromStart)) {
    direction = "forward";
    for (let i = loadedLast + 1; i < allMonths.length && candidates.length < FETCH_BATCH; i++) {
      if (!loadedSet.has(allMonths[i])) candidates.push(allMonths[i]);
    }
  } else {
    direction = "backward";
    for (let i = loadedFirst - 1; i >= 0 && candidates.length < FETCH_BATCH; i--) {
      if (!loadedSet.has(allMonths[i])) candidates.push(allMonths[i]);
    }
    candidates.reverse();
  }

  if (!candidates.length) return empty;
  return { needed: candidates, direction };
}

// Surface the month a scroll command needs mounted, so the fetch pipeline
// can load it and let the command land. Date-targeted commands carry it
// directly; today commands resolve through todayKey.
export function scrollCommandTargetMonth(scrollCommand, todayKey) {
  if (!scrollCommand) return null;
  if (scrollCommand.dateKey) return String(scrollCommand.dateKey).slice(0, 7);
  if (scrollCommand.type === "today" && todayKey) return String(todayKey).slice(0, 7);
  return null;
}

// Continuous scrolling extends the loaded window without bound, and the rail
// renders every loaded month on each rebuild — cost grows with distance
// scrolled. Drop months farther than keepRadius from the anchor; the range
// caches keep their data, so re-entering a pruned month is a cheap re-add.
// Returns the input array by reference when nothing is pruned so callers can
// use identity to skip state updates.
export function pruneAgendaMonths({
  anchorMonth,
  loadedMonths = [],
  keepRadius = AGENDA_KEEP_RADIUS,
}) {
  if (!anchorMonth || !loadedMonths.length) return loadedMonths;
  const anchorIdx = monthIndex(anchorMonth);
  const kept = loadedMonths.filter((m) => Math.abs(monthIndex(m) - anchorIdx) <= keepRadius);
  // An anchor far outside the window is a stale signal (e.g. topmost not yet
  // caught up after a jump); never prune the window down to nothing.
  if (!kept.length) return loadedMonths;
  return kept.length === loadedMonths.length ? loadedMonths : kept;
}

// Plan for an explicit scroll/navigation target (month picker, prev/next,
// grid-driven sync), as opposed to passive edge prefetch. Close targets
// extend the loaded window contiguously; far targets reset it to a small
// window around the target so the rail never renders a hidden seam.
export function computeAgendaJumpPlan({
  targetMonth,
  loadedMonths = [],
  totalRange,
  reach = FETCH_BATCH,
  radius = JUMP_RADIUS,
}) {
  const empty = { needed: [], reset: false };
  if (!targetMonth || !totalRange?.months?.length) return empty;

  const allMonths = totalRange.months;
  let targetIdx = allMonths.indexOf(targetMonth);
  if (targetIdx === -1) {
    targetIdx = targetMonth < allMonths[0] ? 0 : allMonths.length - 1;
  }

  const resetWindow = () => {
    const start = Math.max(0, targetIdx - radius);
    const end = Math.min(allMonths.length - 1, targetIdx + radius);
    return { needed: allMonths.slice(start, end + 1), reset: true };
  };

  if (!loadedMonths.length) return resetWindow();
  if (loadedMonths.includes(allMonths[targetIdx])) return empty;

  const loadedIdxes = loadedMonths
    .map((m) => allMonths.indexOf(m))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (!loadedIdxes.length) return resetWindow();

  const loadedFirst = loadedIdxes[0];
  const loadedLast = loadedIdxes[loadedIdxes.length - 1];

  if (targetIdx > loadedLast && targetIdx - loadedLast <= reach) {
    return { needed: allMonths.slice(loadedLast + 1, targetIdx + 1), reset: false };
  }
  if (targetIdx < loadedFirst && loadedFirst - targetIdx <= reach) {
    return { needed: allMonths.slice(targetIdx, loadedFirst), reset: false };
  }
  return resetWindow();
}
