import { useCallback, useRef, useState } from "react";

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MONTHS_PER_FETCH = 2;

function cacheKey(start, end) {
  return `${start}:${end}`;
}

function fresh(entry) {
  return entry && Date.now() - entry.fetchedAt <= CACHE_TTL_MS;
}

function monthKeyFromDate(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateKey)
    ? dateKey.slice(0, 7)
    : null;
}

function monthIndex(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return year * 12 + (month - 1);
}

function keyFromMonthIndex(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthsInRange(start, end) {
  const result = [];
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return result;
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= e) {
    result.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return result;
}

function expandMonthKeys(keys, radius) {
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

function monthBounds(key) {
  const [year, month] = key.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function groupMonthKeys(keys) {
  const sorted = [...new Set(keys)].sort((a, b) => monthIndex(a) - monthIndex(b));
  const groups = [];
  let current = [];

  for (const key of sorted) {
    const previous = current[current.length - 1];
    const contiguous = previous && monthIndex(key) === monthIndex(previous) + 1;
    if (!current.length || (contiguous && current.length < MAX_MONTHS_PER_FETCH)) {
      current.push(key);
      continue;
    }
    groups.push(current);
    current = [key];
  }
  if (current.length) groups.push(current);
  return groups;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function dueDateOf(item) {
  return item?.due_date || item?.dueDate || item?.date || null;
}

function itemIdentity(item, section) {
  const id = item?.id ?? item?.todoist_id ?? item?.url ?? item?.title;
  return `${section}:${id ?? ""}:${dueDateOf(item) ?? ""}`;
}

function recalculateStats(items, existing = {}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  let incomplete = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let totalPoints = 0;

  for (const item of items || []) {
    if (item?.status !== "complete") incomplete += 1;
    if (item?.due_date === today) dueToday += 1;
    if (item?.due_date >= today && item?.due_date <= weekFromNow) dueThisWeek += 1;
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

function filterSectionForMonth(section, key) {
  if (!section || !Array.isArray(section.upcoming)) return section;
  const upcoming = section.upcoming.filter((item) => monthKeyFromDate(dueDateOf(item)) === key);
  return {
    ...section,
    upcoming,
    stats: recalculateStats(upcoming, section.stats),
  };
}

function filterDataForMonth(data, key) {
  const next = clone(data);
  if (!next) return next;
  next.ctm = filterSectionForMonth(next.ctm, key);
  next.todoist = filterSectionForMonth(next.todoist, key);
  return next;
}

function inRange(item, start, end) {
  const dueDate = dueDateOf(item);
  return !!dueDate && dueDate >= start && dueDate <= end;
}

function combineSectionForRange(entries, sectionName, start, end) {
  const base = clone(entries.find((entry) => entry?.data?.[sectionName])?.data?.[sectionName]) || { upcoming: [] };
  const seen = new Set();
  const upcoming = [];
  for (const entry of entries) {
    for (const item of entry?.data?.[sectionName]?.upcoming || []) {
      if (!inRange(item, start, end)) continue;
      const identity = itemIdentity(item, sectionName);
      if (seen.has(identity)) continue;
      seen.add(identity);
      upcoming.push(clone(item));
    }
  }
  return {
    ...base,
    upcoming,
    stats: recalculateStats(upcoming, base.stats),
  };
}

function combineDataForRange(cache, keys, start, end, emptyData) {
  const entries = keys.map((key) => cache.get(key)).filter(Boolean);
  const base = clone(entries.find((entry) => entry?.data)?.data) || clone(emptyData);
  if (!base) return base;
  base.ctm = combineSectionForRange(entries, "ctm", start, end);
  base.todoist = combineSectionForRange(entries, "todoist", start, end);
  return base;
}

export default function useCalendarDomainRange({
  disabled = false,
  fetchRange,
  emptyData,
  cacheMode = "exact",
  prefetchMonthRadius = 0,
} = {}) {
  const cacheRef = useRef(new Map());
  const inFlightRef = useRef(new Map());
  const activeKeyRef = useRef(null);
  const activeRangeRef = useRef(null);
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);

  const fetchMonthGroup = useCallback((keys, { force = false } = {}) => {
    const targetKeys = keys.filter((key) => {
      if (inFlightRef.current.has(key)) return false;
      const cached = cacheRef.current.get(key);
      return force || !fresh(cached);
    });
    if (!targetKeys.length) return Promise.resolve(false);

    const { start } = monthBounds(targetKeys[0]);
    const { end } = monthBounds(targetKeys[targetKeys.length - 1]);
    const promise = fetchRange(start, end)
      .then((value) => {
        const fetchedAt = Date.now();
        for (const key of targetKeys) {
          cacheRef.current.set(key, {
            data: filterDataForMonth(value, key),
            fetchedAt,
          });
        }
        setRevision((current) => current + 1);
        return true;
      })
      .finally(() => {
        for (const key of targetKeys) {
          if (inFlightRef.current.get(key) === promise) {
            inFlightRef.current.delete(key);
          }
        }
      });
    for (const key of targetKeys) {
      inFlightRef.current.set(key, promise);
    }
    return promise;
  }, [fetchRange]);

  const prefetchMonths = useCallback((visibleKeys) => {
    if (disabled || !fetchRange || cacheMode !== "month" || prefetchMonthRadius <= 0) return;
    const visible = new Set(visibleKeys);
    const prefetchKeys = expandMonthKeys(visibleKeys, prefetchMonthRadius)
      .filter((key) => !visible.has(key) && !fresh(cacheRef.current.get(key)) && !inFlightRef.current.has(key));
    for (const group of groupMonthKeys(prefetchKeys)) {
      fetchMonthGroup(group).catch((err) => {
        setError(err);
      });
    }
  }, [cacheMode, disabled, fetchMonthGroup, fetchRange, prefetchMonthRadius]);

  const ensureMonthRange = useCallback(async (start, end) => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      return emptyData;
    }

    const visibleKeys = monthsInRange(start, end);
    activeRangeRef.current = { start, end, keys: visibleKeys };
    const missingKeys = visibleKeys.filter((key) => !cacheRef.current.has(key) && !inFlightRef.current.has(key));
    const pending = [...new Set(
      visibleKeys
        .filter((key) => !cacheRef.current.has(key))
        .map((key) => inFlightRef.current.get(key))
        .filter(Boolean),
    )];

    if (missingKeys.length || pending.length) {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.allSettled([
          ...pending,
          ...groupMonthKeys(missingKeys).map((group) => fetchMonthGroup(group)),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    }

    const staleKeys = visibleKeys.filter((key) => cacheRef.current.has(key) && !fresh(cacheRef.current.get(key)));
    if (staleKeys.length && !missingKeys.length) {
      for (const group of groupMonthKeys(staleKeys)) {
        fetchMonthGroup(group, { force: true }).catch((err) => setError(err));
      }
    }

    const next = combineDataForRange(cacheRef.current, visibleKeys, start, end, emptyData);
    setData(next);
    prefetchMonths(visibleKeys);
    return next;
  }, [disabled, emptyData, fetchMonthGroup, fetchRange, prefetchMonths]);

  const ensureExactRange = useCallback(async (start, end) => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      return emptyData;
    }

    const key = cacheKey(start, end);
    activeKeyRef.current = key;
    const cached = cacheRef.current.get(key);
    if (fresh(cached)) {
      setData(cached.data);
      return cached.data;
    }

    const existing = inFlightRef.current.get(key);
    if (existing) {
      const value = await existing;
      setData(value);
      return value;
    }

    setLoading(true);
    setError(null);
    const promise = fetchRange(start, end)
      .then((value) => {
        cacheRef.current.set(key, { data: value, fetchedAt: Date.now() });
        setData(value);
        setRevision((current) => current + 1);
        return value;
      })
      .catch((err) => {
        setError(err);
        throw err;
      })
      .finally(() => {
        inFlightRef.current.delete(key);
        setLoading(false);
      });
    inFlightRef.current.set(key, promise);
    return promise;
  }, [disabled, emptyData, fetchRange]);

  const ensureRange = useCallback((start, end) => (
    cacheMode === "month"
      ? ensureMonthRange(start, end)
      : ensureExactRange(start, end)
  ), [cacheMode, ensureExactRange, ensureMonthRange]);

  const invalidate = useCallback(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setRevision((current) => current + 1);
  }, []);

  const markStale = useCallback(() => {
    for (const [key, entry] of cacheRef.current.entries()) {
      cacheRef.current.set(key, { ...entry, fetchedAt: 0 });
    }
    setRevision((current) => current + 1);
  }, []);

  const updateData = useCallback((updater) => {
    if (disabled) return;
    if (cacheMode === "month") {
      setData((current) => {
        for (const [key, entry] of cacheRef.current.entries()) {
          const updated = typeof updater === "function" ? updater(entry.data) : updater;
          cacheRef.current.set(key, {
            ...entry,
            data: filterDataForMonth(updated, key),
          });
        }
        const active = activeRangeRef.current;
        if (active) {
          return combineDataForRange(cacheRef.current, active.keys, active.start, active.end, emptyData);
        }
        return typeof updater === "function" ? updater(current) : updater;
      });
      setRevision((current) => current + 1);
      return;
    }
    setData((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const key = activeKeyRef.current;
      if (key && cacheRef.current.has(key)) {
        const entry = cacheRef.current.get(key);
        cacheRef.current.set(key, {
          ...entry,
          data: next,
        });
      }
      return next;
    });
    setRevision((current) => current + 1);
  }, [cacheMode, disabled, emptyData]);

  return {
    data,
    ensureRange,
    invalidate,
    markStale,
    updateData,
    loading,
    error,
    revision,
  };
}
