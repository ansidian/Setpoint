import { useCallback, useRef, useState } from "react";
import { clampFloatingPosition } from "./calendarFloatingDetailPlacement.js";

export function rectFromElement(element) {
  return element?.isConnected ? element.getBoundingClientRect() : null;
}

// Pointer-drag mechanics for the floating detail panel, lifted verbatim out of
// CalendarFloatingDetailPanel. It owns the drag session + rAF-throttled manual
// position and reports the committed drag back via onUserDraggedChange. It reads
// `measuredSize` (owned by the placement hook that hosts it) for the clamp box,
// and exposes `cancelPendingDrag` so the host's resize-cleanup can drop an
// in-flight frame exactly as the original single-effect cleanup did.
export default function useFloatingDetailDrag({
  placementKey,
  measuredSize,
  calendarPanelRef,
  panelRef,
  onUserDraggedChange,
}) {
  const draggingRef = useRef(false);
  const dragSessionRef = useRef(null);
  const dragRafRef = useRef(0);
  const pendingDragPointRef = useRef(null);
  const [manualPosition, setManualPosition] = useState(null);
  const [dragging, setDragging] = useState(false);

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
    [calendarPanelRef, measuredSize.maxHeight, panelRef, placementKey],
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

  const cancelPendingDrag = useCallback(() => {
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    pendingDragPointRef.current = null;
  }, []);

  return {
    manualPosition,
    dragging,
    draggingRef,
    handleDragPointerDown,
    handleDragPointerMove,
    finishManualDrag,
    cancelPendingDrag,
  };
}
