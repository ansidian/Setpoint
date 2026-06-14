import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY,
  DEADLINE_OVERLAY_STORAGE_KEY,
  readStoredBoolean,
  shouldForceDeadlineOverlay,
  writeStoredBoolean,
} from "./calendarModalInteractionModel.js";

function overlayStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * Owns the calendar modal's overlay-visibility triad and its persistence:
 *   - `eventOverlayVisible` (session-only, not persisted)
 *   - `deadlineOverlayVisible` (persisted under DEADLINE_OVERLAY_STORAGE_KEY)
 *   - `completedDeadlineOverlayVisible` (persisted under COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY)
 *
 * This is the single source of truth for overlay visibility (D-CAL-6): the flags
 * originate only here, and the consumers (eventsView.compute, eventsPlanningModel,
 * useCalendarModalViewModel) read the propagated values rather than storage.
 *
 * The deadline toggles write back on every change so preferences survive a refresh
 * (D-CAL-4). The three flags share one force/restore lifecycle: a dashboard-originated
 * open with `force*Overlay` props turns the requested overlays on while stashing the
 * prior visibility (and the stored deadline preferences), then restores both the
 * in-memory flags and the stored preferences when the modal closes — so a forced open
 * never clobbers the user's saved choice.
 */
export default function useDeadlineOverlayState({
  open,
  view,
  forceEventOverlay = false,
  forceDeadlineOverlay = false,
  forceCompletedDeadlineOverlay = false,
  openRequestId = 0,
}) {
  const [eventOverlayVisible, setEventOverlayVisible] = useState(true);
  const [deadlineOverlayVisible, setDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [completedDeadlineOverlayVisible, setCompletedDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(overlayStorage(), COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const forcedVisibilityRef = useRef(null);
  const overlayVisibilityRef = useRef(null);

  const toggleEventOverlay = useCallback(() => {
    setEventOverlayVisible((current) => !current);
  }, []);

  const toggleDeadlineOverlay = useCallback(() => {
    setDeadlineOverlayVisible((current) => {
      const next = !current;
      writeStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleCompletedDeadlineOverlay = useCallback(() => {
    setCompletedDeadlineOverlayVisible((current) => {
      const next = !current;
      writeStoredBoolean(overlayStorage(), COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setDeadlineOverlayVisiblePersisted = useCallback((value) => {
    setDeadlineOverlayVisible(value);
    writeStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, value);
  }, []);

  useEffect(() => {
    overlayVisibilityRef.current = {
      eventOverlayVisible,
      deadlineOverlayVisible,
      completedDeadlineOverlayVisible,
    };
  }, [completedDeadlineOverlayVisible, deadlineOverlayVisible, eventOverlayVisible]);

  useEffect(() => {
    if (!shouldForceDeadlineOverlay({ open, view, forceDeadlineOverlay })) return;
    setDeadlineOverlayVisible(true);
  }, [forceDeadlineOverlay, open, openRequestId, view]);

  useEffect(() => {
    if (!open || view !== "events") return;
    if (!forceEventOverlay && !forceDeadlineOverlay && !forceCompletedDeadlineOverlay) return;
    const requestKey = [
      openRequestId,
      view,
      forceEventOverlay ? "events" : "",
      forceDeadlineOverlay ? "deadlines" : "",
      forceCompletedDeadlineOverlay ? "completed" : "",
    ].join(":");
    if (forcedVisibilityRef.current?.requestKey === requestKey) return;
    if (forcedVisibilityRef.current) {
      forcedVisibilityRef.current.requestKey = requestKey;
      if (forceEventOverlay) setEventOverlayVisible(true);
      if (forceDeadlineOverlay) setDeadlineOverlayVisible(true);
      if (forceCompletedDeadlineOverlay) setCompletedDeadlineOverlayVisible(true);
      return;
    }
    const current = overlayVisibilityRef.current || {
      eventOverlayVisible,
      deadlineOverlayVisible,
      completedDeadlineOverlayVisible,
    };
    forcedVisibilityRef.current = {
      requestKey,
      previous: {
        ...current,
        storedDeadlineOverlayVisible: readStoredBoolean(
          overlayStorage(),
          DEADLINE_OVERLAY_STORAGE_KEY,
          current.deadlineOverlayVisible,
        ),
        storedCompletedDeadlineOverlayVisible: readStoredBoolean(
          overlayStorage(),
          COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY,
          current.completedDeadlineOverlayVisible,
        ),
      },
    };
    if (forceEventOverlay) setEventOverlayVisible(true);
    if (forceDeadlineOverlay) setDeadlineOverlayVisible(true);
    if (forceCompletedDeadlineOverlay) setCompletedDeadlineOverlayVisible(true);
  // Capture the prior visibility exactly once for each dashboard-originated open request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceCompletedDeadlineOverlay, forceDeadlineOverlay, forceEventOverlay, open, openRequestId, view]);

  useEffect(() => {
    if (open || !forcedVisibilityRef.current) return;
    const previous = forcedVisibilityRef.current.previous;
    forcedVisibilityRef.current = null;
    setEventOverlayVisible(previous.eventOverlayVisible);
    setDeadlineOverlayVisible(previous.deadlineOverlayVisible);
    setCompletedDeadlineOverlayVisible(previous.completedDeadlineOverlayVisible);
    writeStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, previous.storedDeadlineOverlayVisible);
    writeStoredBoolean(overlayStorage(), COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, previous.storedCompletedDeadlineOverlayVisible);
  }, [open]);

  return {
    eventOverlayVisible,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    toggleEventOverlay,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
  };
}
