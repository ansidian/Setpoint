import { getMonthData } from "../calendarDateUtils.js";
import { monthIndexToDate } from "../../../hooks/calendar/calendarScrollModel.js";

// Months that do not start on Sunday render their leading cells from the
// previous month, so its events must ride along in the preview. Shared ids
// are deduped in favor of the current month's instance.
export function mergeAdjacentEventLists(currentMonthEvents, previousMonthEvents) {
  const current = currentMonthEvents || [];
  if (previousMonthEvents == null) return current.length ? current : null;
  if (!previousMonthEvents.length) return current.length ? current : null;
  if (!current.length) return previousMonthEvents;
  const seen = new Set(current.map((event) => event.id));
  const merged = [...current];
  for (const event of previousMonthEvents) {
    if (!seen.has(event.id)) merged.push(event);
  }
  return merged;
}

function buildMonthDeadlineOverlay(activeOverlay, monthDeadlines) {
  if (!monthDeadlines) return null;
  return {
    enabled: activeOverlay.enabled,
    showCompleted: activeOverlay.showCompleted,
    data: monthDeadlines,
  };
}

// Inputs each entry was built from, so a later pass can tell whether the
// month's underlying data changed without deep comparison.
const entryInputs = new WeakMap();

// Range caches hand back a fresh empty array for uncached months, so two
// empty results are the same input even when their identities differ.
export function sameEventList(a, b) {
  if (a === b) return true;
  return Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0;
}

function sameInputs(prior, inputs) {
  const recorded = prior && entryInputs.get(prior);
  if (!recorded) return false;
  if (!sameEventList(recorded.curEvents, inputs.curEvents)) return false;
  if (!sameEventList(recorded.prevEvents, inputs.prevEvents)) return false;
  if (recorded.monthDeadlines !== inputs.monthDeadlines) return false;
  if (recorded.wrapsDeadlines !== inputs.wrapsDeadlines) return false;
  if (inputs.wrapsDeadlines) {
    return recorded.enabled === inputs.enabled && recorded.showCompleted === inputs.showCompleted;
  }
  return recorded.overlay === inputs.overlay;
}

// Resolves the four data props one mounted month block hands to its CalendarGrid.
// The active month gets the live computed data; the one-deep cached month reuses
// its last snapshot; every other mounted month renders empty — EXCEPT when the
// active view's itemsByDate is month-agnostic. Bills expand their whole fetched
// range into a single date-keyed map (unlike events, which are windowed per
// month), so every mounted month shares that map; without it, chips vanish once
// the viewport scrolls past the active + cached pair.
export function resolveMountedMonthData({
  isActive,
  isCached,
  cached,
  active,
  shareItemsByDate = false,
  empty = {},
}) {
  if (isActive) return active;
  const base = isCached && cached
    ? {
        viewData: cached.viewData,
        itemsByDay: cached.itemsByDay,
        itemsByDate: cached.itemsByDate,
        cellMetaByDate: cached.cellMetaByDate,
      }
    : { viewData: null, itemsByDay: empty, itemsByDate: empty, cellMetaByDate: empty };
  if (shareItemsByDate) base.itemsByDate = active.itemsByDate;
  return base;
}

// Builds the preview entry map for the mounted month window, reusing entries
// from `previous` when a month's inputs are identity-unchanged. Entry field
// identity is what keeps the memoized month grids from re-rendering on every
// window shift or unrelated data revision.
export function buildMonthPreviewEntries({
  previous = null,
  first,
  last,
  refYear,
  refMonth,
  getMonthEvents = null,
  getMonthDeadlines = null,
  activeDeadlineOverlay = null,
}) {
  const next = new Map();
  for (let i = first; i <= last; i++) {
    const { year, month } = monthIndexToDate(i, refYear, refMonth);
    const { firstDay } = getMonthData(year, month);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const curEvents = getMonthEvents ? getMonthEvents(year, month) : null;
    const prevEvents = getMonthEvents && firstDay > 0 ? getMonthEvents(prevYear, prevMonth) : null;
    const wrapsDeadlines = !!(getMonthDeadlines && activeDeadlineOverlay?.enabled);
    const monthDeadlines = wrapsDeadlines ? getMonthDeadlines(year, month) : null;
    const inputs = {
      curEvents,
      prevEvents,
      monthDeadlines,
      wrapsDeadlines,
      enabled: wrapsDeadlines ? activeDeadlineOverlay.enabled : undefined,
      showCompleted: wrapsDeadlines ? activeDeadlineOverlay.showCompleted : undefined,
      overlay: wrapsDeadlines ? undefined : activeDeadlineOverlay,
    };

    const prior = previous?.get(i);
    if (prior && sameInputs(prior, inputs)) {
      next.set(i, prior);
      continue;
    }

    const entry = {
      events: getMonthEvents ? mergeAdjacentEventLists(curEvents, prevEvents) : null,
      deadlineOverlay: wrapsDeadlines
        ? buildMonthDeadlineOverlay(activeDeadlineOverlay, monthDeadlines)
        : activeDeadlineOverlay,
    };
    entryInputs.set(entry, inputs);
    next.set(i, entry);
  }
  return next;
}
