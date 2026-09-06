import { useCallback, useEffect, useRef, useState } from "react";
import { getDashboardFinance } from "../../../api";
import type { DashboardFinanceResponse } from "../../../../shared/types/dashboard-finance";

/** Independent, read-only supporting data; failures never replace the main dashboard. */
export function useDashboardFinance(refreshing = false) {
  const [data, setData] = useState<DashboardFinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reloadRef = useRef<() => void>(() => {});
  const retry = useCallback(() => reloadRef.current(), []);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      setLoading(true);
      try {
        const response = await getDashboardFinance();
        if (!disposed) { setData(response); setError(false); }
      } catch {
        if (!disposed) setError(true);
      } finally {
        inFlight = false;
        if (!disposed) setLoading(false);
      }
    };
    reloadRef.current = () => { void refresh(); };
    if (!refreshing) void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [refreshing]);
  return { data, loading, error, retry };
}
