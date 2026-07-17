import { getMonthData } from "../calendarDateUtils.ts";
import { monthIndexToDate } from "../../../hooks/calendar/calendarScrollModel";

// Months that do not start on Sunday render their leading cells from the
// previous month, so its events must ride along in the preview. Shared ids
// are deduped in favor of the current month's instance.
export interface CalendarPreviewEvent { id: unknown }

export interface CalendarDeadlineOverlay<T = unknown> {
  enabled: boolean;
  showCompleted: boolean;
  data?: T;
}

export interface CalendarMonthPreviewEntry<TEvent extends CalendarPreviewEvent = CalendarPreviewEvent, TDeadline = unknown> {
  events: TEvent[] | null;
  deadlineOverlay: CalendarDeadlineOverlay<TDeadline> | null;
}

interface CalendarMonthPreviewInputs<TEvent extends CalendarPreviewEvent, TDeadline> {
  curEvents: TEvent[] | null;
  prevEvents: TEvent[] | null;
  monthDeadlines: TDeadline | null;
  wrapsDeadlines: boolean;
  enabled?: boolean;
  showCompleted?: boolean;
  overlay?: CalendarDeadlineOverlay<TDeadline> | null;
}

export function mergeAdjacentEventLists<TEvent extends CalendarPreviewEvent>(currentMonthEvents: TEvent[] | null | undefined, previousMonthEvents: TEvent[] | null | undefined): TEvent[] | null {
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

function buildMonthDeadlineOverlay<TDeadline>(activeOverlay: CalendarDeadlineOverlay<TDeadline>, monthDeadlines: TDeadline | null): CalendarDeadlineOverlay<TDeadline> | null {
  if (!monthDeadlines) return null;
  return {
    enabled: activeOverlay.enabled,
    showCompleted: activeOverlay.showCompleted,
    data: monthDeadlines,
  };
}

// Inputs each entry was built from, so a later pass can tell whether the
// month's underlying data changed without deep comparison.
const entryInputs = new WeakMap<object, CalendarMonthPreviewInputs<CalendarPreviewEvent, unknown>>();

// Range caches hand back a fresh empty array for uncached months, so two
// empty results are the same input even when their identities differ.
export function sameEventList(a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): boolean {
  if (a === b) return true;
  return Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0;
}

function sameInputs<TEvent extends CalendarPreviewEvent, TDeadline>(prior: CalendarMonthPreviewEntry<TEvent, TDeadline> | null | undefined, inputs: CalendarMonthPreviewInputs<TEvent, TDeadline>): boolean {
  const recorded = prior && entryInputs.get(prior) as CalendarMonthPreviewInputs<TEvent, TDeadline> | undefined;
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
export interface MountedMonthData {
  viewData: unknown;
  itemsByDay: unknown;
  itemsByDate: unknown;
  cellMetaByDate: unknown;
}

export function resolveMountedMonthData({
  isActive,
  isCached,
  cached,
  active,
  shareItemsByDate = false,
  empty = {},
}: {
  isActive: boolean;
  isCached?: boolean | null;
  cached?: MountedMonthData | null;
  active: MountedMonthData;
  shareItemsByDate?: boolean;
  empty?: unknown;
}): MountedMonthData {
  if (isActive) return active;
  const base: MountedMonthData = isCached && cached
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
export function buildMonthPreviewEntries<TEvent extends CalendarPreviewEvent, TDeadline = unknown>({
  previous = null,
  first,
  last,
  refYear,
  refMonth,
  getMonthEvents = null,
  getMonthDeadlines = null,
  activeDeadlineOverlay = null,
}: {
  previous?: Map<number, CalendarMonthPreviewEntry<TEvent, TDeadline>> | null;
  first: number;
  last: number;
  refYear: number;
  refMonth: number;
  getMonthEvents?: ((year: number, month: number) => TEvent[] | null) | null;
  getMonthDeadlines?: ((year: number, month: number) => TDeadline | null) | null;
  activeDeadlineOverlay?: CalendarDeadlineOverlay<TDeadline> | null;
}): Map<number, CalendarMonthPreviewEntry<TEvent, TDeadline>> {
  const next = new Map<number, CalendarMonthPreviewEntry<TEvent, TDeadline>>();
  for (let i = first; i <= last; i++) {
    const { year, month } = monthIndexToDate(i, refYear, refMonth);
    const { firstDay } = getMonthData(year, month);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const curEvents = getMonthEvents ? getMonthEvents(year, month) : null;
    const prevEvents = getMonthEvents && firstDay > 0 ? getMonthEvents(prevYear, prevMonth) : null;
    const wrapsDeadlines = !!(getMonthDeadlines && activeDeadlineOverlay?.enabled);
    const monthDeadlines = wrapsDeadlines ? getMonthDeadlines(year, month) : null;
    const inputs: CalendarMonthPreviewInputs<TEvent, TDeadline> = {
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
    entryInputs.set(entry, inputs as CalendarMonthPreviewInputs<CalendarPreviewEvent, unknown>);
    next.set(i, entry);
  }
  return next;
}
