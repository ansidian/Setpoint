import { useCallback, useEffect, useRef } from "react";

export const DASHBOARD_DETAIL_FOCUS_RETRY_MS = 250;
export const DASHBOARD_DETAIL_FOCUS_MAX_ATTEMPTS = 120;

/**
 * Drives the dashboard-detail focus retry loop: re-invokes `attempt(target)` on a
 * fixed interval until it reports `"done"`/`"abort"`, or gives up after
 * `maxAttempts` retries. The attempt count lives in a ref, so polling never
 * triggers a re-render of the consuming component.
 *
 * `attempt(target)` must return one of:
 *   - "done"  -> attach succeeded, stop the loop
 *   - "abort" -> attach is no longer applicable, stop the loop silently
 *   - "retry" -> target not ready yet, schedule another attempt
 */
export default function useDashboardFocusRetry({
  attempt,
  onGiveUp,
  intervalMs = DASHBOARD_DETAIL_FOCUS_RETRY_MS,
  maxAttempts = DASHBOARD_DETAIL_FOCUS_MAX_ATTEMPTS,
} = {}) {
  const attemptRef = useRef(attempt);
  const onGiveUpRef = useRef(onGiveUp);
  // Keep the latest callbacks in refs so a scheduled poll always invokes the
  // current attach logic. Written in an effect (not during render) so the
  // "latest ref" pattern is safe under concurrent re-renders.
  useEffect(() => {
    attemptRef.current = attempt;
    onGiveUpRef.current = onGiveUp;
  });

  const timeoutRef = useRef(0);
  const retriesRef = useRef(0);

  const cancelFocus = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = 0;
    }
    retriesRef.current = 0;
  }, []);

  const retryFocus = useCallback(
    (target) => {
      cancelFocus();
      const run = () => {
        timeoutRef.current = 0;
        const status = attemptRef.current?.(target);
        if (status !== "retry") return;
        if (retriesRef.current >= maxAttempts) {
          onGiveUpRef.current?.(target);
          return;
        }
        retriesRef.current += 1;
        timeoutRef.current = window.setTimeout(run, intervalMs);
      };
      run();
    },
    [cancelFocus, intervalMs, maxAttempts],
  );

  useEffect(() => cancelFocus, [cancelFocus]);

  return { retryFocus, cancelFocus };
}
