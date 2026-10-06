import { addDaysYmd } from "../../components/calendar/calendarDateUtils.ts";

export interface CalendarDomainItem {
  id?: unknown;
  todoist_id?: unknown;
  url?: unknown;
  title?: unknown;
  status?: string;
  due_date?: string;
  dueDate?: string;
  date?: string;
  points_possible?: number;
  [key: string]: unknown;
}

export interface CalendarDomainDataShape {
  upcoming?: CalendarDomainItem[];
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CalendarDomainCacheEntry<T> {
  data: T;
  fetchedAt: number;
}

function asDomainShape(value: unknown): CalendarDomainDataShape | null {
  return typeof value === "object" && value != null ? value as CalendarDomainDataShape : null;
}

function monthKeyFromDate(dateKey: unknown): string | null {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateKey)
    ? dateKey.slice(0, 7)
    : null;
}

function clone<T>(value: T): T {
  if (value == null) return value;
  return structuredClone(value);
}

function dueDateOf(item: CalendarDomainItem | null | undefined): string | null {
  return item?.due_date || item?.dueDate || item?.date || null;
}

function itemIdentity(item: CalendarDomainItem): string {
  const id = item?.id ?? item?.todoist_id ?? item?.url ?? item?.title;
  return `${id ?? ""}:${dueDateOf(item) ?? ""}`;
}

function recalculateStats(
  items: readonly CalendarDomainItem[] | null | undefined,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  // Calendar-day math, not now+168h: a fixed ms shift is DST-fragile (e.g.
  // across spring-forward, +7*86400000ms from the night before can land 8
  // Pacific calendar days out instead of 7).
  const weekFromNow = addDaysYmd(today, 7);
  let incomplete = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let totalPoints = 0;

  for (const item of items || []) {
    const dueDate = item?.due_date;
    if (item?.status !== "complete") incomplete += 1;
    if (dueDate === today) dueToday += 1;
    if (dueDate && dueDate >= today && dueDate <= weekFromNow) dueThisWeek += 1;
    if (item?.points_possible) totalPoints += item.points_possible;
  }

  return {
    ...existing,
    incomplete,
    dueToday,
    dueThisWeek,
    totalPoints,
  };
}

function filterSectionForMonth<T>(section: T, key: string): T {
  const shape = asDomainShape(section);
  if (!shape || !Array.isArray(shape.upcoming)) return section;
  const upcoming = shape.upcoming.filter((item) => monthKeyFromDate(dueDateOf(item)) === key);
  return {
    ...shape,
    upcoming,
    stats: recalculateStats(upcoming, shape.stats),
  } as T;
}

export function filterCalendarDomainDataForMonth<T>(data: T, key: string): T {
  const next = clone(data);
  if (!next) return next;
  const shape = asDomainShape(next);
  if (!shape) return next;
  if (Array.isArray(shape.upcoming)) {
    return filterSectionForMonth(next, key);
  }
  return next;
}

function inRange(item: CalendarDomainItem, start: string, end: string): boolean {
  const dueDate = dueDateOf(item);
  return !!dueDate && dueDate >= start && dueDate <= end;
}

function combineDeadlineDataForRange<T>(
  entries: CalendarDomainCacheEntry<T>[],
  start: string,
  end: string,
  emptyData: T,
): T {
  const baseValue = clone(entries.find((entry) => Array.isArray(asDomainShape(entry?.data)?.upcoming))?.data)
    || clone(emptyData) || { upcoming: [] } as T;
  const base = asDomainShape(baseValue) ?? { upcoming: [] };
  const seen = new Set<string>();
  const upcoming: CalendarDomainItem[] = [];
  for (const entry of entries) {
    for (const item of asDomainShape(entry?.data)?.upcoming || []) {
      if (!inRange(item, start, end)) continue;
      const identity = itemIdentity(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      // Shallow copy is sufficient: every mutation flow (dashboardTaskProjection.ts)
      // deep-clones the whole root before assigning top-level properties, and
      // nothing mutates nested structure on these items post-combine — this
      // copy only needs to sever top-level property aliasing with the cache.
      upcoming.push({ ...item });
    }
  }
  return {
    ...base,
    upcoming,
    stats: recalculateStats(upcoming, base.stats),
  } as T;
}

export function combineCalendarDomainDataForRange<T>(
  cache: Map<string, CalendarDomainCacheEntry<T>>,
  keys: readonly string[],
  start: string,
  end: string,
  emptyData: T,
): T {
  const entries = keys.map((key) => cache.get(key)).filter((entry): entry is CalendarDomainCacheEntry<T> => !!entry);
  const base = clone(entries.find((entry) => entry?.data)?.data) || clone(emptyData);
  if (!base) return base;
  const shape = asDomainShape(base);
  if (Array.isArray(shape?.upcoming)) {
    return combineDeadlineDataForRange(entries, start, end, emptyData);
  }
  return base;
}

export function monthKeysFromCalendarDomainData(data: unknown): string[] {
  const keys = new Set<string>();
  const shape = asDomainShape(data);
  for (const item of shape?.upcoming || []) {
    const key = monthKeyFromDate(dueDateOf(item));
    if (key) keys.add(key);
  }
  return [...keys];
}
