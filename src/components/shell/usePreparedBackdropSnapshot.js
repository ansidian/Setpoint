import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  captureAnalyticsBackdropSnapshot,
  prewarmAnalyticsBackdropCapture,
} from "./analyticsBackdropSnapshot.js";

export function usePreparedBackdropSnapshot({
  sourceRef,
  loadSurface = () => {},
  refreshKey,
  tab,
}) {
  const [backdropSnapshot, setBackdropSnapshot] = useState(null);
  const activeRef = useRef(false);
  const preparedBackdropRef = useRef(null);
  const preparedBackdropKeyRef = useRef(null);
  const capturePromisesRef = useRef(new Map());
  const prepareTimerRef = useRef(null);
  const prepareIdleRef = useRef(null);
  const backdropKey = `${tab || "dashboard"}:${refreshKey || ""}`;
  const backdropKeyRef = useRef(backdropKey);

  useLayoutEffect(() => {
    backdropKeyRef.current = backdropKey;
  }, [backdropKey]);

  const clearPrepareSchedule = useCallback(() => {
    if (prepareTimerRef.current) {
      window.clearTimeout(prepareTimerRef.current);
      prepareTimerRef.current = null;
    }
    if (prepareIdleRef.current && window.cancelIdleCallback) {
      window.cancelIdleCallback(prepareIdleRef.current);
      prepareIdleRef.current = null;
    }
  }, []);

  const runBackdropCapture = useCallback(async ({ allowActive = false, publishActive = false } = {}) => {
    const captureKey = backdropKey;
    const existingPromise = capturePromisesRef.current.get(captureKey);
    if (existingPromise) return existingPromise;
    if (activeRef.current && !allowActive) return null;
    const source = sourceRef.current;
    if (!source) return null;

    const capturePromise = captureAnalyticsBackdropSnapshot(source);
    capturePromisesRef.current.set(captureKey, capturePromise);
    const snapshot = await capturePromise;
    capturePromisesRef.current.delete(captureKey);
    if (snapshot) {
      const isCurrentBackdrop = captureKey === backdropKeyRef.current;
      if (isCurrentBackdrop) {
        preparedBackdropRef.current = snapshot;
        preparedBackdropKeyRef.current = captureKey;
      }
      if (activeRef.current && publishActive && isCurrentBackdrop) {
        setBackdropSnapshot(snapshot);
      }
    }
    return snapshot;
  }, [backdropKey, sourceRef]);

  const prepareBackdropSnapshot = useCallback(({ delay = 0 } = {}) => {
    void loadSurface();
    prewarmAnalyticsBackdropCapture();
    if (activeRef.current || capturePromisesRef.current.has(backdropKey)) return;

    clearPrepareSchedule();
    prepareTimerRef.current = window.setTimeout(() => {
      prepareTimerRef.current = null;
      if (activeRef.current) return;
      if (window.requestIdleCallback) {
        prepareIdleRef.current = window.requestIdleCallback(() => {
          prepareIdleRef.current = null;
          if (!activeRef.current) void runBackdropCapture();
        }, { timeout: 1500 });
        return;
      }
      void runBackdropCapture();
    }, delay);
  }, [backdropKey, clearPrepareSchedule, loadSurface, runBackdropCapture]);

  // Capture the backdrop on demand when a modal opens (or pre-warm on hover/focus
  // intent via prepareBackdropSnapshot) — never eagerly on mount or tab change.
  // An eager prep rasterized the whole dashboard to an ~11MB SVG image on every
  // switch: a ~350ms main-thread serialize + GC stall (plus an off-thread decode)
  // that froze the view on each Inbox<->Dashboard switch, confirmed on-device on
  // both desktop and mobile. This effect only cancels a pending intent-scheduled
  // capture on unmount.
  useEffect(() => clearPrepareSchedule, [clearPrepareSchedule]);

  const activateBackdropSnapshot = useCallback(({
    captureIfMissing = false,
    captureIfStale = false,
  } = {}) => {
    activeRef.current = true;
    clearPrepareSchedule();
    const preparedBackdrop = preparedBackdropKeyRef.current === backdropKey
      ? preparedBackdropRef.current
      : null;
    setBackdropSnapshot(preparedBackdrop);
    if (!preparedBackdrop && (captureIfMissing || (captureIfStale && preparedBackdropRef.current))) {
      void runBackdropCapture({ allowActive: true, publishActive: true });
    }
  }, [backdropKey, clearPrepareSchedule, runBackdropCapture]);

  const deactivateBackdropSnapshot = useCallback(({ delay = 500 } = {}) => {
    activeRef.current = false;
    setBackdropSnapshot(null);
    prepareBackdropSnapshot({ delay });
  }, [prepareBackdropSnapshot]);

  return {
    backdropSnapshot,
    prepareBackdropSnapshot,
    activateBackdropSnapshot,
    deactivateBackdropSnapshot,
  };
}
