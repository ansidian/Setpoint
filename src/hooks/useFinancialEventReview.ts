import { useCallback, useEffect, useRef, useState } from "react";
import { getFinancialEventReview } from "../lib/financialReviewApi";
import type { FinancialEventReviewResponse } from "../../shared/types/financial-review";

/** Read-only queue; coalesce invalidations without losing one that arrives during a read. */
export function useFinancialEventReview(offset = 0) {
  const [result, setResult] = useState<{ data: FinancialEventReviewResponse | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  const reload = useRef<() => void>(() => {});
  const refresh = useCallback(() => reload.current(), []);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let pending = false;
    const read = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      setResult((current) => ({ ...current, loading: true }));
      try {
        const data = await getFinancialEventReview(offset);
        if (!disposed) setResult({ data, loading: false, error: false });
      } catch {
        if (!disposed) setResult((current) => ({ ...current, loading: false, error: true }));
      } finally {
        inFlight = false;
        if (pending && !disposed) { pending = false; void read(); }
      }
    };
    const update = () => { void read(); };
    reload.current = update;
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("ea-financial-event-changed", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("ea-financial-event-changed", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [offset]);
  const data = result.data?.offset === offset ? result.data : null;
  return { data, loading: result.loading || (!data && !result.error), error: result.error, refresh };
}
