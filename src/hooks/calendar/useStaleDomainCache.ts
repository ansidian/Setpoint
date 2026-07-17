import { useCallback, useEffect, useRef, useState } from "react";
import useCalendarDomainRange from "./useCalendarDomainRange";
import type {
  CalendarDomainRangeController,
  CalendarDomainUpdater,
} from "./useCalendarDomainRange";

const DOMAIN_CACHE_TTL_MS = 30 * 60 * 1000;

export interface StaleDomainLoadOptions {
  force?: boolean;
  [key: string]: unknown;
}

export interface StaleDomainCacheOptions<T> {
  fetchDomain: (options?: StaleDomainLoadOptions) => T | PromiseLike<T>;
  initialData?: T;
  ttlMs?: number;
  seed?: T | null;
  fetchRange?: ((start: string, end: string) => Promise<T | undefined>) | null;
  emptyData?: T;
  cacheMode?: "exact" | "month";
  prefetchMonthRadius?: number;
}

export interface StaleDomainCacheController<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
  load(options?: StaleDomainLoadOptions): void;
  update(updater: CalendarDomainUpdater<T | undefined>): void;
  range: CalendarDomainRangeController<T | undefined>;
}

export default function useStaleDomainCache<T>({
  fetchDomain,
  initialData,
  ttlMs = DOMAIN_CACHE_TTL_MS,
  seed = null,
  fetchRange,
  emptyData,
  cacheMode = "exact",
  prefetchMonthRadius = 0,
}: StaleDomainCacheOptions<T>): StaleDomainCacheController<T> {
  const range = useCalendarDomainRange<T | undefined>({
    fetchRange,
    emptyData,
    cacheMode,
    prefetchMonthRadius,
  });
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const dataRef = useRef<T | undefined>(initialData);
  const fetchedAtRef = useRef(0);
  const loadingRef = useRef(false);
  const fetchDomainRef = useRef<(options?: StaleDomainLoadOptions) => T | PromiseLike<T>>(fetchDomain);
  useEffect(() => {
    fetchDomainRef.current = fetchDomain;
  });

  const applyData = useCallback((value: T) => {
    dataRef.current = value;
    fetchedAtRef.current = Date.now();
    setData(value);
  }, []);

  const load = useCallback((opts?: StaleDomainLoadOptions) => {
    const force = !!opts?.force;
    if (loadingRef.current && !force) return;
    const stale = !fetchedAtRef.current || Date.now() - fetchedAtRef.current > ttlMs;
    if (!force && dataRef.current && !stale) return;
    setError(false);
    const result = fetchDomainRef.current(opts);
    if (!result || typeof (result as PromiseLike<T>).then !== "function") {
      applyData(result as T);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    Promise.resolve(result)
      .then(applyData)
      .catch((err: unknown) => {
        console.error("Domain cache fetch failed:", err);
        setError(true);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [applyData, ttlMs]);

  const lastSeedRef = useRef<T | null>(null);
  const seedRangeData = range.seedData;
  useEffect(() => {
    if (seed == null || lastSeedRef.current === seed) return;
    lastSeedRef.current = seed;
    seedRangeData?.(seed);
  }, [seed, seedRangeData]);

  const updateRangeData = range.updateData;
  const update = useCallback((updater: CalendarDomainUpdater<T | undefined>) => {
    setData((current) => {
      const next = typeof updater === "function"
        ? (updater as (value: T | undefined) => T | undefined)(current)
        : updater;
      dataRef.current = next;
      return next;
    });
    updateRangeData?.(updater);
  }, [updateRangeData]);

  return { data, loading, error, load, update, range };
}
