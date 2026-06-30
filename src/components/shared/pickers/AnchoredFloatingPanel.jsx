import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePlacement } from "@/components/inbox/helpers";
import useDismissablePortal from "@/hooks/useDismissablePortal";
import useIsMobile from "@/hooks/useIsMobile";
import BottomSheet from "@/components/ui/BottomSheet";

// Public entry point: anchored popover on desktop, bottom sheet on mobile.
// On a phone (useIsMobile) the content renders through BottomSheet so every
// consumer inherits "anchored on desktop, sheet on mobile" from one place —
// unless a consumer opts out with disableMobileSheet (then it stays anchored).
// Branching on a whole component (not guarding hooks in one function) keeps
// rules-of-hooks intact and means the desktop positioning hooks only mount on
// the desktop path — and the panel's useDismissablePortal never runs on mobile,
// where panelRef is unattached and the first in-sheet tap would read as
// "outside" and close the sheet.
export default function AnchoredFloatingPanel({ disableMobileSheet = false, hideTitle = false, ...props }) {
  const isMobile = useIsMobile();
  if (isMobile && !disableMobileSheet) {
    return (
      <BottomSheet open onClose={props.onClose} title={props.ariaLabel} hideTitle={hideTitle}>
        {props.children}
      </BottomSheet>
    );
  }
  // hideTitle is mobile-only (the desktop panel has no header), so it is
  // intentionally not forwarded to AnchoredPanelDesktop.
  return <AnchoredPanelDesktop {...props} />;
}

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
  children,
}) {
  const internalPanelRef = useRef(null);
  const resolvedPanelRef = panelRef || internalPanelRef;
  const positionRafRef = useRef(0);
  const [pos, setPos] = useState(null);
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
    let resolvedWidth = matchAnchorWidth ? rect.width : width;
    if (typeof minWidth === "number") resolvedWidth = Math.max(resolvedWidth, minWidth);
    if (typeof maxWidth === "number") resolvedWidth = Math.min(resolvedWidth, maxWidth);

    const measuredHeight = resolvedPanelRef.current?.getBoundingClientRect?.().height;
    const placementHeight = typeof measuredHeight === "number" && measuredHeight > 0
      ? measuredHeight
      : height;
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
    let frame = null;
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
    active: true,
    refs: [resolvedPanelRef, anchorRef],
    ignoreSelector: "[data-calendar-popover-panel='true']",
    onDismiss: onClose,
  });

  useEffect(() => {
    const element = resolvedPanelRef.current;
    if (!element) return undefined;

    function handleWheel(event) {
      const atTop = element.scrollTop === 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) event.preventDefault();
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [panelMounted, resolvedPanelRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={resolvedPanelRef}
      role={role}
      aria-label={ariaLabel}
      data-calendar-popover-panel="true"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        isolation: "isolate",
        background: "var(--sp-panel)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        zIndex: "var(--z-popover)",
        ...style,
        maxHeight: style?.maxHeight || (typeof height === "number" ? `min(${height}px, calc(100vh - 20px))` : undefined),
        overflow: style?.overflow === "hidden" ? undefined : style?.overflow,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
