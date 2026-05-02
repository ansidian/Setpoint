import { useCallback, useRef, useState } from "react";

const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheKey(start, end) {
  return `${start}:${end}`;
}

function fresh(entry) {
  return entry && Date.now() - entry.fetchedAt <= CACHE_TTL_MS;
}

export default function useCalendarDomainRange({
  disabled = false,
  fetchRange,
  emptyData,
} = {}) {
  const cacheRef = useRef(new Map());
  const inFlightRef = useRef(new Map());
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);

  const ensureRange = useCallback(async (start, end) => {
    if (disabled || !fetchRange) {
      setData(emptyData);
      return emptyData;
    }

    const key = cacheKey(start, end);
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

  return {
    data,
    ensureRange,
    invalidate,
    markStale,
    loading,
    error,
    revision,
  };
}
