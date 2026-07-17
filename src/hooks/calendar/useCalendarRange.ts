import { useCallback, useRef, useState } from "react";
import { getCalendarRange } from "../../api";
import {
  calendarEventTouchedMonths,
  eventVisuallyOverlapsRange,
} from "../../components/calendar/modal/calendarEventSpanLayout";
import {
  expandMonthKeys,
  groupMonthKeys,
  monthBounds,
  monthKey,
  monthsInRange,
} from "./calendarRangeModel";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { CalendarMonthKey } from "./calendarRangeModel";

const PREFETCH_MONTH_RADIUS = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;

export type CalendarRangeEvent = Partial<NormalizedCalendarEvent> & {
  id?: string;
  startMs?: number;
  endMs?: number;
  title?: string;
};

type CalendarCacheEntry = CalendarRangeEvent[] | {
  events: CalendarRangeEvent[];
  fetchedAt: number;
};

interface CalendarRangeFetchOptions {
  force?: boolean;
  background?: boolean;
  signal?: AbortSignal;
}

export interface CalendarEnsureRangeOptions {
  signal?: AbortSignal;
  prefetchKeys?: CalendarMonthKey[];
}

export interface CalendarRangeController {
  getEvents(year: number, month: number): CalendarRangeEvent[];
  ensureRange(start: string, end: string, options?: CalendarEnsureRangeOptions): Promise<CalendarRangeEvent[]>;
  refreshRange(start: string, end: string): Promise<CalendarRangeEvent[]>;
  refreshRangeInPlace(start: string, end: string): Promise<CalendarRangeEvent[]>;
  invalidate(): void;
  markStale(start?: string | null, end?: string | null): void;
  upsertEvents(events: CalendarRangeEvent | CalendarRangeEvent[]): void;
  removeEvent(eventId: string | number | null | undefined): void;
  hasMonth(year: number, month: number): boolean;
  isMonthLoading(year: number, month: number): boolean;
  loading: boolean;
  staleRefreshPending: boolean;
  error: unknown;
  revision: number;
  cacheStamp: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error != null && "name" in error && error.name === "AbortError";
}

function eventIdentity(event: Pick<CalendarRangeEvent, "id">): string | null {
  return event?.id == null ? null : String(event.id);
}

function addEventToCachedBuckets(
  buckets: Map<CalendarMonthKey, CalendarRangeEvent[]>,
  event: CalendarRangeEvent,
): void {
  const keys = calendarEventTouchedMonths(event) as CalendarMonthKey[];
  for (const key of keys) {
    if (buckets.has(key)) buckets.get(key)!.push(event);
  }
}

function makeCacheEntry(events: CalendarRangeEvent[], fetchedAt = Date.now()): CalendarCacheEntry {
  return { events, fetchedAt };
}

function cachedEvents(entry: CalendarCacheEntry | undefined): CalendarRangeEvent[] {
  if (Array.isArray(entry)) return entry;
  return entry?.events || [];
}

function isStaleEntry(entry: CalendarCacheEntry | undefined, now = Date.now()): boolean {
  if (!entry) return false;
  if (Array.isArray(entry) || typeof entry.fetchedAt !== "number") return true;
  return now - entry.fetchedAt > CACHE_TTL_MS;
}

function cacheFetchedAt(entry: CalendarCacheEntry | undefined): number | undefined {
  return Array.isArray(entry) ? undefined : entry?.fetchedAt;
}

function staleCacheEntry(entry: CalendarCacheEntry): CalendarCacheEntry {
  return makeCacheEntry(cachedEvents(entry), 0);
}

export default function useCalendarRange({ disabled = false }: { disabled?: boolean } = {}): CalendarRangeController {
  const cacheRef = useRef(new Map<CalendarMonthKey, CalendarCacheEntry>()); // monthKey -> { events, fetchedAt }
  const inFlightRef = useRef(new Map<CalendarMonthKey, Promise<boolean>>()); // monthKey -> foreground Promise<boolean>
  const backgroundInFlightRef = useRef(new Map<CalendarMonthKey, Promise<boolean>>()); // monthKey -> stale refresh Promise<boolean>
  const cacheGenerationRef = useRef(0);
  // Bumped on every write that changes cached event content (not staleness
  // marks). Consumers key memos on it so re-renders without content change
  // keep derived identities stable.
  const cacheStampRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [staleRefreshPending, setStaleRefreshPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [, forceUpdate] = useState(0);

  const hasMonth = useCallback((year: number, month: number) => {
    return cacheRef.current.has(monthKey(year, month));
  }, []);

  const isMonthLoading = useCallback((year: number, month: number) => {
    return inFlightRef.current.has(monthKey(year, month));
  }, []);

  const getEvents = useCallback((year: number, month: number) => {
    return cachedEvents(cacheRef.current.get(monthKey(year, month)));
  }, []);

  const eventsForRange = useCallback((start: string, end: string, keys = monthsInRange(start, end)) => {
    const all: CalendarRangeEvent[] = [];
    const seen = new Set<string>();
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

  const fetchMonthGroup = useCallback((keys: CalendarMonthKey[], { force = false, background = false, signal }: CalendarRangeFetchOptions = {}) => {
    const flightRef = background ? backgroundInFlightRef : inFlightRef;
    const targetKeys = keys.filter((key) => {
      if (inFlightRef.current.has(key) || backgroundInFlightRef.current.has(key)) return false;
      return force || !cacheRef.current.has(key);
    });
    if (!targetKeys.length) return Promise.resolve(false);

    const generation = cacheGenerationRef.current;
    const { start } = monthBounds(targetKeys[0]!);
    const { end } = monthBounds(targetKeys[targetKeys.length - 1]!);
    // The finally block compares against this exact promise to avoid deleting a
    // newer in-flight entry for the same month keys.
    let promise!: Promise<boolean>;
    promise = (async () => { // eslint-disable-line prefer-const
      try {
        const fetchOpts = signal ? { signal } : undefined;
        const { events } = fetchOpts
          ? await getCalendarRange(start, end, fetchOpts)
          : await getCalendarRange(start, end);
        if (cacheGenerationRef.current !== generation) return false;
        const fetchedAt = Date.now();
        const buckets = new Map<CalendarMonthKey, CalendarRangeEvent[]>(targetKeys.map((key) => [key, []]));
        for (const event of events || []) {
          addEventToCachedBuckets(buckets, event);
        }
        for (const key of targetKeys) {
          cacheRef.current.set(key, makeCacheEntry(buckets.get(key) || [], fetchedAt));
        }
        cacheStampRef.current += 1;
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

  const refreshStaleKeys = useCallback((keys: CalendarMonthKey[]) => {
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

  const prefetchBackgroundKeys = useCallback((keys: CalendarMonthKey[]) => {
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

  const ensureRange = useCallback(async (start: string, end: string, { signal, prefetchKeys: explicitPrefetchKeys }: CalendarEnsureRangeOptions = {}) => {
    if (disabled) return [];

    const keys = monthsInRange(start, end);
    const fetchKeys = explicitPrefetchKeys || expandMonthKeys(keys, PREFETCH_MONTH_RADIUS);
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
          ...groupMonthKeys(missing).map((group) => fetchMonthGroup(group, { signal })),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } catch (err: unknown) {
        if (isAbortError(err)) {
          if (signal?.aborted) return eventsForRange(start, end, keys);
          // Inherited abort: an earlier pass's in-flight fetch was aborted
          // while this pass awaited it. Those months are still missing, so
          // refetch them once with this pass's own signal instead of
          // returning cached-only data the caller then treats as complete.
          const stillMissing = keys.filter((key) =>
            !cacheRef.current.has(key)
            && !inFlightRef.current.has(key)
            && !backgroundInFlightRef.current.has(key),
          );
          if (stillMissing.length) {
            try {
              const retried = await Promise.allSettled(
                groupMonthKeys(stillMissing).map((group) => fetchMonthGroup(group, { signal })),
              );
              const retryFailed = retried.find((result) => result.status === "rejected");
              if (retryFailed) throw retryFailed.reason;
            } catch (retryErr: unknown) {
              if (isAbortError(retryErr)) return eventsForRange(start, end, keys);
              setError(retryErr);
            }
          }
        } else {
          setError(err);
        }
      } finally {
        setLoading(false);
        forceUpdate((n) => n + 1);
      }
    }
    refreshStaleKeys(fetchKeys);
    prefetchBackgroundKeys(fetchKeys.filter((key) => !visibleKeySet.has(key)));

    return eventsForRange(start, end, keys);
  }, [disabled, eventsForRange, fetchMonthGroup, prefetchBackgroundKeys, refreshStaleKeys]);

  const refreshRangeInPlace = useCallback(async (start: string, end: string) => {
    if (disabled) return [];
    const keys = expandMonthKeys(monthsInRange(start, end), PREFETCH_MONTH_RADIUS);
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
    } catch (err: unknown) {
      setError(err);
    } finally {
      if (backgroundInFlightRef.current.size === 0) {
        setStaleRefreshPending(false);
      }
    }
    return eventsForRange(start, end);
  }, [disabled, eventsForRange, fetchMonthGroup]);

  const refreshRange = useCallback(async (start: string, end: string) => {
    if (disabled) return [];
    const keys = expandMonthKeys(monthsInRange(start, end), PREFETCH_MONTH_RADIUS);
    cacheGenerationRef.current += 1;
    cacheStampRef.current += 1;
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
    cacheStampRef.current += 1;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    backgroundInFlightRef.current.clear();
    setStaleRefreshPending(false);
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, []);

  const markStale = useCallback((start?: string | null, end?: string | null) => {
    if (disabled) return;
    const keys = start && end
      ? expandMonthKeys(monthsInRange(start, end), PREFETCH_MONTH_RADIUS)
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

  const upsertEvents = useCallback((events: CalendarRangeEvent | CalendarRangeEvent[]) => {
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
            cacheFetchedAt(entry),
          ),
        );
      }

      for (const key of calendarEventTouchedMonths(event) as CalendarMonthKey[]) {
        if (!cacheRef.current.has(key)) continue;
        const entry = cacheRef.current.get(key);
        cacheRef.current.set(
          key,
          makeCacheEntry([...cachedEvents(entry), event], cacheFetchedAt(entry)),
        );
      }
    }

    cacheGenerationRef.current += 1;
    cacheStampRef.current += 1;
    setRevision((value) => value + 1);
    forceUpdate((n) => n + 1);
  }, [disabled]);

  const removeEvent = useCallback((eventId: string | number | null | undefined) => {
    if (disabled || eventId == null) return;
    const id = String(eventId);
    let changed = false;
    for (const [key, entry] of cacheRef.current.entries()) {
      const events = cachedEvents(entry);
      const next = events.filter((event) => eventIdentity(event) !== id);
      if (next.length !== events.length) {
        cacheRef.current.set(key, makeCacheEntry(next, cacheFetchedAt(entry)));
        changed = true;
      }
    }
    if (!changed) return;
    cacheGenerationRef.current += 1;
    cacheStampRef.current += 1;
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
    cacheStamp: cacheStampRef.current,
  };
}
