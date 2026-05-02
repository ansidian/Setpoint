import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePlacement } from "@/components/inbox/helpers";

export default function AnchoredFloatingPanel({
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
  const [pos, setPos] = useState(null);

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
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [anchorRef, updatePos]);

  useLayoutEffect(() => {
    if (!pos) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-measure DOM after content change
    updatePos();
  }, [children, pos, updatePos]);

  useEffect(() => {
    const element = resolvedPanelRef.current;
    if (!element || typeof window.ResizeObserver !== "function") return undefined;

    const observer = new window.ResizeObserver(() => updatePos());
    observer.observe(element);
    return () => observer.disconnect();
  }, [pos, resolvedPanelRef, updatePos]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (resolvedPanelRef.current?.contains(event.target)) return;
      if (anchorRef.current?.contains(event.target)) return;
      if (event.target?.closest?.("[data-calendar-popover-panel='true']")) return;
      onClose?.();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [anchorRef, onClose, resolvedPanelRef]);

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
  }, [resolvedPanelRef, pos]);

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
        background: "#16161e",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        zIndex: 9999,
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
