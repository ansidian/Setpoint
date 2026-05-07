import { useCallback, useRef, useState } from "react";
import {
  groupMonthKeys,
  monthBounds,
  planPrefetchMonthGroups,
  planVisibleMonthFetches,
} from "./calendarRangeModel.js";

const CACHE_TTL_MS = 30 * 60 * 1000;

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

function monthKeysFromData(data) {
  const keys = new Set();
  for (const sectionName of ["ctm", "todoist"]) {
    for (const item of data?.[sectionName]?.upcoming || []) {
      const key = monthKeyFromDate(dueDateOf(item));
      if (key) keys.add(key);
    }
  }
  return [...keys];
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
  const [dataRange, setDataRange] = useState(null);
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
        const targetKeySet = new Set(targetKeys);
        for (const key of targetKeys) {
          cacheRef.current.set(key, {
            data: filterDataForMonth(value, key),
            fetchedAt,
          });
        }
        const active = activeRangeRef.current;
        const updatesActiveRange = active?.keys?.some((key) => targetKeySet.has(key));
        const activeRangeReady = active?.keys?.every((key) => cacheRef.current.has(key));
        if (updatesActiveRange && activeRangeReady) {
          setData(combineDataForRange(cacheRef.current, active.keys, active.start, active.end, emptyData));
          setDataRange({ start: active.start, end: active.end, keys: active.keys });
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
  }, [emptyData, fetchRange]);

  const prefetchMonths = useCallback((visibleKeys) => {
    if (disabled || !fetchRange || cacheMode !== "month" || prefetchMonthRadius <= 0) return;
    const freshCacheKeys = [...cacheRef.current.entries()]
      .filter(([, entry]) => fresh(entry))
      .map(([key]) => key);
    for (const group of planPrefetchMonthGroups(visibleKeys, {
      cachedKeys: freshCacheKeys,
      inFlightKeys: [...inFlightRef.current.keys()],
      prefetchMonthRadius,
    })) {
      fetchMonthGroup(group).catch((err) => {
        setError(err);
      });
    }
  }, [cacheMode, disabled, fetchMonthGroup, fetchRange, prefetchMonthRadius]);

  const ensureMonthRange = useCallback(async (start, end) => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      setDataRange(null);
      return emptyData;
    }

    const { visibleKeys, missingKeys, pendingKeys, missingGroups } = planVisibleMonthFetches(start, end, {
      cachedKeys: [...cacheRef.current.keys()],
      inFlightKeys: [...inFlightRef.current.keys()],
    });
    activeRangeRef.current = { start, end, keys: visibleKeys };
    const pending = [...new Set(pendingKeys.map((key) => inFlightRef.current.get(key)).filter(Boolean))];

    if (missingKeys.length || pending.length) {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.allSettled([
          ...pending,
          ...missingGroups.map((group) => fetchMonthGroup(group)),
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
    if (staleKeys.length) {
      for (const group of groupMonthKeys(staleKeys)) {
        fetchMonthGroup(group, { force: true }).catch((err) => setError(err));
      }
    }

    const next = combineDataForRange(cacheRef.current, visibleKeys, start, end, emptyData);
    const active = activeRangeRef.current;
    const isActiveRange = active?.start === start && active?.end === end;
    if (isActiveRange) {
      setData(next);
      setDataRange({ start, end, keys: visibleKeys });
      prefetchMonths(visibleKeys);
    }
    return next;
  }, [disabled, emptyData, fetchMonthGroup, fetchRange, prefetchMonths]);

  const ensureExactRange = useCallback(async (start, end) => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      setDataRange(null);
      return emptyData;
    }

    const key = cacheKey(start, end);
    activeKeyRef.current = key;
    const cached = cacheRef.current.get(key);
    if (fresh(cached)) {
      setData(cached.data);
      setDataRange({ start, end, key });
      return cached.data;
    }

    const existing = inFlightRef.current.get(key);
    if (existing) {
      const value = await existing;
      if (activeKeyRef.current === key) {
        setData(value);
        setDataRange({ start, end, key });
      }
      return value;
    }

    setLoading(true);
    setError(null);
    const promise = fetchRange(start, end)
      .then((value) => {
        cacheRef.current.set(key, { data: value, fetchedAt: Date.now() });
        if (activeKeyRef.current === key) {
          setData(value);
          setDataRange({ start, end, key });
        }
        setRevision((current) => current + 1);
        return value;
      })
      .catch((err) => {
        setError(err);
        throw err;
      })
      .finally(() => {
        inFlightRef.current.delete(key);
        if (activeKeyRef.current === key) setLoading(false);
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
    setDataRange(null);
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
      const active = activeRangeRef.current;
      setData((current) => {
        for (const [key, entry] of cacheRef.current.entries()) {
          const updated = typeof updater === "function" ? updater(entry.data) : updater;
          cacheRef.current.set(key, {
            ...entry,
            data: filterDataForMonth(updated, key),
          });
        }
        if (active) {
          return combineDataForRange(cacheRef.current, active.keys, active.start, active.end, emptyData);
        }
        return typeof updater === "function" ? updater(current) : updater;
      });
      setDataRange(active ? { start: active.start, end: active.end, keys: active.keys } : null);
      setRevision((current) => current + 1);
      return;
    }
    const activeKey = activeKeyRef.current;
    setData((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (activeKey && cacheRef.current.has(activeKey)) {
        const entry = cacheRef.current.get(activeKey);
        cacheRef.current.set(activeKey, {
          ...entry,
          data: next,
        });
      }
      return next;
    });
    if (activeKey) {
      const [start, end] = activeKey.split(":");
      setDataRange({ start, end, key: activeKey });
    }
    setRevision((current) => current + 1);
  }, [cacheMode, disabled, emptyData]);

  const seedData = useCallback((data, { stale = true } = {}) => {
    if (disabled || data == null) return;
    const fetchedAt = stale ? 0 : Date.now();
    if (cacheMode === "month") {
      const keys = monthKeysFromData(data);
      for (const key of keys) {
        if (stale && cacheRef.current.has(key)) continue;
        cacheRef.current.set(key, {
          data: filterDataForMonth(data, key),
          fetchedAt,
        });
      }
      const active = activeRangeRef.current;
      setData(active && keys.length
        ? combineDataForRange(cacheRef.current, active.keys, active.start, active.end, data)
        : clone(data));
      setDataRange(active && keys.length ? { start: active.start, end: active.end, keys: active.keys } : null);
      setRevision((current) => current + 1);
      return;
    }
    const next = clone(data);
    const key = activeKeyRef.current;
    if (key) {
      cacheRef.current.set(key, { data: next, fetchedAt });
    }
    setData(next);
    setDataRange(key ? { start: key.split(":")[0], end: key.split(":")[1], key } : null);
    setRevision((current) => current + 1);
  }, [cacheMode, disabled]);

  return {
    data,
    dataRange,
    ensureRange,
    invalidate,
    markStale,
    updateData,
    seedData,
    loading,
    error,
    revision,
  };
}
