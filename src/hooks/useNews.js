import { useCallback, useEffect, useRef, useState } from "react";
import { getNews, refreshNews } from "../api.js";

export default function useNews({ active = true } = {}) {
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  const reload = useCallback(async ({ background = false } = {}) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!background) setLoading(true);
    try {
      setNews(await getNews());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!active) return undefined;
    const onVisibilityChange = () => {
      if (!document.hidden) reload({ background: true });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [active, reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshNews();
      await reload({ background: true });
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return { news, loading, error, refreshing, reload, refresh };
}
