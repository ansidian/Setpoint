import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureAnalyticsBackdropSnapshot,
  prewarmAnalyticsBackdropCapture,
} from "./analyticsBackdropSnapshot.js";

export function usePreparedBackdropSnapshot({
  sourceRef,
  loadSurface = () => {},
  refreshing,
  refreshKey,
  tab,
}) {
  const [backdropSnapshot, setBackdropSnapshot] = useState(null);
  const activeRef = useRef(false);
  const preparedBackdropRef = useRef(null);
  const capturePromiseRef = useRef(null);
  const prepareTimerRef = useRef(null);
  const prepareIdleRef = useRef(null);

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
    if (capturePromiseRef.current) return capturePromiseRef.current;
    if (activeRef.current && !allowActive) return null;
    const source = sourceRef.current;
    if (!source) return null;

    capturePromiseRef.current = captureAnalyticsBackdropSnapshot(source);
    const snapshot = await capturePromiseRef.current;
    capturePromiseRef.current = null;
    if (snapshot) {
      preparedBackdropRef.current = snapshot;
      if (activeRef.current && publishActive) setBackdropSnapshot(snapshot);
    }
    return snapshot;
  }, [sourceRef]);

  const prepareBackdropSnapshot = useCallback(({ delay = 0 } = {}) => {
    void loadSurface();
    prewarmAnalyticsBackdropCapture();
    if (activeRef.current || capturePromiseRef.current) return;

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
  }, [clearPrepareSchedule, loadSurface, runBackdropCapture]);

  useEffect(() => {
    prepareBackdropSnapshot({ delay: 700 });
    return clearPrepareSchedule;
  }, [clearPrepareSchedule, prepareBackdropSnapshot]);

  useEffect(() => {
    if (refreshing || activeRef.current) return;
    prepareBackdropSnapshot({ delay: 900 });
  }, [prepareBackdropSnapshot, refreshKey, refreshing, tab]);

  const activateBackdropSnapshot = useCallback(({ captureIfMissing = false } = {}) => {
    activeRef.current = true;
    clearPrepareSchedule();
    setBackdropSnapshot(preparedBackdropRef.current);
    if (!preparedBackdropRef.current && captureIfMissing) {
      void runBackdropCapture({ allowActive: true, publishActive: true });
    }
  }, [clearPrepareSchedule, runBackdropCapture]);

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
