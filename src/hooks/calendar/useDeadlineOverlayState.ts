import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY,
  DEADLINE_OVERLAY_STORAGE_KEY,
  readStoredBoolean,
  shouldForceDeadlineOverlay,
  writeStoredBoolean,
} from "./calendarModalInteractionModel";

function overlayStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

interface OverlayVisibility {
  eventOverlayVisible: boolean;
  deadlineOverlayVisible: boolean;
  completedDeadlineOverlayVisible: boolean;
}

interface ForcedOverlayVisibility {
  requestKey: string;
  previous: OverlayVisibility & {
    storedDeadlineOverlayVisible: boolean;
    storedCompletedDeadlineOverlayVisible: boolean;
  };
}

export interface DeadlineOverlayStateOptions {
  open: boolean;
  view: string;
  forceEventOverlay?: boolean;
  forceDeadlineOverlay?: boolean;
  forceCompletedDeadlineOverlay?: boolean;
  openRequestId?: number;
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
}: DeadlineOverlayStateOptions) {
  const [eventOverlayVisible, setEventOverlayVisible] = useState(true);
  const [deadlineOverlayVisible, setDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [completedDeadlineOverlayVisible, setCompletedDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(overlayStorage(), COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const forcedVisibilityRef = useRef<ForcedOverlayVisibility | null>(null);
  const overlayVisibilityRef = useRef<OverlayVisibility | null>(null);

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

  const setDeadlineOverlayVisiblePersisted = useCallback((value: boolean) => {
    setDeadlineOverlayVisible(value);
    writeStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, value);
  }, []);

  // Undo a dashboard-forced open: return the in-memory flags (and the stored
  // deadline preferences) to the snapshot captured before the force, so a forced
  // peek never clobbers the user's saved choice. Idempotent — a null ref no-ops,
  // so it is safe to call from both restore triggers below.
  const restoreForcedOverlays = useCallback(() => {
    const forced = forcedVisibilityRef.current;
    if (!forced) return;
    forcedVisibilityRef.current = null;
    const { previous } = forced;
    setEventOverlayVisible(previous.eventOverlayVisible);
    setDeadlineOverlayVisible(previous.deadlineOverlayVisible);
    setCompletedDeadlineOverlayVisible(previous.completedDeadlineOverlayVisible);
    writeStoredBoolean(overlayStorage(), DEADLINE_OVERLAY_STORAGE_KEY, previous.storedDeadlineOverlayVisible);
    writeStoredBoolean(overlayStorage(), COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, previous.storedCompletedDeadlineOverlayVisible);
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

  // Restore on leave. Two triggers, because the calendar surface can go away two
  // ways: an explicit close (`open` → false, the modal-era path still covered by
  // tests) and the calendar keep-alive tab being hidden. As a persistent tab,
  // `open` stays true for its whole lifetime, so React's <Activity> is what
  // signals "left the calendar": it runs this effect's cleanup when the tab is
  // hidden (the same settle-on-leave lever InboxView uses). Either way we revert
  // any dashboard-forced overlays to the user's stored preferences.
  useEffect(() => {
    if (!open) {
      restoreForcedOverlays();
      return undefined;
    }
    return restoreForcedOverlays;
  }, [open, restoreForcedOverlays]);

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

export type DeadlineOverlayStateController = ReturnType<typeof useDeadlineOverlayState>;
