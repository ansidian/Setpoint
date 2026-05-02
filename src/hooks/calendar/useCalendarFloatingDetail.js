import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveFloatingDetailPlacement } from "../../components/calendar/modal/calendarFloatingDetailPlacement.js";
import {
  isGridOriginAnchorKind,
  isGridOriginFloatingDetail,
  placementSideFromCaret,
  preservedReanchorSide,
} from "./calendarFloatingDetailModel.js";

function elementRect(element) {
  return element?.isConnected ? element.getBoundingClientRect() : null;
}

function rememberedSessionSide(sessionSideByViewRef, nextDetail, nextView) {
  if (!isGridOriginAnchorKind(nextDetail.anchorKind)) return null;
  return sessionSideByViewRef.current[nextView] || null;
}

export default function useCalendarFloatingDetail({ open, view, panelRef }) {
  const [floatingDetail, setFloatingDetail] = useState(null);
  const floatingDetailRef = useRef(null);
  const sessionSideByViewRef = useRef({});

  useLayoutEffect(() => {
    floatingDetailRef.current = floatingDetail;
  }, [floatingDetail]);

  useEffect(() => {
    if (open) return;
    sessionSideByViewRef.current = {};
  }, [open]);

  const findDateCell = useCallback((dateKey) => {
    if (!dateKey) return null;
    return panelRef.current?.querySelector?.(`[role='gridcell'][data-date-key='${dateKey}']`) || null;
  }, [panelRef]);

  const shakeFloatingEditor = useCallback(() => {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, shakeKey: (current.shakeKey || 0) + 1 }
        : current
    ));
  }, []);

  const setFloatingEditorDirty = useCallback((dirty) => {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty !== !!dirty
        ? { ...current, dirty: !!dirty }
        : current
    ));
  }, []);

  const setFloatingEditorSaveRequest = useCallback((requestId) => {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, saveRequestId: requestId, activeSaveRequestId: requestId }
        : current
    ));
  }, []);

  const openFloatingDetail = useCallback((nextDetail) => {
    if (!nextDetail) return;
    const mode = nextDetail.mode || "detail";
    const nextView = nextDetail.view || view;
    const nextDateKey = nextDetail.dateKey || null;
    const suppliedAnchor = nextDetail.anchorElement || null;
    const inferredDayCell = !suppliedAnchor && mode !== "detail" ? findDateCell(nextDateKey) : null;
    const anchorElement = suppliedAnchor || inferredDayCell;
    const parked = !!nextDetail.parked || !anchorElement;
    if (mode === "detail" && (!nextDetail.itemId || !anchorElement)) return;
    const preferredSide = nextDetail.preferredSide
      || (String(nextDetail.anchorKind || "").startsWith("agenda") ? "left" : null);
    setFloatingDetail((current) => {
      const forcedSide = nextDetail.forcedSide
        || preservedReanchorSide(current, nextDetail, nextView, nextDateKey)
        || rememberedSessionSide(sessionSideByViewRef, nextDetail, nextView)
        || null;
      const initialPlacement = resolveFloatingDetailPlacement({
        anchorRect: elementRect(anchorElement),
        sourceRect: elementRect(nextDetail.sourceCellElement || inferredDayCell),
        exclusionRect: elementRect(nextDetail.exclusionElement),
        calendarRect: elementRect(panelRef.current),
        panelHeight: mode === "detail" ? 300 : 560,
        mode,
        parked,
        preferredSide,
        forcedSide,
      });
      const nextItemId = nextDetail.itemId != null ? String(nextDetail.itemId) : null;
      const canReuseSnapshot = current?.open
        && String(current.itemId) === nextItemId
        && current.view === nextView
        && current.dateKey === nextDateKey
        && Array.isArray(current.itemsSnapshot);
      const isSameSession = current?.open
        && current.mode === mode
        && current.view === nextView
        && String(current.itemId || "") === String(nextItemId || "")
        && current.dateKey === nextDateKey;
      return {
        open: true,
        mode,
        placementKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        view: nextView,
        itemId: nextItemId,
        dateKey: nextDateKey,
        day: nextDetail.day ?? null,
        anchorElement,
        sourceCellElement: nextDetail.sourceCellElement || inferredDayCell || null,
        exclusionElement: nextDetail.exclusionElement || null,
        anchorKind: parked ? "parked" : nextDetail.anchorKind || (inferredDayCell ? "day-cell" : "chip"),
        preferredSide,
        forcedSide,
        parked,
        userDragged: false,
        initialPlacement,
        itemsSnapshot: Array.isArray(nextDetail.itemsSnapshot)
          ? nextDetail.itemsSnapshot
          : canReuseSnapshot
            ? current.itemsSnapshot
            : null,
        editorSessionId: mode === "edit" || mode === "create"
          ? isSameSession
            ? current.editorSessionId
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
          : null,
        saveRequestId: null,
        activeSaveRequestId: null,
        dirty: false,
        shakeKey: current?.shakeKey || 0,
      };
    });
  }, [findDateCell, panelRef, view]);

  const closeFloatingDetail = useCallback(() => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (current.dirty) shakeFloatingEditor();
      return;
    }
    setFloatingDetail(null);
  }, [shakeFloatingEditor]);

  const parkFloatingDetail = useCallback(() => {
    setFloatingDetail((current) => (
      current?.open
        ? {
            ...current,
            anchorElement: null,
            sourceCellElement: null,
            exclusionElement: null,
            anchorKind: "parked",
            parked: true,
            userDragged: false,
            forcedSide: null,
          }
        : current
    ));
  }, []);

  const setFloatingDetailDragged = useCallback((userDragged, placementKey = null) => {
    if (userDragged) {
      const currentView = floatingDetailRef.current?.view;
      if (currentView) delete sessionSideByViewRef.current[currentView];
    }
    setFloatingDetail((current) => (
      current?.open && (!userDragged || !placementKey || current.placementKey === placementKey)
        ? {
            ...current,
            userDragged: !!userDragged,
            forcedSide: userDragged ? null : current.forcedSide || null,
          }
        : current
    ));
  }, []);

  const flipFloatingDetailSide = useCallback(() => {
    const currentDetail = floatingDetailRef.current;
    if (!isGridOriginFloatingDetail(currentDetail) || currentDetail.dirty) return;
    setFloatingDetail((current) => {
      if (!isGridOriginFloatingDetail(current) || current.dirty) return current;
      const currentSide = current.forcedSide
        || placementSideFromCaret(current.initialPlacement?.caretSide)
        || current.preferredSide
        || "right";
      const forcedSide = currentSide === "left" ? "right" : "left";
      sessionSideByViewRef.current = {
        ...sessionSideByViewRef.current,
        [current.view]: forcedSide,
      };
      return {
        ...current,
        forcedSide,
      };
    });
  }, []);

  return {
    floatingDetail,
    setFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
    closeFloatingDetail,
    parkFloatingDetail,
    setFloatingDetailDragged,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setFloatingEditorDirty,
    setFloatingEditorSaveRequest,
  };
}
