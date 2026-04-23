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
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement for initial positioning
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [updatePos]);

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
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: typeof height === "number" ? `min(${height}px, calc(100vh - 20px))` : undefined,
        overflowY: "auto",
        overscrollBehavior: "contain",
        isolation: "isolate",
        background: "#16161e",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        zIndex: 9999,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
