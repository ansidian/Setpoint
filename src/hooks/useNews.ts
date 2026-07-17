import { useCallback, useEffect, useRef, useState } from "react";
import { getNews, refreshNews } from "../api";
import type { NewsPageEnvelope } from "../../shared/types/news.ts";

interface UseNewsOptions { active?: boolean }
interface ReloadOptions { background?: boolean }

export interface UseNewsResult {
  news: NewsPageEnvelope | null;
  loading: boolean;
  error: unknown;
  refreshing: boolean;
  reload: (options?: ReloadOptions) => Promise<void>;
  refresh: () => Promise<void>;
}

export default function useNews({ active = true }: UseNewsOptions = {}): UseNewsResult {
  const [news, setNews] = useState<NewsPageEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlightRef = useRef(false);

  const reload = useCallback(async ({ background = false }: ReloadOptions = {}) => {
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
