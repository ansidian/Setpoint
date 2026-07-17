import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { resolveFloatingDetailPlacement } from "./calendarFloatingDetailPlacement";
import type { FloatingDetailPlacement, FloatingDetailSide } from "./calendarFloatingDetailPlacement";
import type { FloatingDetailMeasuredSize } from "./calendarFloatingDetailRevealModel";
import useFloatingDetailDrag, { rectFromElement } from "./useFloatingDetailDrag";
import {
  isAwaitingMeasuredPlacement,
  isInstantPlacementTransition,
  isManualTransitionActive,
  isSnapTransitionActive,
  resolveAnchoredPlacement,
  resolveRenderPlacement,
  samePlacement,
} from "./calendarFloatingDetailRevealModel";

export interface FloatingDetailPlacementTarget {
  placementKey?: string;
  anchorElement?: HTMLElement | null;
  sourceCellElement?: HTMLElement | null;
  exclusionElement?: HTMLElement | null;
  initialPlacement?: FloatingDetailPlacement | null;
  userDragged?: boolean;
  preferredSide?: FloatingDetailSide | null;
  forcedSide?: FloatingDetailSide | null;
  sideIntent?: string | null;
}

export interface FloatingDetailPlacementOptions {
  detail: FloatingDetailPlacementTarget | null;
  open: boolean;
  mode?: string;
  calendarPanelRef: RefObject<HTMLElement | null>;
  railRef: RefObject<HTMLElement | null>;
  onUserDraggedChange?: (dragged: boolean, placementKey: string) => void;
}

// The floating detail panel's positioning state machine, lifted out of
// CalendarFloatingDetailPanel: measure (ResizeObserver) → reveal gate → side-flip
// snap, plus the anchored-placement compute/clamp. It HOSTS useFloatingDetailDrag
// rather than running beside it because the two are cyclically coupled — placement
// recompute bails on live drag state (`draggingRef`, `manualPlacementActive`) while
// the drag clamp reads `measuredSize`. Nesting (drag declared first, here) keeps
// that coupling in one render path with no behavior-changing ref indirection.
export default function useFloatingDetailPlacement({
  detail,
  open,
  mode,
  calendarPanelRef,
  railRef,
  onUserDraggedChange,
}: FloatingDetailPlacementOptions) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const positionRafRef = useRef(0);
  const measuredPlacementKeysRef = useRef(new Set<string>());
  const snapNextMeasuredPlacementKeyRef = useRef<string | null>(null);
  const [measuredSize, setMeasuredSize] = useState<FloatingDetailMeasuredSize>({ width: 380, height: 0, maxHeight: 520 });
  const [placementState, setPlacementState] = useState<{ key: string | null; placement: FloatingDetailPlacement | null }>({ key: null, placement: null });
  const [measuredPlacementKey, setMeasuredPlacementKey] = useState<string | null>(null);
  const [snapPlacementKey, setSnapPlacementKey] = useState<string | null>(null);
  const [snapPlacementIntent, setSnapPlacementIntent] = useState<string | null>(null);
  const [hasRevealedMeasuredPlacement, setHasRevealedMeasuredPlacement] = useState(false);

  const placementKey = detail?.placementKey;

  const {
    manualPosition,
    dragging,
    draggingRef,
    handleDragPointerDown,
    handleDragPointerMove,
    finishManualDrag,
    cancelPendingDrag,
  } = useFloatingDetailDrag({
    placementKey,
    measuredSize,
    calendarPanelRef,
    panelRef,
    onUserDraggedChange,
  });

  const placement =
    placementState.key === detail?.placementKey
      ? placementState.placement
      : detail?.initialPlacement || null;
  const manualDragActive = !!detail?.userDragged;
  const manualPlacementActive = manualPosition?.placementKey === placementKey;

  const computePlacement = useCallback(
    () => {
      if (!detail || typeof window === "undefined") return null;

      const calendarRect = rectFromElement(calendarPanelRef?.current);
      const railRect = rectFromElement(railRef?.current);
      const anchorRect = rectFromElement(detail.anchorElement);
      const sourceRect = rectFromElement(detail.sourceCellElement);
      const exclusionRect = rectFromElement(detail.exclusionElement);

      if (!anchorRect) {
        return null;
      }

      return resolveFloatingDetailPlacement({
        anchorRect,
        sourceRect,
        exclusionRect,
        calendarRect,
        railRect,
        panelHeight: measuredSize.height,
        mode,
        preferredSide: detail.preferredSide || null,
        forcedSide: detail.forcedSide || null,
        allowRailOverlap: detail.sideIntent === "user-flip",
      });
    },
    [
      calendarPanelRef,
      detail,
      measuredSize.height,
      mode,
      railRef,
    ],
  );

  const updatePlacement = useCallback(
    () => {
      if (
        !open ||
        detail?.userDragged ||
        draggingRef.current ||
        manualPlacementActive
      )
        return;
      const next = computePlacement();
      if (!next) return;
      if (snapNextMeasuredPlacementKeyRef.current === detail?.placementKey) {
        snapNextMeasuredPlacementKeyRef.current = null;
        setSnapPlacementKey(detail?.placementKey || null);
      }
      setMeasuredSize((current) =>
        current.width === next.width && current.maxHeight === next.maxHeight
          ? current
          : { ...current, width: next.width, maxHeight: next.maxHeight },
      );
      setPlacementState((current) =>
        current.key === detail?.placementKey &&
        samePlacement(current.placement, next)
          ? current
          : { key: detail?.placementKey || null, placement: next },
      );
    },
    [
      computePlacement,
      detail?.placementKey,
      detail?.userDragged,
      draggingRef,
      manualPlacementActive,
      open,
    ],
  );

  const schedulePlacement = useCallback(() => {
    if (positionRafRef.current) return;
    positionRafRef.current = window.requestAnimationFrame(() => {
      positionRafRef.current = 0;
      updatePlacement();
    });
  }, [updatePlacement]);

  useLayoutEffect(() => {
    // Pre-paint DOM measurement prevents the panel from animating through the rail before it flips.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updatePlacement();
  }, [updatePlacement]);

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!open || !element || typeof ResizeObserver === "undefined")
      return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setMeasuredSize((current) => {
        const nextHeight = Math.round(rect.height);
        const nextWidth = Math.round(rect.width || current.width);
        if (
          placementKey &&
          !measuredPlacementKeysRef.current.has(placementKey)
        ) {
          measuredPlacementKeysRef.current.add(placementKey);
          if (!hasRevealedMeasuredPlacement) {
            snapNextMeasuredPlacementKeyRef.current = placementKey;
            setSnapPlacementIntent(detail?.sideIntent || "auto");
          }
          setMeasuredPlacementKey(placementKey);
        }
        if (current.height === nextHeight && current.width === nextWidth)
          return current;
        return {
          ...current,
          height: nextHeight,
          width: nextWidth || current.width,
        };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [detail?.sideIntent, hasRevealedMeasuredPlacement, open, placementKey]);

  useEffect(() => {
    if (!snapPlacementKey || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      setSnapPlacementKey(null);
      setSnapPlacementIntent(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [snapPlacementKey]);

  useEffect(() => {
    const nextRevealed = open
      ? !placementKey ||
        measuredPlacementKey === placementKey ||
        hasRevealedMeasuredPlacement
      : false;
    if (nextRevealed === hasRevealedMeasuredPlacement) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasRevealedMeasuredPlacement(nextRevealed);
  }, [hasRevealedMeasuredPlacement, measuredPlacementKey, open, placementKey]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("resize", schedulePlacement);
    return () => {
      window.removeEventListener("resize", schedulePlacement);
      if (positionRafRef.current) {
        window.cancelAnimationFrame(positionRafRef.current);
        positionRafRef.current = 0;
      }
      cancelPendingDrag();
    };
  }, [cancelPendingDrag, open, schedulePlacement]);

  const anchoredPlacement = resolveAnchoredPlacement(placement, measuredSize);
  const resolvedPlacement = resolveRenderPlacement(anchoredPlacement, {
    manualPlacementActive,
    manualPosition,
  });
  const manualTransitionActive = isManualTransitionActive({
    manualPlacementActive,
    dragging,
    manualDragActive,
  });
  const snapTransitionActive = isSnapTransitionActive({
    snapPlacementKey,
    placementKey,
    snapPlacementIntent,
    sideIntent: detail?.sideIntent,
    hasRevealedMeasuredPlacement,
  });
  const awaitingMeasuredPlacement = isAwaitingMeasuredPlacement({
    open,
    placementKey,
    resizeObserverAvailable: typeof ResizeObserver !== "undefined",
    manualPlacementActive,
    hasRevealedMeasuredPlacement,
    measuredPlacementKey,
  });
  const instantPlacementTransition = isInstantPlacementTransition({
    manualTransitionActive,
    snapTransitionActive,
    awaitingMeasuredPlacement,
  });

  return {
    panelRef,
    resolvedPlacement,
    manualPlacementActive,
    awaitingMeasuredPlacement,
    instantPlacementTransition,
    dragging,
    handleDragPointerDown,
    handleDragPointerMove,
    finishManualDrag,
  };
}
