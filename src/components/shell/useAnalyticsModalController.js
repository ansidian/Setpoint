import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureAnalyticsBackdropSnapshot,
  prewarmAnalyticsBackdropCapture,
} from "./analyticsBackdropSnapshot.js";

export function useAnalyticsModalController({
  sourceRef,
  loadModal,
  refreshing,
  refreshKey,
  tab,
}) {
  const [open, setOpen] = useState(false);
  const [backdropSnapshot, setBackdropSnapshot] = useState(null);
  const requestRef = useRef(0);
  const openRef = useRef(false);
  const preparedBackdropRef = useRef(null);
  const capturePromiseRef = useRef(null);
  const prepareTimerRef = useRef(null);
  const prepareIdleRef = useRef(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

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

  const runBackdropCapture = useCallback(async () => {
    if (capturePromiseRef.current) return capturePromiseRef.current;
    if (openRef.current) return null;
    const source = sourceRef.current;
    if (!source) return null;

    capturePromiseRef.current = captureAnalyticsBackdropSnapshot(source);
    const snapshot = await capturePromiseRef.current;
    capturePromiseRef.current = null;
    if (snapshot && !openRef.current) preparedBackdropRef.current = snapshot;
    return snapshot;
  }, [sourceRef]);

  const prepareSurface = useCallback(({ delay = 0 } = {}) => {
    void loadModal();
    prewarmAnalyticsBackdropCapture();
    if (openRef.current || capturePromiseRef.current) return;

    clearPrepareSchedule();
    prepareTimerRef.current = window.setTimeout(() => {
      prepareTimerRef.current = null;
      if (openRef.current) return;
      if (window.requestIdleCallback) {
        prepareIdleRef.current = window.requestIdleCallback(() => {
          prepareIdleRef.current = null;
          if (!openRef.current) void runBackdropCapture();
        }, { timeout: 1500 });
        return;
      }
      void runBackdropCapture();
    }, delay);
  }, [clearPrepareSchedule, loadModal, runBackdropCapture]);

  useEffect(() => {
    prepareSurface({ delay: 700 });
    return clearPrepareSchedule;
  }, [clearPrepareSchedule, prepareSurface]);

  useEffect(() => {
    if (refreshing || open) return;
    prepareSurface({ delay: 900 });
  }, [open, prepareSurface, refreshKey, refreshing, tab]);

  const closeAnalytics = useCallback(() => {
    requestRef.current += 1;
    openRef.current = false;
    setOpen(false);
    setBackdropSnapshot(null);
    prepareSurface({ delay: 500 });
  }, [prepareSurface]);

  const openAnalytics = useCallback(() => {
    requestRef.current += 1;
    openRef.current = true;
    clearPrepareSchedule();
    setBackdropSnapshot(preparedBackdropRef.current);
    setOpen(true);
  }, [clearPrepareSchedule]);

  return {
    analyticsOpen: open,
    analyticsBackdropSnapshot: backdropSnapshot,
    closeAnalytics,
    openAnalytics,
    prepareAnalyticsSurface: prepareSurface,
  };
}
