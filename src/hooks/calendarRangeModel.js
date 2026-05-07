export const DEFAULT_MAX_MONTHS_PER_FETCH = 2;

export function monthKey(year, zeroIndexedMonth) {
  return `${year}-${String(zeroIndexedMonth + 1).padStart(2, "0")}`;
}

export function monthIndex(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return year * 12 + (month - 1);
}

export function keyFromMonthIndex(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return monthKey(year, month);
}

export function monthsInRange(start, end) {
  const result = [];
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

export function expandMonthKeys(keys, radius = 0) {
  const indexes = keys.map(monthIndex).filter(Number.isFinite);
  if (!indexes.length || radius <= 0) return keys;
  const first = Math.min(...indexes) - radius;
  const last = Math.max(...indexes) + radius;
  const result = [];
  for (let index = first; index <= last; index += 1) {
    result.push(keyFromMonthIndex(index));
  }
  return result;
}

export function groupMonthKeys(keys, maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH) {
  const sorted = [...new Set(keys)].sort((a, b) => monthIndex(a) - monthIndex(b));
  const groups = [];
  let current = [];

  for (const key of sorted) {
    const previous = current[current.length - 1];
    const contiguous = previous && monthIndex(key) === monthIndex(previous) + 1;
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

export function monthBounds(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function keySet(keys) {
  return keys instanceof Set ? keys : new Set(keys || []);
}

export function planVisibleMonthFetches(start, end, {
  cachedKeys = [],
  inFlightKeys = [],
  maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH,
} = {}) {
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

export function planPrefetchMonthGroups(visibleKeys, {
  cachedKeys = [],
  inFlightKeys = [],
  prefetchMonthRadius = 0,
  maxMonthsPerFetch = DEFAULT_MAX_MONTHS_PER_FETCH,
} = {}) {
  if (prefetchMonthRadius <= 0) return [];
  const visible = keySet(visibleKeys);
  const cached = keySet(cachedKeys);
  const inFlight = keySet(inFlightKeys);
  const prefetchKeys = expandMonthKeys(visibleKeys, prefetchMonthRadius)
    .filter((key) => !visible.has(key) && !cached.has(key) && !inFlight.has(key));
  return groupMonthKeys(prefetchKeys, maxMonthsPerFetch);
}
