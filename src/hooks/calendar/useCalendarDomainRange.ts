import { useCallback, useRef, useState } from "react";
import {
  groupMonthKeys,
  monthBounds,
  planPrefetchMonthGroups,
  planVisibleMonthFetches,
} from "./calendarRangeModel";
import {
  combineCalendarDomainDataForRange,
  filterCalendarDomainDataForMonth,
  monthKeysFromCalendarDomainData,
  type CalendarDomainCacheEntry,
} from "./calendarDomainRangeDataModel.ts";

export type { CalendarDomainDataShape, CalendarDomainItem } from "./calendarDomainRangeDataModel.ts";

const CACHE_TTL_MS = 30 * 60 * 1000;

export type CalendarDomainRange =
  | { start: string; end: string; key: string }
  | { start: string; end: string; keys: string[] };

interface ActiveMonthRange {
  start: string;
  end: string;
  keys: string[];
}

export type CalendarDomainUpdater<T> = T | ((current: T) => T);

export interface CalendarDomainRangeController<T> {
  data: T;
  dataRange: CalendarDomainRange | null;
  ensureRange(start: string, end: string): Promise<T>;
  invalidate(): void;
  markStale(): void;
  updateData(updater: CalendarDomainUpdater<T>): void;
  seedData(data: T, options?: { stale?: boolean }): void;
  getMonthData(year: number, month: number): T | null;
  loading: boolean;
  error: unknown;
  revision: number;
}

export interface CalendarDomainRangeOptions<T> {
  disabled?: boolean;
  fetchRange?: ((start: string, end: string) => Promise<T>) | null;
  emptyData: T;
  cacheMode?: "exact" | "month";
  prefetchMonthRadius?: number;
}

function applyDomainUpdater<T>(updater: CalendarDomainUpdater<T>, current: T): T {
  return typeof updater === "function"
    ? (updater as (value: T) => T)(current)
    : updater;
}

function cacheKey(start: string, end: string): string {
  return `${start}:${end}`;
}

function fresh<T>(entry: CalendarDomainCacheEntry<T> | undefined): boolean {
  return !!entry && Date.now() - entry.fetchedAt <= CACHE_TTL_MS;
}

function clone<T>(value: T): T {
  if (value == null) return value;
  return structuredClone(value);
}

export default function useCalendarDomainRange<T>({
  disabled = false,
  fetchRange,
  emptyData,
  cacheMode = "exact",
  prefetchMonthRadius = 0,
}: CalendarDomainRangeOptions<T>): CalendarDomainRangeController<T> {
  const cacheRef = useRef(new Map<string, CalendarDomainCacheEntry<T>>());
  const inFlightRef = useRef(new Map<string, Promise<unknown>>());
  const activeKeyRef = useRef<string | null>(null);
  const activeRangeRef = useRef<ActiveMonthRange | null>(null);
  // Stamp of cache *content* (not staleness): bumped on every write that can
  // change a combined result. Lets month-mode ensures skip re-publishing an
  // identical combine, keeping data identity stable for downstream memos.
  const cacheStampRef = useRef(0);
  // Last published month-mode combine, keyed by range + content stamp. Only
  // set alongside setData so a key hit means state already holds this value.
  const lastMonthCombineRef = useRef<{ key: string; data: T } | null>(null);
  const [data, setData] = useState<T>(emptyData);
  const [dataRange, setDataRange] = useState<CalendarDomainRange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);

  const fetchMonthGroup = useCallback((keys: string[], { force = false }: { force?: boolean } = {}): Promise<boolean> => {
    const targetKeys = keys.filter((key) => {
      if (inFlightRef.current.has(key)) return false;
      const cached = cacheRef.current.get(key);
      return force || !fresh(cached);
    });
    if (!targetKeys.length) return Promise.resolve(false);

    const { start } = monthBounds(targetKeys[0]!);
    const { end } = monthBounds(targetKeys[targetKeys.length - 1]!);
    const promise = fetchRange!(start, end)
      .then((value) => {
        const fetchedAt = Date.now();
        const targetKeySet = new Set(targetKeys);
        for (const key of targetKeys) {
          cacheRef.current.set(key, {
            data: filterCalendarDomainDataForMonth(value, key),
            fetchedAt,
          });
        }
        cacheStampRef.current += 1;
        const active = activeRangeRef.current;
        const updatesActiveRange = active?.keys?.some((key) => targetKeySet.has(key));
        const activeRangeReady = active?.keys?.every((key) => cacheRef.current.has(key));
        if (active && updatesActiveRange && activeRangeReady) {
          const combined = combineCalendarDomainDataForRange(cacheRef.current, active.keys, active.start, active.end, emptyData);
          lastMonthCombineRef.current = {
            key: `${active.start}|${active.end}|${cacheStampRef.current}`,
            data: combined,
          };
          setData(combined);
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

  const prefetchMonths = useCallback((visibleKeys: string[]) => {
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

  const ensureMonthRange = useCallback(async (start: string, end: string): Promise<T> => {
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
      } catch (err: unknown) {
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

    const active = activeRangeRef.current;
    const isActiveRange = active?.start === start && active?.end === end;
    const combineKey = `${start}|${end}|${cacheStampRef.current}`;
    const published = lastMonthCombineRef.current;
    if (published?.key === combineKey) {
      // State already holds this exact combine; re-publishing would hand
      // consumers a deep-equal clone with a fresh identity on every settle.
      if (isActiveRange) prefetchMonths(visibleKeys);
      return published.data;
    }
    const next = combineCalendarDomainDataForRange(cacheRef.current, visibleKeys, start, end, emptyData);
    if (isActiveRange) {
      lastMonthCombineRef.current = { key: combineKey, data: next };
      setData(next);
      setDataRange({ start, end, keys: visibleKeys });
      prefetchMonths(visibleKeys);
    }
    return next;
  }, [disabled, emptyData, fetchMonthGroup, fetchRange, prefetchMonths]);

  const ensureExactRange = useCallback(async (start: string, end: string): Promise<T> => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      setDataRange(null);
      return emptyData;
    }

    const key = cacheKey(start, end);
    activeKeyRef.current = key;
    const cached = cacheRef.current.get(key);
    if (fresh(cached)) {
      setData(cached!.data);
      setDataRange({ start, end, key });
      return cached!.data;
    }

    const existing = inFlightRef.current.get(key);
    if (existing) {
      const value = await existing as T;
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
        cacheStampRef.current += 1;
        if (activeKeyRef.current === key) {
          setData(value);
          setDataRange({ start, end, key });
        }
        setRevision((current) => current + 1);
        return value;
      })
      .catch((err: unknown) => {
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

  const ensureRange = useCallback((start: string, end: string) => (
    cacheMode === "month"
      ? ensureMonthRange(start, end)
      : ensureExactRange(start, end)
  ), [cacheMode, ensureExactRange, ensureMonthRange]);

  const invalidate = useCallback(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    cacheStampRef.current += 1;
    lastMonthCombineRef.current = null;
    setDataRange(null);
    setRevision((current) => current + 1);
  }, []);

  const markStale = useCallback(() => {
    for (const [key, entry] of cacheRef.current.entries()) {
      cacheRef.current.set(key, { ...entry, fetchedAt: 0 });
    }
    setRevision((current) => current + 1);
  }, []);

  const updateData = useCallback((updater: CalendarDomainUpdater<T>) => {
    if (disabled) return;
    cacheStampRef.current += 1;
    lastMonthCombineRef.current = null;
    if (cacheMode === "month") {
      const active = activeRangeRef.current;
      setData((current) => {
        for (const [key, entry] of cacheRef.current.entries()) {
          const updated = applyDomainUpdater(updater, entry.data);
          cacheRef.current.set(key, {
            ...entry,
            data: filterCalendarDomainDataForMonth(updated, key),
          });
        }
        if (active) {
          return combineCalendarDomainDataForRange(cacheRef.current, active.keys, active.start, active.end, emptyData);
        }
        return applyDomainUpdater(updater, current);
      });
      setDataRange(active ? { start: active.start, end: active.end, keys: active.keys } : null);
      setRevision((current) => current + 1);
      return;
    }
    const activeKey = activeKeyRef.current;
    setData((current) => {
      const next = applyDomainUpdater(updater, current);
      if (activeKey && cacheRef.current.has(activeKey)) {
        const entry = cacheRef.current.get(activeKey)!;
        cacheRef.current.set(activeKey, {
          ...entry,
          data: next,
        });
      }
      return next;
    });
    if (activeKey) {
      const [start, end] = activeKey.split(":");
      setDataRange({ start: start!, end: end!, key: activeKey });
    }
    setRevision((current) => current + 1);
  }, [cacheMode, disabled, emptyData]);

  const seedData = useCallback((data: T, { stale = true }: { stale?: boolean } = {}) => {
    if (disabled || data == null) return;
    cacheStampRef.current += 1;
    lastMonthCombineRef.current = null;
    const fetchedAt = stale ? 0 : Date.now();
    if (cacheMode === "month") {
      const keys = monthKeysFromCalendarDomainData(data);
      for (const key of keys) {
        if (stale && cacheRef.current.has(key)) continue;
        cacheRef.current.set(key, {
          data: filterCalendarDomainDataForMonth(data, key),
          fetchedAt,
        });
      }
      const active = activeRangeRef.current;
      setData(active && keys.length
        ? combineCalendarDomainDataForRange(cacheRef.current, active.keys, active.start, active.end, data)
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
    setDataRange(key ? { start: key.split(":")[0]!, end: key.split(":")[1]!, key } : null);
    setRevision((current) => current + 1);
  }, [cacheMode, disabled]);

  const getMonthData = useCallback((year: number, month: number): T | null => {
    if (cacheMode !== "month") return null;
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const entry = cacheRef.current.get(key);
    return entry?.data ?? null;
  }, [cacheMode]);

  return {
    data,
    dataRange,
    ensureRange,
    invalidate,
    markStale,
    updateData,
    seedData,
    getMonthData,
    loading,
    error,
    revision,
  };
}
