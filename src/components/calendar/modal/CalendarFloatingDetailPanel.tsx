import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import CalendarFloatingDetailCaret from "./CalendarFloatingDetailCaret";
import CalendarFloatingDetailCloseButton from "./CalendarFloatingDetailCloseButton";
import useFloatingDetailPlacement from "./useFloatingDetailPlacement";
import type { FloatingDetailPlacementTarget } from "./useFloatingDetailPlacement";
import type { CalendarFloatingDetail } from "../../../hooks/calendar/useCalendarFloatingDetail";

function shellTransition(reducedMotion: boolean | null, instantPosition: boolean): Transition {
  if (reducedMotion || instantPosition) return { duration: 0.01 };
  return {
    type: "spring",
    stiffness: 420,
    damping: 42,
    mass: 0.8,
  };
}

function contentTransition(reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0 };
  return {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
  };
}

// On Windows at a fractional devicePixelRatio (e.g. 1.25), a GPU-composited layer
// (this panel uses willChange: transform) positioned at a fractional CSS-pixel
// translate lands between physical pixels. Each repaint — including the ones a
// keystroke triggers when the title/draft-preview text inside the panel changes —
// re-rasterizes the layer against the device grid and snaps text/edges ~1px
// differently, producing a per-keystroke shimmer with no layout/transform change.
// Snapping the translate to the physical-pixel grid keeps every repaint identical.
// Integer DPR (Mac Retina 2.0, or 1.0) already lands on the grid, so this is a no-op there.
function snapToDevicePixel(value: number): number {
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
}: {
  detail: (Omit<CalendarFloatingDetail, "preferredSide" | "forcedSide" | "sideIntent"> & {
    preferredSide?: string | null;
    forcedSide?: string | null;
    sideIntent?: string | null;
  }) | null;
  label?: string | null;
  children?: ReactNode;
  calendarPanelRef: RefObject<HTMLElement | null>;
  railRef: RefObject<HTMLElement | null>;
  suppressFocusRing?: boolean;
  onClose?: () => void;
  onUserDraggedChange?: (dragged: boolean, placementKey: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [feedbackActive, setFeedbackActive] = useState(false);

  const open = !!detail?.open && !!children;
  const mode = detail?.mode || "detail";
  const editorMode = mode === "edit" || mode === "create";
  const eventEditorMode = editorMode && detail?.view === "events";
  const contentKey = `${mode}-${detail?.view || "view"}-${detail?.itemId || "item"}-${detail?.dateKey || "date"}`;

  const {
    panelRef,
    resolvedPlacement,
    manualPlacementActive,
    awaitingMeasuredPlacement,
    instantPlacementTransition,
    dragging,
    handleDragPointerDown,
    handleDragPointerMove,
    finishManualDrag,
  } = useFloatingDetailPlacement({
    detail: detail as FloatingDetailPlacementTarget | null,
    open,
    mode,
    calendarPanelRef,
    railRef,
    onUserDraggedChange,
  });

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
        .map((selector) => panelRef.current?.querySelector<HTMLElement>(selector))
        .find((candidate): candidate is HTMLElement => !!candidate);
      element?.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [contentKey, editorMode, open, panelRef]);

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

  if (!open || typeof document === "undefined") return null;

  const feedbackVisible =
    feedbackActive && open && editorMode && !!detail?.shakeKey;

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
        // initial MUST stay false (not {opacity:0,scale:0.985}). This panel is a
        // document.body portal living inside the calendar's Activity-frozen
        // KeepAliveTab. On tab re-show, Activity tears down and re-creates Motion's
        // effects, and Motion re-applies a non-false `initial` to the DOM — but it
        // does NOT run the enter animation, because the `animate` target is
        // referentially unchanged (awaitingMeasuredPlacement was already false and
        // is preserved across the freeze). That pinned the panel at opacity 0 /
        // scale 0.985 on return: invisible yet still hit-testable. The awaiting
        // gate below already supplies the same faded+scaled-down start via
        // `animate`, so the open animation is unchanged while re-show stays in sync.
        initial={false}
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
          data-testid="calendar-floating-detail-shell"
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
            data-testid="calendar-floating-detail-drag-handle"
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
            data-calendar-floating-content-layout={eventEditorMode ? "event-editor" : "scroll"}
            style={{
              position: "relative",
              zIndex: 1,
              display: eventEditorMode ? "flex" : "block",
              flexDirection: eventEditorMode ? "column" : undefined,
              flex: eventEditorMode ? 1 : undefined,
              overflowY: eventEditorMode ? "hidden" : "auto",
              overscrollBehavior: "contain",
              padding: 12,
              minHeight: 0,
              maxHeight: Math.max(120, resolvedPlacement.maxHeight - 37),
              scrollbarGutter: "stable",
            }}
          >
            <div
              key={contentKey}
              style={eventEditorMode ? {
                display: "flex",
                flex: 1,
                minHeight: 0,
              } : undefined}
            >
              {children}
            </div>
          </div>
        </div>
      </Motion.div>
    </AnimatePresence>,
    document.body,
  );
}
