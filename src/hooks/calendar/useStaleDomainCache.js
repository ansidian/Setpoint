import { useCallback, useEffect, useRef, useState } from "react";
import useCalendarDomainRange from "./useCalendarDomainRange.js";

const DOMAIN_CACHE_TTL_MS = 30 * 60 * 1000;

export default function useStaleDomainCache({
  fetchDomain,
  initialData,
  ttlMs = DOMAIN_CACHE_TTL_MS,
  seed = null,
  fetchRange,
  emptyData,
  cacheMode = "exact",
  prefetchMonthRadius = 0,
} = {}) {
  const range = useCalendarDomainRange({
    fetchRange,
    emptyData,
    cacheMode,
    prefetchMonthRadius,
  });
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const dataRef = useRef(initialData);
  const fetchedAtRef = useRef(0);
  const loadingRef = useRef(false);
  const fetchDomainRef = useRef(fetchDomain);
  useEffect(() => {
    fetchDomainRef.current = fetchDomain;
  });

  const applyData = useCallback((value) => {
    dataRef.current = value;
    fetchedAtRef.current = Date.now();
    setData(value);
  }, []);

  const load = useCallback((opts) => {
    const force = !!opts?.force;
    if (loadingRef.current && !force) return;
    const stale = !fetchedAtRef.current || Date.now() - fetchedAtRef.current > ttlMs;
    if (!force && dataRef.current && !stale) return;
    setError(false);
    const result = fetchDomainRef.current(opts);
    if (!result || typeof result.then !== "function") {
      applyData(result);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    result
      .then(applyData)
      .catch((err) => {
        console.error("Domain cache fetch failed:", err);
        setError(true);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [applyData, ttlMs]);

  const lastSeedRef = useRef(null);
  const seedRangeData = range.seedData;
  useEffect(() => {
    if (seed == null || lastSeedRef.current === seed) return;
    lastSeedRef.current = seed;
    seedRangeData?.(seed);
  }, [seed, seedRangeData]);

  const updateRangeData = range.updateData;
  const update = useCallback((updater) => {
    setData((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      dataRef.current = next;
      return next;
    });
    updateRangeData?.(updater);
  }, [updateRangeData]);

  return { data, loading, error, load, update, range };
}
