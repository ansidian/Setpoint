import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CalendarFloatingDetailCaret from "./CalendarFloatingDetailCaret.jsx";
import CalendarFloatingDetailCloseButton from "./CalendarFloatingDetailCloseButton.jsx";
import {
  clampFloatingPosition,
  resolveFloatingDetailPlacement,
} from "./calendarFloatingDetailPlacement.js";

function shellTransition(reducedMotion, instantPosition) {
  if (reducedMotion || instantPosition) return { duration: 0.01 };
  return {
    type: "spring",
    stiffness: 420,
    damping: 42,
    mass: 0.8,
  };
}

function contentTransition(reducedMotion) {
  if (reducedMotion) return { duration: 0 };
  return {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
  };
}

function samePlacement(a, b) {
  return a
    && b
    && Math.round(a.top) === Math.round(b.top)
    && Math.round(a.left) === Math.round(b.left)
    && Math.round(a.width) === Math.round(b.width)
    && Math.round(a.maxHeight) === Math.round(b.maxHeight)
    && Math.round(a.caretTop || 0) === Math.round(b.caretTop || 0)
    && a.caretSide === b.caretSide;
}

function rectFromElement(element) {
  return element?.isConnected ? element.getBoundingClientRect() : null;
}

// On Windows at a fractional devicePixelRatio (e.g. 1.25), a GPU-composited layer
// (this panel uses willChange: transform) positioned at a fractional CSS-pixel
// translate lands between physical pixels. Each repaint — including the ones a
// keystroke triggers when the title/draft-preview text inside the panel changes —
// re-rasterizes the layer against the device grid and snaps text/edges ~1px
// differently, producing a per-keystroke shimmer with no layout/transform change.
// Snapping the translate to the physical-pixel grid keeps every repaint identical.
// Integer DPR (Mac Retina 2.0, or 1.0) already lands on the grid, so this is a no-op there.
function snapToDevicePixel(value) {
  if (typeof window === "undefined" || !Number.isFinite(value)) return value;
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

export default function CalendarFloatingDetailPanel({
  detail,
  label,
  children,
  calendarPanelRef,
  railRef,
  suppressFocusRing = false,
  onClose,
  onUserDraggedChange,
}) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef(null);
  const draggingRef = useRef(false);
  const dragSessionRef = useRef(null);
  const positionRafRef = useRef(0);
  const dragRafRef = useRef(0);
  const pendingDragPointRef = useRef(null);
  const measuredPlacementKeysRef = useRef(new Set());
  const snapNextMeasuredPlacementKeyRef = useRef(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 380, height: 0, maxHeight: 520 });
  const [placementState, setPlacementState] = useState({ key: null, placement: null });
  const [manualPosition, setManualPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [feedbackActive, setFeedbackActive] = useState(false);
  const [measuredPlacementKey, setMeasuredPlacementKey] = useState(null);
  const [snapPlacementKey, setSnapPlacementKey] = useState(null);
  const [snapPlacementIntent, setSnapPlacementIntent] = useState(null);
  const [hasRevealedMeasuredPlacement, setHasRevealedMeasuredPlacement] = useState(false);

  const open = !!detail?.open && !!children;
  const mode = detail?.mode || "detail";
  const editorMode = mode === "edit" || mode === "create";
  const contentKey = `${mode}-${detail?.view || "view"}-${detail?.itemId || "item"}-${detail?.dateKey || "date"}`;
  const placementKey = detail?.placementKey;
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
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      pendingDragPointRef.current = null;
    };
  }, [open, schedulePlacement]);

  useEffect(() => {
    if (!open || !editorMode) return undefined;
    const id = window.requestAnimationFrame(() => {
      const selectors = [
        "[data-calendar-editor-primary='true']:not([disabled])",
        "input[data-testid='calendar-event-title']:not([disabled])",
        "input[aria-label='Task title']:not([disabled])",
        "input:not([type='hidden']):not([disabled])",
        "textarea:not([disabled])",
        "button:not([disabled])",
      ];
      const element = selectors
        .map((selector) => panelRef.current?.querySelector?.(selector))
        .find(Boolean);
      element?.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [contentKey, editorMode, open]);

  useEffect(() => {
    if (!open || !editorMode || !detail?.shakeKey) return undefined;
    let timer = 0;
    const raf = window.requestAnimationFrame(() => {
      setFeedbackActive(true);
      timer = window.setTimeout(
        () => setFeedbackActive(false),
        reducedMotion ? 180 : 260,
      );
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [detail?.shakeKey, editorMode, open, reducedMotion]);

  const applyManualPosition = useCallback(
    (clientX, clientY) => {
      const session = dragSessionRef.current;
      if (!session || session.placementKey !== placementKey) return;
      // Clamp against the calendar's LIVE rect, not the one captured at pointer-down.
      // If the viewport resizes or the layout shifts mid-drag, the pointer-down rect
      // is stale and would clamp to the wrong bounds. Re-reading is one
      // getBoundingClientRect per rAF-throttled move — negligible. Fall back to the
      // cached session rect only when the element is gone (disconnected/unmounted).
      const liveCalendarRect =
        rectFromElement(calendarPanelRef?.current) || session.calendarRect;
      const next = clampFloatingPosition(
        {
          left: clientX - session.offsetX,
          top: clientY - session.offsetY,
        },
        {
          width: session.panelWidth || measuredSize.width,
          height: session.panelHeight || measuredSize.height || 300,
          maxHeight: session.maxHeight || measuredSize.maxHeight,
        },
        liveCalendarRect,
      );
      setManualPosition((current) =>
        current &&
        current.placementKey === session.placementKey &&
        Math.round(current.left) === Math.round(next.left) &&
        Math.round(current.top) === Math.round(next.top)
          ? current
          : { ...next, placementKey: session.placementKey },
      );
    },
    [
      calendarPanelRef,
      measuredSize.height,
      measuredSize.maxHeight,
      measuredSize.width,
      placementKey,
    ],
  );

  const scheduleManualPosition = useCallback(
    (clientX, clientY) => {
      pendingDragPointRef.current = { clientX, clientY };
      if (dragRafRef.current) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = 0;
        const point = pendingDragPointRef.current;
        pendingDragPointRef.current = null;
        if (point) applyManualPosition(point.clientX, point.clientY);
      });
    },
    [applyManualPosition],
  );

  const handleDragPointerDown = useCallback(
    (event) => {
      if ((event.button ?? 0) !== 0) return;
      const panelRect = rectFromElement(panelRef.current);
      if (!panelRect || !placementKey) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      draggingRef.current = true;
      dragSessionRef.current = {
        pointerId: event.pointerId,
        placementKey,
        offsetX: event.clientX - panelRect.left,
        offsetY: event.clientY - panelRect.top,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
        maxHeight: measuredSize.maxHeight,
        calendarRect: rectFromElement(calendarPanelRef?.current),
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    },
    [calendarPanelRef, measuredSize.maxHeight, placementKey],
  );

  const handleDragPointerMove = useCallback(
    (event) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      if (!session.moved && Math.hypot(deltaX, deltaY) < 2) return;
      session.moved = true;
      setDragging((current) => (current ? current : true));
      scheduleManualPosition(event.clientX, event.clientY);
    },
    [scheduleManualPosition],
  );

  const finishManualDrag = useCallback(
    (event) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (session.moved) {
        if (dragRafRef.current) {
          window.cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = 0;
        }
        pendingDragPointRef.current = null;
        applyManualPosition(event.clientX, event.clientY);
      }
      dragSessionRef.current = null;
      draggingRef.current = false;
      setDragging(false);
      if (!session.moved) return;
      onUserDraggedChange?.(true, session.placementKey);
    },
    [applyManualPosition, onUserDraggedChange],
  );

  if (!open || typeof document === "undefined") return null;

  const anchoredPlacement = placement || {
    top: 24,
    left: 24,
    width: measuredSize.width,
    maxHeight: measuredSize.maxHeight,
    caretSide: null,
    caretTop: 0,
  };
  const resolvedPlacement = manualPlacementActive
    ? {
        ...anchoredPlacement,
        top: manualPosition.top,
        left: manualPosition.left,
        caretSide: null,
        caretTop: 0,
      }
    : anchoredPlacement;
  const manualTransitionActive =
    manualPlacementActive || dragging || manualDragActive;
  const snapTransitionActive =
    snapPlacementKey === placementKey &&
    (snapPlacementIntent === "user-flip" ||
      !(detail?.sideIntent === "user-flip" && hasRevealedMeasuredPlacement));
  const awaitingMeasuredPlacement =
    open &&
    !!placementKey &&
    typeof ResizeObserver !== "undefined" &&
    !manualPlacementActive &&
    !hasRevealedMeasuredPlacement &&
    measuredPlacementKey !== placementKey;
  const feedbackVisible =
    feedbackActive && open && editorMode && !!detail?.shakeKey;
  const instantPlacementTransition =
    manualTransitionActive || snapTransitionActive || awaitingMeasuredPlacement;

  return createPortal(
    <AnimatePresence initial={false}>
      <Motion.div
        ref={panelRef}
        data-calendar-floating-detail="true"
        data-calendar-suppress-focus-ring={
          suppressFocusRing ? "true" : undefined
        }
        data-forced-side={detail?.forcedSide || undefined}
        data-side-intent={detail?.sideIntent || "auto"}
        data-testid="calendar-floating-detail-panel"
        data-floating-mode={mode}
        data-anchor-kind={detail?.anchorKind || undefined}
        role="dialog"
        aria-label={label || "Calendar floating detail"}
        className="isolate"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: resolvedPlacement.width,
          maxHeight: resolvedPlacement.maxHeight,
          zIndex: 54,
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          background: "transparent",
          isolation: "isolate",
          overflow: "visible",
          // Intentionally no hardcoded `will-change`. Forcing "transform, opacity"
          // kept the panel permanently on its own GPU layer; on Windows at fractional
          // DPR (1.25) that idle layer re-rasterizes text ~1px on every keystroke-driven
          // repaint (sub-pixel shimmer with no layout/transform change). Motion manages
          // will-change around its own animations, so letting the panel de-promote once
          // the open spring settles renders text on the main compositor where it's stable.
        }}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.985 }}
        animate={{
          opacity: awaitingMeasuredPlacement ? 0 : 1,
          scale: awaitingMeasuredPlacement ? 0.985 : 1,
          x: snapToDevicePixel(resolvedPlacement.left),
          y: snapToDevicePixel(resolvedPlacement.top),
        }}
        exit={reducedMotion ? undefined : { opacity: 0, scale: 0.985 }}
        transition={{
          x: shellTransition(reducedMotion, instantPlacementTransition),
          y: shellTransition(reducedMotion, instantPlacementTransition),
          opacity: contentTransition(reducedMotion),
          scale: contentTransition(reducedMotion),
        }}
      >
        {!manualPlacementActive ? (
          <CalendarFloatingDetailCaret
            caretSide={resolvedPlacement.caretSide}
            caretTop={resolvedPlacement.caretTop}
          />
        ) : null}
        <div
          data-calendar-floating-editor-feedback={
            feedbackVisible ? "active" : undefined
          }
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            maxHeight: resolvedPlacement.maxHeight,
            width: "100%",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "var(--sp-panel)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
            isolation: "isolate",
            overflow: "hidden",
            overscrollBehavior: "contain",
            zIndex: 1,
            animation: feedbackVisible
              ? reducedMotion
                ? "calendarFloatingEditorPulse 170ms cubic-bezier(0.16, 1, 0.3, 1)"
                : "calendarFloatingEditorShake 230ms cubic-bezier(0.16, 1, 0.3, 1)"
              : "none",
          }}
        >
          <div
            onPointerDown={handleDragPointerDown}
            onPointerMove={handleDragPointerMove}
            onPointerUp={finishManualDrag}
            onPointerCancel={finishManualDrag}
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              minHeight: 36,
              padding: "9px 10px 8px 12px",
              cursor: dragging ? "grabbing" : "grab",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.018)",
              userSelect: "none",
              touchAction: "none",
            }}
          >
            <div
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.7,
                textTransform: "uppercase",
                color: "var(--color-text-faint)",
              }}
            >
              {label}
            </div>
            <CalendarFloatingDetailCloseButton editorMode={editorMode} onClose={onClose} />
          </div>
          <div
            data-calendar-local-scroll="true"
            style={{
              position: "relative",
              zIndex: 1,
              overflowY: "auto",
              overscrollBehavior: "contain",
              padding: 12,
              minHeight: 0,
              maxHeight: Math.max(120, resolvedPlacement.maxHeight - 37),
              scrollbarGutter: "stable",
            }}
          >
            <div key={contentKey}>{children}</div>
          </div>
        </div>
      </Motion.div>
    </AnimatePresence>,
    document.body,
  );
}
