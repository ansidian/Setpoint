import { useCallback, useRef, useState } from "react";
import { getCalendarRange } from "../api";
import {
  calendarEventTouchedMonths,
  eventVisuallyOverlapsRange,
} from "../components/calendar/modal/calendarEventSpanLayout.js";

const PREFETCH_MONTH_RADIUS = 3;
const MAX_MONTHS_PER_FETCH = 2;
const CACHE_TTL_MS = 30 * 60 * 1000;

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthIndex(key) {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + (month - 1);
}

function keyFromMonthIndex(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return monthKey(year, month);
}

// Given an inclusive date range, return the set of month keys it touches.
function monthsInRange(start, end) {
  const result = [];
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= e) {
    result.push(monthKey(cur.getUTCFullYear(), cur.getUTCMonth()));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return result;
}

function expandMonthKeys(keys, radius = PREFETCH_MONTH_RADIUS) {
  const indexes = keys.map(monthIndex).filter(Number.isFinite);
  if (!indexes.length) return [];
  const first = Math.min(...indexes) - radius;
  const last = Math.max(...indexes) + radius;
  const result = [];
  for (let index = first; index <= last; index += 1) {
    result.push(keyFromMonthIndex(index));
  }
  return result;
}

function groupMonthKeys(keys) {
  const sorted = [...new Set(keys)]
    .sort((a, b) => monthIndex(a) - monthIndex(b));
  const groups = [];
  let current = [];

  for (const key of sorted) {
    const previous = current[current.length - 1];
    const isContiguous = previous && monthIndex(key) === monthIndex(previous) + 1;
    if (!current.length || (isContiguous && current.length < MAX_MONTHS_PER_FETCH)) {
      current.push(key);
      continue;
    }
    groups.push(current);
    current = [key];
  }

  if (current.length) groups.push(current);
  return groups;
}

function monthBounds(key) {
  const [y, m] = key.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function eventIdentity(event) {
  return event?.id == null ? null : String(event.id);
}

function addEventToCachedBuckets(buckets, event) {
  const keys = calendarEventTouchedMonths(event);
  for (const key of keys) {
    if (buckets.has(key)) buckets.get(key).push(event);
  }
}

function makeCacheEntry(events, fetchedAt = Date.now()) {
  return { events, fetchedAt };
}

function cachedEvents(entry) {
  if (Array.isArray(entry)) return entry;
  return entry?.events || [];
}

function isStaleEntry(entry, now = Date.now()) {
  if (!entry) return false;
  if (typeof entry.fetchedAt !== "number") return true;
  return now - entry.fetchedAt > CACHE_TTL_MS;
}

function staleCacheEntry(entry) {
  return makeCacheEntry(cachedEvents(entry), 0);
}

export default function useCalendarRange({ disabled = false } = {}) {
  const cacheRef = useRef(new Map()); // monthKey -> { events, fetchedAt }
  const inFlightRef = useRef(new Map()); // monthKey -> foreground Promise<boolean>
  const backgroundInFlightRef = useRef(new Map()); // monthKey -> stale refresh Promise<boolean>
  const cacheGenerationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [staleRefreshPending, setStaleRefreshPending] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [, forceUpdate] = useState(0);

  const hasMonth = useCallback((year, month) => {
    return cacheRef.current.has(monthKey(year, month));
  }, []);

  const isMonthLoading = useCallback((year, month) => {
    return inFlightRef.current.has(monthKey(year, month));
  }, []);

  const getEvents = useCallback((year, month) => {
    return cachedEvents(cacheRef.current.get(monthKey(year, month)));
  }, []);

  const eventsForRange = useCallback((start, end, keys = monthsInRange(start, end)) => {
    const all = [];
    const seen = new Set();
    for (const k of keys) {
      for (const ev of cachedEvents(cacheRef.current.get(k))) {
        const identity = eventIdentity(ev) || `${ev.startMs || 0}-${ev.endMs || 0}-${ev.title || ""}`;
        if (seen.has(identity)) continue;
        if (!eventVisuallyOverlapsRange(ev, start, end)) continue;
        seen.add(identity);
        all.push(ev);
      }
    }
    return all;
  }, []);

  const fetchMonthGroup = useCallback((keys, { force = false, background = false } = {}) => {
    const flightRef = background ? backgroundInFlightRef : inFlightRef;
    const targetKeys = keys.filter((key) => {
      if (inFlightRef.current.has(key) || backgroundInFlightRef.current.has(key)) return false;
      return force || !cacheRef.current.has(key);
    });
    if (!targetKeys.length) return Promise.resolve(false);

    const generation = cacheGenerationRef.current;
    const { start } = monthBounds(targetKeys[0]);
    const { end } = monthBounds(targetKeys[targetKeys.length - 1]);
    const promise = (async () => {
      try {
        const { events } = await getCalendarRange(start, end);
        if (cacheGenerationRef.current !== generation) return false;
        const fetchedAt = Date.now();
        const buckets = new Map(targetKeys.map((key) => [key, []]));
        for (const event of events || []) {
          addEventToCachedBuckets(buckets, event);
        }
        for (const key of targetKeys) {
          cacheRef.current.set(key, makeCacheEntry(buckets.get(key) || [], fetchedAt));
        }
        return true;
      } finally {
        for (const key of targetKeys) {
          if (flightRef.current.get(key) === promise) {
            flightRef.current.delete(key);
          }
        }
      }
    })();
    for (const key of targetKeys) {
      flightRef.current.set(key, promise);
    }
    return promise;
  }, []);

  const refreshStaleKeys = useCallback((keys) => {
    const now = Date.now();
    const staleKeys = keys.filter((key) =>
      cacheRef.current.has(key)
      && isStaleEntry(cacheRef.current.get(key), now)
      && !inFlightRef.current.has(key)
      && !backgroundInFlightRef.current.has(key),
    );
    if (!staleKeys.length) return;

    setStaleRefreshPending(true);
    Promise.allSettled(
      groupMonthKeys(staleKeys).map((group) => fetchMonthGroup(group, { force: true, background: true })),
    ).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        setError(failed.reason);
        return;
      }
      const changed = results.some((result) => result.status === "fulfilled" && result.value);
      if (!changed) return;
      setRevision((value) => value + 1);
      forceUpdate((n) => n + 1);
    }).finally(() => {
      if (backgroundInFlightRef.current.size === 0) {
        setStaleRefreshPending(false);
      }
    });
  }, [fetchMonthGroup]);

  const prefetchBackgroundKeys = useCallback((keys) => {
    const missing = keys.filter((key) =>
      !cacheRef.current.has(key)
      && !inFlightRef.current.has(key)
      && !backgroundInFlightRef.current.has(key),
    );
    if (!missing.length) return;

    Promise.allSettled(
      groupMonthKeys(missing).map((group) => fetchMonthGroup(group, { background: true })),
    ).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        setError(failed.reason);
        return;
      }
      const changed = results.some((result) => result.status === "fulfilled" && result.value);
      if (changed) forceUpdate((n) => n + 1);
    });
  }, [fetchMonthGroup]);

  const ensureRange = useCallback(async (start, end) => {
    if (disabled) return [];

    const keys = monthsInRange(start, end);
    const fetchKeys = expandMonthKeys(keys);
    const visibleKeySet = new Set(keys);
    const pending = [...new Set(
      keys
        .filter((key) => !cacheRef.current.has(key))
        .map((key) => inFlightRef.current.get(key) || backgroundInFlightRef.current.get(key))
        .filter(Boolean),
    )];
    const missing = keys.filter((k) =>
      !cacheRef.current.has(k)
      && !inFlightRef.current.has(k)
      && !backgroundInFlightRef.current.has(k),
    );

    if (pending.length > 0 || missing.length > 0) {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.allSettled([
          ...pending,
          ...groupMonthKeys(missing).map(fetchMonthGroup),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        forceUpdate((n) => n + 1);
      }
    }
    refreshStaleKeys(fetchKeys);
    prefetchBackgroundKeys(fetchKeys.filter((key) => !visibleKeySet.has(key)));

    return eventsForRange(start, end, keys);
  }, [disabled, eventsForRange, fetchMonthGroup, prefetchBackgroundKeys, refreshStaleKeys]);

  const refreshRangeInPlace = useCallback(async (start, end) => {
    if (disabled) return [];
    const keys = expandMonthKeys(monthsInRange(start, end));
    if (!keys.length) return eventsForRange(start, end);

    setStaleRefreshPending(true);
    try {
      const results = await Promise.allSettled(
        groupMonthKeys(keys).map((group) => fetchMonthGroup(group, { force: true, background: true })),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      const changed = results.some((result) => result.status === "fulfilled" && result.value);
      if (changed) {
        setRevision((value) => value + 1);
        forceUpdate((n) => n + 1);
      }
    } catch (err) {
      setError(err);
    } finally {
      if (backgroundInFlightRef.current.size === 0) {
        setStaleRefreshPending(false);
      }
    }
    return eventsForRange(start, end);
  }, [disabled, eventsForRange, fetchMonthGroup]);

  const refreshRange = useCallback(async (start, end) => {
    if (disabled) return [];
    const keys = expandMonthKeys(monthsInRange(start, end));
    cacheGenerationRef.current += 1;
    for (const key of keys) {
      cacheRef.current.delete(key);
      inFlightRef.current.delete(key);
      backgroundInFlightRef.current.delete(key);
    }
    const events = await ensureRange(start, end);
    setRevision((value) => value + 1);
    return events;
  }, [disabled, ensureRange]);

  const invalidate = useCallback(() => {
    cacheGenerationRef.current += 1;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    backgroundInFlightRef.current.clear();
    setStaleRefreshPending(false);
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, []);

  const markStale = useCallback((start, end) => {
    if (disabled) return;
    const keys = start && end
      ? expandMonthKeys(monthsInRange(start, end))
      : [...cacheRef.current.keys()];
    let changed = false;
    for (const key of keys) {
      const entry = cacheRef.current.get(key);
      if (!entry) continue;
      cacheRef.current.set(key, staleCacheEntry(entry));
      changed = true;
    }
    if (!changed) return;
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  const upsertEvents = useCallback((events) => {
    if (disabled) return;
    const list = (Array.isArray(events) ? events : [events]).filter((event) => event?.id);
    if (!list.length) return;

    for (const event of list) {
      const id = eventIdentity(event);
      for (const [key, entry] of cacheRef.current.entries()) {
        cacheRef.current.set(
          key,
          makeCacheEntry(
            cachedEvents(entry).filter((cachedEvent) => eventIdentity(cachedEvent) !== id),
            entry?.fetchedAt,
          ),
        );
      }

      for (const key of calendarEventTouchedMonths(event)) {
        if (!cacheRef.current.has(key)) continue;
        const entry = cacheRef.current.get(key);
        cacheRef.current.set(
          key,
          makeCacheEntry([...cachedEvents(entry), event], entry?.fetchedAt),
        );
      }
    }

    cacheGenerationRef.current += 1;
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  const removeEvent = useCallback((eventId) => {
    if (disabled || eventId == null) return;
    const id = String(eventId);
    let changed = false;
    for (const [key, entry] of cacheRef.current.entries()) {
      const events = cachedEvents(entry);
      const next = events.filter((event) => eventIdentity(event) !== id);
      if (next.length !== events.length) {
        cacheRef.current.set(key, makeCacheEntry(next, entry?.fetchedAt));
        changed = true;
      }
    }
    if (!changed) return;
    cacheGenerationRef.current += 1;
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  return {
    getEvents,
    ensureRange,
    refreshRange,
    refreshRangeInPlace,
    invalidate,
    markStale,
    upsertEvents,
    removeEvent,
    hasMonth,
    isMonthLoading,
    loading,
    staleRefreshPending,
    error,
    revision,
  };
}
