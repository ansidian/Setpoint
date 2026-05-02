import { X } from "lucide-react";
import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampFloatingPosition,
  isRectInside,
  resolveFloatingDetailPlacement,
} from "./calendarFloatingDetailPlacement.js";

function shellTransition(reducedMotion, userDragged) {
  if (reducedMotion || userDragged) return { duration: 0.01 };
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

export default function CalendarFloatingDetailPanel({
  detail,
  label,
  children,
  calendarPanelRef,
  railRef,
  suppressOutsideClick,
  suppressFocusRing = false,
  onClose,
  onPark,
  onUserDraggedChange,
}) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef(null);
  const draggingRef = useRef(false);
  const dragSessionRef = useRef(null);
  const positionRafRef = useRef(0);
  const dragRafRef = useRef(0);
  const pendingDragPointRef = useRef(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 380, height: 0, maxHeight: 520 });
  const [placementState, setPlacementState] = useState({ key: null, placement: null });
  const [manualPosition, setManualPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [feedbackActive, setFeedbackActive] = useState(false);

  const open = !!detail?.open && !!children;
  const mode = detail?.mode || "detail";
  const editorMode = mode === "edit" || mode === "create";
  const contentKey = `${mode}-${detail?.view || "view"}-${detail?.itemId || "item"}-${detail?.dateKey || "date"}`;
  const placementKey = detail?.placementKey;
  const placement = placementState.key === detail?.placementKey
    ? placementState.placement
    : detail?.initialPlacement || null;
  const manualDragActive = !!detail?.userDragged;
  const manualPlacementActive = !detail?.parked && manualPosition?.placementKey === placementKey;

  const computePlacement = useCallback(({ allowPark = true } = {}) => {
    if (!detail || typeof window === "undefined") return null;

    const calendarRect = rectFromElement(calendarPanelRef?.current);
    const railRect = rectFromElement(railRef?.current);
    const anchorRect = rectFromElement(detail.anchorElement);
    const sourceRect = rectFromElement(detail.sourceCellElement);
    const exclusionRect = rectFromElement(detail.exclusionElement);

    if (!detail.parked && (!anchorRect || (calendarRect && !isRectInside(anchorRect, calendarRect)))) {
      if (!allowPark) return null;
      onPark?.();
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
      parked: !!detail.parked,
      preferredSide: detail.preferredSide || null,
      forcedSide: detail.forcedSide || null,
    });
  }, [calendarPanelRef, detail, measuredSize.height, mode, onPark, railRef]);

  const updatePlacement = useCallback(({ allowPark = true } = {}) => {
    if (!open || detail?.userDragged || draggingRef.current || manualPlacementActive) return;
    const next = computePlacement({ allowPark });
    if (!next) return;
    setMeasuredSize((current) => (
      current.width === next.width && current.maxHeight === next.maxHeight
        ? current
        : { ...current, width: next.width, maxHeight: next.maxHeight }
    ));
    setPlacementState((current) => (
      current.key === detail?.placementKey && samePlacement(current.placement, next)
        ? current
        : { key: detail?.placementKey || null, placement: next }
    ));
  }, [computePlacement, detail?.placementKey, detail?.userDragged, manualPlacementActive, open]);

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
    updatePlacement({ allowPark: false });
  }, [updatePlacement]);

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!open || !element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setMeasuredSize((current) => {
        const nextHeight = Math.round(rect.height);
        const nextWidth = Math.round(rect.width || current.width);
        if (current.height === nextHeight && current.width === nextWidth) return current;
        return { ...current, height: nextHeight, width: nextWidth || current.width };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleScroll(event) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (panelRef.current?.contains(target)) return;
        if (target.closest("[data-calendar-local-scroll='true']")) return;
      }
      schedulePlacement();
    }
    window.addEventListener("resize", schedulePlacement);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", schedulePlacement);
      window.removeEventListener("scroll", handleScroll, true);
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
    if (!open || !suppressOutsideClick) return undefined;
    suppressOutsideClick((target) => (
      panelRef.current?.contains(target)
      || (target instanceof HTMLElement && !!target.closest("[data-calendar-floating-detail='true']"))
    ), "floating-detail");
    return () => suppressOutsideClick(null, "floating-detail");
  }, [open, suppressOutsideClick]);

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
      timer = window.setTimeout(() => setFeedbackActive(false), reducedMotion ? 180 : 260);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [detail?.shakeKey, editorMode, open, reducedMotion]);

  const applyManualPosition = useCallback((clientX, clientY) => {
    const session = dragSessionRef.current;
    if (!session || session.placementKey !== placementKey) return;
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
      session.calendarRect,
    );
    setManualPosition((current) => (
      current
        && current.placementKey === session.placementKey
        && Math.round(current.left) === Math.round(next.left)
        && Math.round(current.top) === Math.round(next.top)
        ? current
        : { ...next, placementKey: session.placementKey }
    ));
  }, [measuredSize.height, measuredSize.maxHeight, measuredSize.width, placementKey]);

  const scheduleManualPosition = useCallback((clientX, clientY) => {
    pendingDragPointRef.current = { clientX, clientY };
    if (dragRafRef.current) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = 0;
      const point = pendingDragPointRef.current;
      pendingDragPointRef.current = null;
      if (point) applyManualPosition(point.clientX, point.clientY);
    });
  }, [applyManualPosition]);

  const handleDragPointerDown = useCallback((event) => {
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
  }, [calendarPanelRef, measuredSize.maxHeight, placementKey]);

  const handleDragPointerMove = useCallback((event) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (!session.moved && Math.hypot(deltaX, deltaY) < 2) return;
    session.moved = true;
    setDragging((current) => (current ? current : true));
    scheduleManualPosition(event.clientX, event.clientY);
  }, [scheduleManualPosition]);

  const finishManualDrag = useCallback((event) => {
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
  }, [applyManualPosition, onUserDraggedChange]);

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
  const manualTransitionActive = manualPlacementActive || dragging || manualDragActive;

  return createPortal(
    <AnimatePresence initial={false}>
      <Motion.div
        ref={panelRef}
        data-calendar-floating-detail="true"
        data-calendar-suppress-focus-ring={suppressFocusRing ? "true" : undefined}
        data-forced-side={detail?.forcedSide || undefined}
        data-testid="calendar-floating-detail-panel"
        data-floating-mode={mode}
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
          willChange: reducedMotion ? "auto" : "transform, opacity",
        }}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1, x: resolvedPlacement.left, y: resolvedPlacement.top }}
        exit={reducedMotion ? undefined : { opacity: 0, scale: 0.985 }}
        transition={{
          x: shellTransition(reducedMotion, manualTransitionActive),
          y: shellTransition(reducedMotion, manualTransitionActive),
          opacity: contentTransition(reducedMotion),
          scale: contentTransition(reducedMotion),
        }}
      >
        {!detail.parked && !manualPlacementActive && resolvedPlacement.caretSide ? (
          <span
            aria-hidden="true"
            data-testid="calendar-floating-detail-caret"
            style={{
              position: "absolute",
              top: resolvedPlacement.caretTop,
              [resolvedPlacement.caretSide]: -6,
              width: 12,
              height: 12,
              transform: "rotate(45deg)",
              background: "#1b1b27",
              borderLeft: resolvedPlacement.caretSide === "left" ? "1px solid rgba(203,166,218,0.22)" : 0,
              borderBottom: resolvedPlacement.caretSide === "left" ? "1px solid rgba(203,166,218,0.22)" : 0,
              borderRight: resolvedPlacement.caretSide === "right" ? "1px solid rgba(203,166,218,0.22)" : 0,
              borderTop: resolvedPlacement.caretSide === "right" ? "1px solid rgba(203,166,218,0.22)" : 0,
              boxShadow: "0 0 10px rgba(203,166,218,0.10)",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />
        ) : null}
        <div
          data-calendar-floating-editor-feedback={feedbackActive ? "active" : undefined}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            maxHeight: resolvedPlacement.maxHeight,
            width: "100%",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "#16161e",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
            isolation: "isolate",
            overflow: "hidden",
            overscrollBehavior: "contain",
            zIndex: 1,
            animation: feedbackActive
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
              color: "rgba(205,214,244,0.52)",
            }}
          >
            {label}
          </div>
          <button
            type="button"
            aria-label={editorMode ? "Cancel editor" : "Close floating detail"}
            data-calendar-focus-ring="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.();
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(205,214,244,0.72)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 140ms, border-color 140ms, transform 140ms, color 140ms",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "rgba(255,255,255,0.07)";
              event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
              event.currentTarget.style.color = "#eef2ff";
              event.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "rgba(255,255,255,0.03)";
              event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
              event.currentTarget.style.color = "rgba(205,214,244,0.72)";
              event.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <X size={14} />
          </button>
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
          <div key={contentKey}>
            {children}
          </div>
        </div>
        </div>
      </Motion.div>
    </AnimatePresence>,
    document.body,
  );
}
