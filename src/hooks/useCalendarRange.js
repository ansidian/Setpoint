import { useCallback, useRef, useState } from "react";
import { getCalendarRange } from "../api";
import {
  calendarEventTouchedMonths,
  eventVisuallyOverlapsRange,
} from "../components/calendar/modal/calendarEventSpanLayout.js";

const PREFETCH_MONTH_RADIUS = 1;
const MAX_MONTHS_PER_FETCH = 2;

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

export default function useCalendarRange({ disabled = false } = {}) {
  const cacheRef = useRef(new Map()); // monthKey -> event[]
  const inFlightRef = useRef(new Map()); // monthKey -> Promise<void>
  const [loading, setLoading] = useState(false);
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
    return cacheRef.current.get(monthKey(year, month)) || [];
  }, []);

  const fetchMonthGroup = useCallback((keys) => {
    const uncachedKeys = keys.filter((key) => !cacheRef.current.has(key));
    if (!uncachedKeys.length) return Promise.resolve();

    const { start } = monthBounds(uncachedKeys[0]);
    const { end } = monthBounds(uncachedKeys[uncachedKeys.length - 1]);
    const promise = (async () => {
      try {
        const { events } = await getCalendarRange(start, end);
        const buckets = new Map(uncachedKeys.map((key) => [key, []]));
        for (const event of events || []) {
          addEventToCachedBuckets(buckets, event);
        }
        for (const key of uncachedKeys) {
          cacheRef.current.set(key, buckets.get(key) || []);
        }
      } finally {
        for (const key of uncachedKeys) {
          if (inFlightRef.current.get(key) === promise) {
            inFlightRef.current.delete(key);
          }
        }
      }
    })();
    for (const key of uncachedKeys) {
      inFlightRef.current.set(key, promise);
    }
    return promise;
  }, []);

  const ensureRange = useCallback(async (start, end) => {
    if (disabled) return [];

    const keys = monthsInRange(start, end);
    const fetchKeys = expandMonthKeys(keys);
    const pending = [...new Set(
      fetchKeys
        .map((key) => inFlightRef.current.get(key))
        .filter(Boolean),
    )];
    const missing = fetchKeys.filter((k) => !cacheRef.current.has(k) && !inFlightRef.current.has(k));

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

    // Flatten cached months and trim to visual overlap with [start, end].
    const all = [];
    const seen = new Set();
    for (const k of keys) {
      for (const ev of cacheRef.current.get(k) || []) {
        const identity = eventIdentity(ev) || `${ev.startMs || 0}-${ev.endMs || 0}-${ev.title || ""}`;
        if (seen.has(identity)) continue;
        if (!eventVisuallyOverlapsRange(ev, start, end)) continue;
        seen.add(identity);
        all.push(ev);
      }
    }
    return all;
  }, [disabled, fetchMonthGroup]);

  const refreshRange = useCallback(async (start, end) => {
    if (disabled) return [];
    const keys = expandMonthKeys(monthsInRange(start, end));
    for (const key of keys) {
      cacheRef.current.delete(key);
      inFlightRef.current.delete(key);
    }
    const events = await ensureRange(start, end);
    setRevision((value) => value + 1);
    return events;
  }, [disabled, ensureRange]);

  const invalidate = useCallback(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, []);

  const upsertEvents = useCallback((events) => {
    if (disabled) return;
    const list = (Array.isArray(events) ? events : [events]).filter((event) => event?.id);
    if (!list.length) return;

    for (const event of list) {
      const id = eventIdentity(event);
      for (const [key, cachedEvents] of cacheRef.current.entries()) {
        cacheRef.current.set(
          key,
          (cachedEvents || []).filter((cachedEvent) => eventIdentity(cachedEvent) !== id),
        );
      }

      for (const key of calendarEventTouchedMonths(event)) {
        if (!cacheRef.current.has(key)) continue;
        cacheRef.current.set(key, [...(cacheRef.current.get(key) || []), event]);
      }
    }

    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  const removeEvent = useCallback((eventId) => {
    if (disabled || eventId == null) return;
    const id = String(eventId);
    let changed = false;
    for (const [key, cachedEvents] of cacheRef.current.entries()) {
      const next = (cachedEvents || []).filter((event) => eventIdentity(event) !== id);
      if (next.length !== (cachedEvents || []).length) {
        cacheRef.current.set(key, next);
        changed = true;
      }
    }
    if (!changed) return;
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  return {
    getEvents,
    ensureRange,
    refreshRange,
    invalidate,
    upsertEvents,
    removeEvent,
    hasMonth,
    isMonthLoading,
    loading,
    error,
    revision,
  };
}
