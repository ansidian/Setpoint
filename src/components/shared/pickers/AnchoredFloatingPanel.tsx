import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion as Motion, useIsPresent, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { computePlacement } from "@/components/inbox/helpers";
import useDismissablePortal from "@/hooks/useDismissablePortal";
import useIsMobile from "@/hooks/useIsMobile";
import BottomSheet from "@/components/ui/BottomSheet";
import { heightTransition } from "@/lib/motion";
import { resolveMobileSheetHeight } from "./anchoredFloatingPanelModel";

export type AnchoredFloatingPanelProps = {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  onClose?: () => void;
  width?: number;
  height?: number | string;
  matchAnchorWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
  role?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  open?: boolean;
  disableMobileSheet?: boolean;
  forceMobileSheet?: boolean;
  mobileHeight?: string | null;
  hideTitle?: boolean;
  animatePosition?: boolean;
  animateSize?: boolean;
  animateDisclosure?: boolean;
  /** Bounded desktop pickers opt out of scrolling and size to their content. */
  scrollable?: boolean;
  draggable?: boolean;
  dragHandleLabel?: string;
  placementKey?: string;
  children: ReactNode;
};

type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

type ManualPanelPosition = PanelPosition & { placementKey: string };

type PanelDragSession = {
  pointerId: number;
  placementKey: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  moved: boolean;
};

// Public entry point: anchored popover on desktop, bottom sheet on mobile.
// On a phone (useIsMobile) the content renders through BottomSheet so every
// consumer inherits "anchored on desktop, sheet on mobile" from one place —
// unless a consumer opts out with disableMobileSheet (then it stays anchored).
// Branching on a whole component (not guarding hooks in one function) keeps
// rules-of-hooks intact and means the desktop positioning hooks only mount on
// the desktop path — and the panel's useDismissablePortal never runs on mobile,
// where panelRef is unattached and the first in-sheet tap would read as
// "outside" and close the sheet.
//
// Mobile sheet intentionally ignores: anchorRef/panelRef (no anchoring),
// width/minWidth/maxWidth/matchAnchorWidth (sheet is full-width), style
// (desktop slab styling doesn't apply), role (both paths are dialogs).
// `height` and `ariaLabel` are translated; `mobileHeight={null}` opts into
// content sizing when a desktop placement hint should not size the whole sheet.
// `open` gates the sheet (see below).
export default function AnchoredFloatingPanel({ open = true, disableMobileSheet = false, forceMobileSheet = false, mobileHeight, hideTitle = false, animateDisclosure = false, ...props }: AnchoredFloatingPanelProps) {
  const isMobile = useIsMobile();
  if ((forceMobileSheet || isMobile) && !disableMobileSheet) {
    const Sheet = animateDisclosure ? DisclosureSheet : BottomSheet;
    return (
      <Sheet
        open={open}
        onClose={props.onClose as () => void}
        title={props.ariaLabel}
        hideTitle={hideTitle}
        height={resolveMobileSheetHeight(props.height, mobileHeight)}
      >
        {props.children}
      </Sheet>
    );
  }
  if (animateDisclosure) {
    return (
      <AnimatePresence initial={false}>
        {open ? <AnchoredPanelDesktop {...props} animateDisclosure /> : null}
      </AnimatePresence>
    );
  }
  // hideTitle is mobile-only (the desktop panel has no header), so it is
  // intentionally not forwarded to AnchoredPanelDesktop. The desktop panel
  // stays mounted when `open` is false (e.g. behind a sibling editor), but its
  // outside-click/Escape listener pauses so the sibling owns dismissal.
  return <AnchoredPanelDesktop {...props} dismissActive={open} />;
}

function DisclosureSheet({ open, children, ...props }: ComponentProps<typeof BottomSheet>) {
  const [snapshot, setSnapshot] = useState({ children });
  // Preserve the last open render while the sheet exits, including inputs and
  // suggestions that callers clear as soon as the menu closes.
  if (open && snapshot.children !== children) setSnapshot({ children });
  return <BottomSheet {...props} open={open}>{open ? children : snapshot.children}</BottomSheet>;
}

type AnchoredPanelDesktopProps = Omit<AnchoredFloatingPanelProps, "disableMobileSheet" | "forceMobileSheet" | "mobileHeight" | "hideTitle" | "open"> & {
  dismissActive?: boolean;
};

function AnchoredPanelDesktop({
  anchorRef,
  panelRef,
  onClose,
  width,
  height,
  matchAnchorWidth = false,
  minWidth,
  maxWidth,
  role = "dialog",
  ariaLabel,
  style,
  dismissActive = true,
  animatePosition = false,
  animateSize = false,
  animateDisclosure = false,
  scrollable = true,
  draggable = false,
  dragHandleLabel,
  placementKey = "panel",
  children,
}: AnchoredPanelDesktopProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const present = useIsPresent();
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef || internalPanelRef;
  const positionRafRef = useRef(0);
  const dragRafRef = useRef(0);
  const dragSessionRef = useRef<PanelDragSession | null>(null);
  const pendingDragPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const [manualPos, setManualPos] = useState<ManualPanelPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  // Stable "panel is mounted" gate: flips false->true once when the panel first
  // renders and stays true across repositions. Used so the ResizeObserver and
  // wheel listener bind once when the panel appears without rebinding on every
  // committed `pos` change (pos is a fresh object each reposition).
  const panelMounted = pos != null;

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- ref.current access is intentionally excluded from deps
  const updatePos = useCallback(() => {
    const anchor = anchorRef.current;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (!rect) {
      setPos(null);
      return;
    }
    let resolvedWidth = matchAnchorWidth ? rect.width : (width as number);
    if (typeof minWidth === "number") resolvedWidth = Math.max(resolvedWidth, minWidth);
    if (typeof maxWidth === "number") resolvedWidth = Math.min(resolvedWidth, maxWidth);

    const measuredHeight = resolvedPanelRef.current?.getBoundingClientRect?.().height;
    const placementHeight = typeof measuredHeight === "number" && measuredHeight > 0
      ? measuredHeight
      : (height as number);
    const nextPos = {
      ...computePlacement(rect, resolvedWidth, placementHeight),
      width: resolvedWidth,
    };

    setPos((prev) => {
      if (prev
        && prev.top === nextPos.top
        && prev.left === nextPos.left
        && prev.width === nextPos.width) {
        return prev;
      }
      return nextPos;
    });
  }, [anchorRef, height, matchAnchorWidth, maxWidth, minWidth, resolvedPanelRef, width]);

  // Coalesce scroll/resize-driven re-measures to one rAF so a burst of scroll
  // events runs the two getBoundingClientRect reads at most once per frame.
  const scheduleUpdate = useCallback(() => {
    if (positionRafRef.current) return;
    positionRafRef.current = window.requestAnimationFrame(() => {
      positionRafRef.current = 0;
      updatePos();
    });
  }, [updatePos]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement for initial positioning
    updatePos();
    let frame: number | null = null;
    let attempts = 0;
    const retryMissingAnchor = () => {
      if (anchorRef.current?.isConnected || attempts >= 4) {
        updatePos();
        return;
      }
      attempts += 1;
      frame = window.requestAnimationFrame(retryMissingAnchor);
    };
    frame = window.requestAnimationFrame(retryMissingAnchor);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      if (positionRafRef.current) {
        window.cancelAnimationFrame(positionRafRef.current);
        positionRafRef.current = 0;
      }
    };
  }, [anchorRef, updatePos, scheduleUpdate]);

  useLayoutEffect(() => {
    if (!pos) return;
    // Re-measure once the panel first renders (pos transitions null -> set) so
    // placement uses the real panel height. Content-size changes after that are
    // caught by the ResizeObserver below, so `children` is intentionally not a
    // dependency (it is a fresh element every parent render and would re-measure
    // on every keystroke into a panel-hosted input).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-measure DOM after first render
    updatePos();
  }, [pos, updatePos]);

  useEffect(() => {
    const element = resolvedPanelRef.current;
    if (!element || typeof window.ResizeObserver !== "function") return undefined;

    // Bind once when the panel mounts rather than rebinding on every reposition;
    // the `panelMounted` gate (not the `pos` object) is the dependency so the
    // observer is not torn down and recreated on each committed position change.
    const observer = new window.ResizeObserver(() => updatePos());
    observer.observe(element);
    return () => observer.disconnect();
  }, [panelMounted, resolvedPanelRef, updatePos]);

  // Outside-pointerdown + Escape dismissal via the shared primitive. The panel
  // and anchor are spared; the `data-calendar-popover-panel` selector lets a
  // click in a sibling calendar popover avoid dismissing this one. Escape closes
  // the panel (capture phase) — the panel previously had no Escape handling.
  useDismissablePortal({
    ref: undefined,
    active: dismissActive && present,
    refs: [resolvedPanelRef, anchorRef],
    ignoreSelector: "[data-calendar-popover-panel='true']",
    onDismiss: onClose,
    onTabKey: undefined,
    onActivate: undefined,
    activateKey: undefined,
  });

  useEffect(() => {
    const element = resolvedPanelRef.current;
    if (!element) return undefined;
    const wheelElement = element;

    function handleWheel(event: WheelEvent) {
      const atTop = wheelElement.scrollTop === 0;
      const atBottom = wheelElement.scrollTop + wheelElement.clientHeight >= wheelElement.scrollHeight - 1;
      if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) event.preventDefault();
    }

    wheelElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => wheelElement.removeEventListener("wheel", handleWheel);
  }, [panelMounted, resolvedPanelRef]);

  const applyDragPosition = useCallback((clientX: number, clientY: number) => {
    const session = dragSessionRef.current;
    if (!session || session.placementKey !== placementKey) return;
    const margin = 10;
    const maxLeft = Math.max(margin, window.innerWidth - session.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - session.height - margin);
    const left = Math.min(maxLeft, Math.max(margin, clientX - session.offsetX));
    const top = Math.min(maxTop, Math.max(margin, clientY - session.offsetY));
    setManualPos({ left, top, width: session.width, placementKey: session.placementKey });
  }, [placementKey]);

  const scheduleDragPosition = useCallback((clientX: number, clientY: number) => {
    pendingDragPointRef.current = { clientX, clientY };
    if (dragRafRef.current) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = 0;
      const point = pendingDragPointRef.current;
      pendingDragPointRef.current = null;
      if (point) applyDragPosition(point.clientX, point.clientY);
    });
  }, [applyDragPosition]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- ref.current access is intentionally excluded from deps
  const handleDragPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || (event.button ?? 0) !== 0) return;
    const rect = resolvedPanelRef.current?.getBoundingClientRect();
    if (!rect || !placementKey) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      placementKey,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, [draggable, placementKey, resolvedPanelRef]);

  const handleDragPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.moved && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 2) return;
    session.moved = true;
    setDragging(true);
    scheduleDragPosition(event.clientX, event.clientY);
  }, [scheduleDragPosition]);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    pendingDragPointRef.current = null;
    if (session.moved) applyDragPosition(event.clientX, event.clientY);
    dragSessionRef.current = null;
    setDragging(false);
  }, [applyDragPosition]);

  useEffect(() => () => {
    if (dragRafRef.current) window.cancelAnimationFrame(dragRafRef.current);
  }, []);

  if (!pos) return null;

  const activeManualPos = manualPos?.placementKey === placementKey ? manualPos : null;
  const displayPos = activeManualPos || pos;
  const floatingPanelStyle: CSSProperties = {
    position: "fixed",
    top: animatePosition || draggable ? 0 : displayPos.top,
    left: animatePosition || draggable ? 0 : displayPos.left,
    width: displayPos.width,
    isolation: "isolate",
    background: "var(--sp-panel)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
    zIndex: "var(--z-popover)",
    ...style,
    // Explicit height belongs to the consumer; the `height` prop alone is only
    // a placement hint. CSS can interpolate its viewport-clamped min() values.
    transition: animateSize && style?.height !== undefined
      ? [
        style.transition,
        ...["height", "max-height"].map((property) => `${property} ${dragging || reducedMotion ? "0ms" : "var(--sp-motion-height)"} var(--sp-ease-height)`),
      ].filter(Boolean).join(", ")
      : style?.transition,
    maxHeight: scrollable ? style?.maxHeight || (typeof height === "number" ? `min(${height}px, calc(100vh - 20px))` : undefined) : undefined,
    overflow: scrollable ? style?.overflow === "hidden" ? undefined : style?.overflow : "visible",
    overflowY: scrollable ? "auto" : "visible",
    overscrollBehavior: "contain",
    ...(!present ? { pointerEvents: "none" } : {}),
  };

  const dragHandle = draggable ? (
    <div
      data-testid="anchored-floating-panel-drag-handle"
      onPointerDown={handleDragPointerDown}
      onPointerMove={handleDragPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      style={{
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
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, letterSpacing: 1.7, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
        {dragHandleLabel || ariaLabel}
      </span>
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${String(dragHandleLabel || ariaLabel || "panel").toLowerCase()}`}
          className="anchored-floating-panel-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ) : null;

  return createPortal(
    animatePosition || animateSize || animateDisclosure || draggable ? (
      <Motion.div
        ref={resolvedPanelRef}
        role={present ? role : undefined}
        aria-label={ariaLabel}
        aria-hidden={!present || undefined}
        inert={!present || undefined}
        data-calendar-popover-panel="true"
        data-floating-position-source={activeManualPos ? "drag" : "anchor"}
        data-floating-left={displayPos.left}
        data-floating-top={displayPos.top}
        data-floating-dragging={dragging ? "true" : undefined}
        initial={reducedMotion ? false : animateDisclosure
          ? {
            opacity: 1,
            scale: 1,
            clipPath: "inset(0% -30% 100% -30%)",
            ...(animatePosition || draggable ? { x: displayPos.left, y: displayPos.top } : {}),
          }
          : { opacity: 0, scale: 0.985, x: displayPos.left, y: displayPos.top + 6 }}
        animate={{
          opacity: 1,
          scale: dragging ? 1.01 : 1,
          ...(!animateDisclosure || animatePosition || draggable ? { x: displayPos.left, y: displayPos.top } : {}),
          // Include the surrounding shadow without changing measured bounds.
          ...(animateDisclosure ? { clipPath: "inset(-20% -30% -20% -30%)" } : {}),
          ...(animateSize ? { width: displayPos.width } : {}),
        }}
        exit={animateDisclosure ? { clipPath: "inset(0% -30% 100% -30%)" } : undefined}
        transition={dragging || reducedMotion ? { duration: 0 } : {
          x: { type: "spring", stiffness: 420, damping: 42, mass: 0.8 },
          y: { type: "spring", stiffness: 420, damping: 42, mass: 0.8 },
          opacity: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
          scale: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
          width: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          clipPath: heightTransition(reducedMotion),
        }}
        style={floatingPanelStyle}
      >
        {dragHandle}
        {children}
      </Motion.div>
    ) : (
      <div
        ref={resolvedPanelRef}
        role={role}
        aria-label={ariaLabel}
        data-calendar-popover-panel="true"
        style={floatingPanelStyle}
      >
        {children}
      </div>
    ),
    document.body,
  );
}
