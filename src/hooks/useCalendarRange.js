import { useCallback, useRef, useState } from "react";
import { getCalendarRange } from "../api";

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
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

function monthBounds(key) {
  const [y, m] = key.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function monthKeyFromEpochMs(epochMs) {
  if (!Number.isFinite(epochMs)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(epochMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

function eventIdentity(event) {
  return event?.id == null ? null : String(event.id);
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

  const fetchMonth = useCallback(async (key) => {
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;

    const { start, end } = monthBounds(key);
    const promise = (async () => {
      try {
        const { events } = await getCalendarRange(start, end);
        cacheRef.current.set(key, events || []);
      } finally {
        inFlightRef.current.delete(key);
      }
    })();
    inFlightRef.current.set(key, promise);
    return promise;
  }, []);

  const ensureRange = useCallback(async (start, end) => {
    if (disabled) return [];

    const keys = monthsInRange(start, end);
    const missing = keys.filter((k) => !cacheRef.current.has(k));

    if (missing.length > 0) {
      setLoading(true);
      setError(null);
      try {
        await Promise.all(missing.map(fetchMonth));
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        forceUpdate((n) => n + 1);
      }
    }

    // Flatten cached months and trim to [start, end]
    const startMs = new Date(`${start}T00:00:00Z`).getTime();
    const endMs = new Date(`${end}T23:59:59.999Z`).getTime();
    const all = [];
    for (const k of keys) {
      for (const ev of cacheRef.current.get(k) || []) {
        if (ev.startMs >= startMs && ev.startMs <= endMs) all.push(ev);
      }
    }
    return all;
  }, [disabled, fetchMonth]);

  const refreshRange = useCallback(async (start, end) => {
    if (disabled) return [];
    const keys = monthsInRange(start, end);
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

      const key = monthKeyFromEpochMs(event.startMs);
      if (!key || !cacheRef.current.has(key)) continue;
      cacheRef.current.set(key, [...(cacheRef.current.get(key) || []), event]);
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
