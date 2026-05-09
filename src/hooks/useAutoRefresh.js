import { useEffect, useRef } from "react";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Single refresh cadence: 5-min visibility-gated interval + tab focus (with
// cooldown). Every trigger calls onQuickRefresh, which animates the refresh
// pill and also pulls live data in parallel — so there's no separate
// "silent" path. Tab focus is cooldown-gated to the same 5-min window so
// rapid tab-switching doesn't hammer the refresh.
export default function useAutoRefresh({
  disabled = false,
  lastQuickRefreshAt,
  onQuickRefresh,
}) {
  const lastRef = useRef(lastQuickRefreshAt);
  const onQuickRef = useRef(onQuickRefresh);

  useEffect(() => {
    lastRef.current = lastQuickRefreshAt;
    onQuickRef.current = onQuickRefresh;
  });

  useEffect(() => {
    if (disabled) return;

    const refreshIfDue = () => {
      if (document.visibilityState === "hidden") return;
      const last = lastRef.current;
      if (last != null && Date.now() - last < REFRESH_INTERVAL_MS) return;
      lastRef.current = Date.now();
      onQuickRef.current?.();
    };

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      lastRef.current = Date.now();
      onQuickRef.current?.();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      refreshIfDue();
    };

    const intervalId = setInterval(tick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refreshIfDue);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refreshIfDue);
    };
  }, [disabled]);
}
