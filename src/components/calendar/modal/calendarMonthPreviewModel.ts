import { getMonthData } from "../calendarDateUtils.ts";
import { monthIndexToDate } from "../../../hooks/calendar/calendarScrollModel";

// Months that do not start on Sunday render their leading cells from the
// previous month, so its events and deadlines must ride along in the preview.
// Shared identities are deduped in favor of the current month's instance.
export interface CalendarPreviewEvent {
  id?: unknown;
  originalStartTime?: unknown;
}

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
  prevMonthDeadlines: TDeadline | null;
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
  const identity = (event: TEvent) => event.originalStartTime
    ? `${String(event.id)}::${String(event.originalStartTime)}`
    : String(event.id);
  const seen = new Set(current.map(identity));
  const merged = [...current];
  let added = false;
  for (const event of previousMonthEvents) {
    const key = identity(event);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
      added = true;
    }
  }
  return added ? merged : currentMonthEvents ?? null;
}

interface CalendarPreviewDeadlineItem {
  id?: unknown;
  todoist_id?: unknown;
  url?: unknown;
  title?: unknown;
  due_date?: unknown;
  dueDate?: unknown;
  date?: unknown;
}

interface CalendarPreviewDeadlineData {
  upcoming?: CalendarPreviewDeadlineItem[];
}

function deadlineIdentity(item: CalendarPreviewDeadlineItem): string {
  const id = item.id ?? item.todoist_id ?? item.url ?? item.title;
  const dueDate = item.due_date ?? item.dueDate ?? item.date;
  return `${id ?? ""}:${dueDate ?? ""}`;
}

export function mergeAdjacentDeadlineData<TDeadline>(
  currentMonthDeadlines: TDeadline | null | undefined,
  previousMonthDeadlines: TDeadline | null | undefined,
): TDeadline | null {
  if (previousMonthDeadlines == null) return currentMonthDeadlines ?? null;
  if (currentMonthDeadlines == null) return previousMonthDeadlines;

  const current = currentMonthDeadlines as CalendarPreviewDeadlineData;
  const previous = previousMonthDeadlines as CalendarPreviewDeadlineData;
  if (!Array.isArray(current.upcoming) || !Array.isArray(previous.upcoming)) {
    return currentMonthDeadlines;
  }
  if (!previous.upcoming.length) return currentMonthDeadlines;

  const seen = new Set(current.upcoming.map(deadlineIdentity));
  const upcoming = [...current.upcoming];
  let added = false;
  for (const deadline of previous.upcoming) {
    const identity = deadlineIdentity(deadline);
    if (!seen.has(identity)) {
      seen.add(identity);
      upcoming.push(deadline);
      added = true;
    }
  }
  if (!added) return currentMonthDeadlines;
  return {
    ...current,
    upcoming,
  } as TDeadline;
}

export function buildCalendarMonthPreviewComputed<TEvent extends CalendarPreviewEvent, TDeadline, TComputed>({
  fullDataDeadlineOverlay,
  fullDataEvents,
  hasFullData,
  activeView,
  previewDeadlineOverlay,
  previewEvents,
  viewMonth,
  viewYear,
}: {
  fullDataDeadlineOverlay?: CalendarDeadlineOverlay<TDeadline> | null;
  fullDataEvents?: TEvent[];
  hasFullData: boolean;
  activeView: {
    monthAgnosticItemsByDate?: boolean;
    compute?: (options: {
      data: { events: TEvent[]; deadlineOverlay: CalendarDeadlineOverlay<TDeadline> | null };
      viewYear: number;
      viewMonth: number;
    }) => TComputed;
  };
  previewDeadlineOverlay: CalendarDeadlineOverlay<TDeadline> | null;
  previewEvents: TEvent[] | null;
  viewMonth: number;
  viewYear: number;
}): TComputed | null {
  if (typeof activeView.compute !== "function") return null;
  if (activeView.monthAgnosticItemsByDate) return null;

  const mergedEvents = hasFullData
    ? mergeAdjacentEventLists(fullDataEvents, previewEvents)
    : null;
  let resolvedDeadlineOverlay = fullDataDeadlineOverlay ?? null;
  let deadlineDataChanged = false;
  if (fullDataDeadlineOverlay?.enabled && previewDeadlineOverlay?.data) {
    const mergedData = mergeAdjacentDeadlineData(fullDataDeadlineOverlay.data, previewDeadlineOverlay.data);
    if (mergedData !== fullDataDeadlineOverlay.data) {
      resolvedDeadlineOverlay = { ...fullDataDeadlineOverlay, data: mergedData as TDeadline };
      deadlineDataChanged = true;
    }
  }
  if (hasFullData) {
    if (mergedEvents === (fullDataEvents ?? null) && !deadlineDataChanged) return null;
    return activeView.compute({
      data: {
        events: mergedEvents || [],
        deadlineOverlay: resolvedDeadlineOverlay,
      },
      viewYear,
      viewMonth,
    });
  }
  if (!previewEvents?.length && !previewDeadlineOverlay?.data) return null;
  return activeView.compute({
    data: { events: previewEvents || [], deadlineOverlay: previewDeadlineOverlay },
    viewYear,
    viewMonth,
  });
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
  if (recorded.prevMonthDeadlines !== inputs.prevMonthDeadlines) return false;
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
    const prevMonthDeadlines = wrapsDeadlines && firstDay > 0
      ? getMonthDeadlines(prevYear, prevMonth)
      : null;
    const inputs: CalendarMonthPreviewInputs<TEvent, TDeadline> = {
      curEvents,
      prevEvents,
      monthDeadlines,
      prevMonthDeadlines,
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
        ? buildMonthDeadlineOverlay(
            activeDeadlineOverlay,
            mergeAdjacentDeadlineData(monthDeadlines, prevMonthDeadlines),
          )
        : activeDeadlineOverlay,
    };
    entryInputs.set(entry, inputs as CalendarMonthPreviewInputs<CalendarPreviewEvent, unknown>);
    next.set(i, entry);
  }
  return next;
}
