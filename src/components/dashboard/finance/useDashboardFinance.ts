import { useCallback, useEffect, useRef, useState } from "react";
import { getDashboardFinance, listFinancialActivity } from "../../../api";
import type { FinancialActivityPage } from "../../../../shared/types/financial-activity";
import type { DashboardFinanceResponse } from "../../../../shared/types/dashboard-finance";

/** Independent, read-only supporting data; failures never replace the main dashboard. */
export function useDashboardFinance(refreshing = false) {
  const [data, setData] = useState<DashboardFinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [review,setReview] = useState<FinancialActivityPage|null>(null);
  const [completed,setCompleted] = useState<FinancialActivityPage|null>(null);
  const [reviewError,setReviewError] = useState(false);
  const [completedError,setCompletedError] = useState(false);
  const reloadRef = useRef<() => void>(() => {});
  const retry = useCallback(() => reloadRef.current(), []);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let pending = false;
    const refresh = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      setLoading(true);
      try {
        const [summary,attention,history] = await Promise.allSettled([
          getDashboardFinance(), listFinancialActivity({ view:'needs_attention' }), listFinancialActivity({ view:'completed' }),
        ]);
        if (!disposed) {
          setError(summary.status === 'rejected'); setReviewError(attention.status === 'rejected'); setCompletedError(history.status === 'rejected');
          if (summary.status === 'fulfilled') setData(summary.value);
          if (attention.status === 'fulfilled') setReview(attention.value);
          if (history.status === 'fulfilled') setCompleted(history.value);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        inFlight = false;
        if (!disposed) setLoading(false);
        if (pending && !disposed) { pending = false; void refresh(); }
      }
    };
    reloadRef.current = () => { void refresh(); };
    if (!refreshing) void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("ea-financial-event-changed", visible);
    window.addEventListener("ea-demo-financial-changed", visible);
    window.addEventListener("ea-actual-metadata-invalidated", visible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("ea-financial-event-changed", visible);
      window.removeEventListener("ea-demo-financial-changed", visible);
      window.removeEventListener("ea-actual-metadata-invalidated", visible);
    };
  }, [refreshing]);
  return { data, review, completed, loading, error, reviewError, completedError, retry };
}
