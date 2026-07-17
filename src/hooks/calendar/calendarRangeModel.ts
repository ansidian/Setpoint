export const DEFAULT_MAX_MONTHS_PER_FETCH = 2;

export type CalendarMonthKey = string;
export type CalendarDateKey = string;

export interface CalendarMonthFetchPlanOptions {
  cachedKeys?: readonly CalendarMonthKey[] | ReadonlySet<CalendarMonthKey>;
  inFlightKeys?: readonly CalendarMonthKey[] | ReadonlySet<CalendarMonthKey>;
  maxMonthsPerFetch?: number;
}

export interface CalendarPrefetchPlanOptions extends CalendarMonthFetchPlanOptions {
  prefetchMonthRadius?: number;
}

export interface CalendarMonthBounds {
  start: CalendarDateKey;
  end: CalendarDateKey;
}

export function monthKey(year: number, zeroIndexedMonth: number): CalendarMonthKey {
  return `${year}-${String(zeroIndexedMonth + 1).padStart(2, "0")}`;
}

export function monthIndex(key: CalendarMonthKey | null | undefined): number | null {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return (year ?? 0) * 12 + ((month ?? 1) - 1);
}

export function keyFromMonthIndex(index: number): CalendarMonthKey {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return monthKey(year, month);
}

export function monthsInRange(start: CalendarDateKey, end: CalendarDateKey): CalendarMonthKey[] {
  const result: CalendarMonthKey[] = [];
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return result;
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= e) {
    result.push(monthKey(cur.getUTCFullYear(), cur.getUTCMonth()));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return result;
}

export function expandMonthKeys(keys: CalendarMonthKey[], radius?: number): CalendarMonthKey[];
export function expandMonthKeys(keys: readonly CalendarMonthKey[], radius?: number): readonly CalendarMonthKey[];
export function expandMonthKeys(keys: readonly CalendarMonthKey[], radius = 0): readonly CalendarMonthKey[] {
  const indexes = keys.map(monthIndex).filter((index): index is number => Number.isFinite(index));
  if (!indexes.length || radius <= 0) return keys;
  const first = Math.min(...indexes) - radius;
  const last = Math.max(...indexes) + radius;
  const result: CalendarMonthKey[] = [];
  for (let index = first; index <= last; index += 1) {
    result.push(keyFromMonthIndex(index));
  }
  return result;
}

export function groupMonthKeys(
  keys: readonly CalendarMonthKey[],
  maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH,
): CalendarMonthKey[][] {
  const sorted = [...new Set(keys)].sort((a, b) => (monthIndex(a) ?? 0) - (monthIndex(b) ?? 0));
  const groups: CalendarMonthKey[][] = [];
  let current: CalendarMonthKey[] = [];

  for (const key of sorted) {
    const previous = current[current.length - 1];
    const previousIndex = monthIndex(previous);
    const contiguous = previous != null && previousIndex != null && monthIndex(key) === previousIndex + 1;
    if (!current.length || (contiguous && current.length < maxMonthsPerFetch)) {
      current.push(key);
      continue;
    }
    groups.push(current);
    current = [key];
  }
  if (current.length) groups.push(current);
  return groups;
}

export function monthBounds(key: CalendarMonthKey | null | undefined): CalendarMonthBounds {
  const [year, month] = String(key || "").split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year ?? Number.NaN, month ?? Number.NaN, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function keySet(
  keys: readonly CalendarMonthKey[] | ReadonlySet<CalendarMonthKey> | null | undefined,
): ReadonlySet<CalendarMonthKey> {
  return keys instanceof Set ? keys : new Set(keys || []);
}

export function planVisibleMonthFetches(start: CalendarDateKey, end: CalendarDateKey, {
  cachedKeys = [],
  inFlightKeys = [],
  maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH,
}: CalendarMonthFetchPlanOptions = {}) {
  const visibleKeys = monthsInRange(start, end);
  const cached = keySet(cachedKeys);
  const inFlight = keySet(inFlightKeys);
  const missingKeys = visibleKeys.filter((key) => !cached.has(key) && !inFlight.has(key));
  const pendingKeys = visibleKeys.filter((key) => !cached.has(key) && inFlight.has(key));
  return {
    visibleKeys,
    missingKeys,
    pendingKeys,
    missingGroups: groupMonthKeys(missingKeys, maxMonthsPerFetch),
  };
}

export function planPrefetchMonthGroups(visibleKeys: readonly CalendarMonthKey[], {
  cachedKeys = [],
  inFlightKeys = [],
  prefetchMonthRadius = 0,
  maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH,
}: CalendarPrefetchPlanOptions = {}): CalendarMonthKey[][] {
  if (prefetchMonthRadius <= 0) return [];
  const visible = keySet(visibleKeys);
  const cached = keySet(cachedKeys);
  const inFlight = keySet(inFlightKeys);
  const prefetchKeys = expandMonthKeys(visibleKeys, prefetchMonthRadius)
    .filter((key) => !visible.has(key) && !cached.has(key) && !inFlight.has(key));
  return groupMonthKeys(prefetchKeys, maxMonthsPerFetch);
}
