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
  next_date?: string;
  points_possible?: number;
  scheduleId?: unknown;
  direction?: unknown;
  payee?: unknown;
  amount?: unknown;
  [key: string]: unknown;
}

export interface CalendarDomainDataShape {
  upcoming?: CalendarDomainItem[];
  schedules?: CalendarDomainItem[];
  transactions?: CalendarDomainItem[];
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
  // Bills range data is { schedules: [...occurrences], payeeMap, ... }. Keep only
  // the occurrences whose date falls in this month so each month-key caches its
  // own slice (the server caps a single range request at ~2 months, so wide
  // windows arrive as several month-group fetches that get split here).
  if (Array.isArray(shape.schedules)) {
    shape.schedules = shape.schedules.filter((occurrence) => monthKeyFromDate(occurrence?.next_date) === key);
    if (Array.isArray(shape.transactions)) {
      shape.transactions = shape.transactions.filter((transaction) => monthKeyFromDate(transaction?.date) === key);
    }
    return next;
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

function combineBillsDataForRange<T>(
  entries: CalendarDomainCacheEntry<T>[],
  start: string,
  end: string,
  emptyData: T,
): T {
  const baseValue = clone(entries.find((entry) => Array.isArray(asDomainShape(entry?.data)?.schedules))?.data)
    || clone(emptyData) || { schedules: [] } as T;
  const base = asDomainShape(baseValue) ?? { schedules: [] };
  const seen = new Set<unknown>();
  const schedules: CalendarDomainItem[] = [];
  const seenTransactions = new Set<unknown>();
  const transactions: CalendarDomainItem[] = [];
  for (const entry of entries) {
    for (const occurrence of asDomainShape(entry?.data)?.schedules || []) {
      const date = occurrence?.next_date;
      if (!date || date < start || date > end) continue;
      const identity = occurrence?.id ?? `${occurrence?.scheduleId ?? ""}:${date}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      // Shallow copy: bill occurrences have no mutation flow at all today
      // (nothing calls updateData for the bills range) — a top-level copy is
      // enough to sever aliasing with the cache should that ever change.
      schedules.push({ ...occurrence });
    }
    for (const transaction of asDomainShape(entry?.data)?.transactions || []) {
      const date = transaction?.date;
      if (!date || date < start || date > end) continue;
      const identity = transaction?.id ?? `${date}:${transaction?.direction ?? ""}:${transaction?.payee ?? ""}:${transaction?.amount ?? ""}`;
      if (seenTransactions.has(identity)) continue;
      seenTransactions.add(identity);
      transactions.push({ ...transaction });
    }
  }
  return { ...base, schedules, transactions } as T;
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
  if (Array.isArray(shape?.schedules)) {
    return combineBillsDataForRange(entries, start, end, emptyData);
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
  for (const occurrence of shape?.schedules || []) {
    const key = monthKeyFromDate(occurrence?.next_date);
    if (key) keys.add(key);
  }
  for (const transaction of shape?.transactions || []) {
    const key = monthKeyFromDate(transaction?.date);
    if (key) keys.add(key);
  }
  return [...keys];
}
