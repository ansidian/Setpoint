import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveFloatingDetailPlacement } from "../../components/calendar/modal/calendarFloatingDetailPlacement.js";
import {
  dateCellSelector,
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
  const key = floatingDetailSessionKey(nextView, nextDetail.dateKey);
  return key ? sessionSideByViewRef.current[key] || null : null;
}

function floatingDetailSessionKey(view, dateKey) {
  return view && dateKey ? `${view}:${dateKey}` : null;
}

function clearSessionSide(sessionSideByViewRef, detail) {
  const key = floatingDetailSessionKey(detail?.view, detail?.dateKey);
  if (!key || !sessionSideByViewRef.current[key]) return;
  const next = { ...sessionSideByViewRef.current };
  delete next[key];
  sessionSideByViewRef.current = next;
}

function clearAllSessionSides(sessionSideByViewRef) {
  sessionSideByViewRef.current = {};
}

export default function useCalendarFloatingDetail({ open, view, panelRef, railRef }) {
  const [floatingDetail, setFloatingDetail] = useState(null);
  const floatingDetailRef = useRef(null);
  const previousFloatingDetailRef = useRef(null);
  const sessionSideByViewRef = useRef({});

  const setSyncedFloatingDetail = useCallback((nextOrUpdater) => {
    const current = floatingDetailRef.current;
    const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
    floatingDetailRef.current = next;
    setFloatingDetail(next);
  }, []);

  useLayoutEffect(() => {
    floatingDetailRef.current = floatingDetail;
  }, [floatingDetail]);

  useEffect(() => {
    if (!previousFloatingDetailRef.current?.open || floatingDetail?.open) {
      previousFloatingDetailRef.current = floatingDetail;
      return;
    }
    clearAllSessionSides(sessionSideByViewRef);
    previousFloatingDetailRef.current = floatingDetail;
  }, [floatingDetail]);

  useEffect(() => {
    if (open) return;
    clearAllSessionSides(sessionSideByViewRef);
  }, [open]);

  const findDateCell = useCallback((dateKey) => {
    if (!dateKey) return null;
    return panelRef.current?.querySelector?.(dateCellSelector(dateKey)) || null;
  }, [panelRef]);

  const shakeFloatingEditor = useCallback(() => {
    setSyncedFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, shakeKey: (current.shakeKey || 0) + 1 }
        : current
    ));
  }, [setSyncedFloatingDetail]);

  const setFloatingEditorDirty = useCallback((dirty) => {
    setSyncedFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty !== !!dirty
        ? { ...current, dirty: !!dirty }
        : current
    ));
  }, [setSyncedFloatingDetail]);

  const setFloatingEditorSaveRequest = useCallback((requestId) => {
    setSyncedFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, saveRequestId: requestId, activeSaveRequestId: requestId }
        : current
    ));
  }, [setSyncedFloatingDetail]);

  const openFloatingDetail = useCallback((nextDetail) => {
    if (!nextDetail) return;
    const mode = nextDetail.mode || "detail";
    if (mode !== "detail") {
      clearAllSessionSides(sessionSideByViewRef);
    }
    const nextView = nextDetail.view || view;
    const nextDateKey = nextDetail.dateKey || null;
    const suppliedAnchor = nextDetail.anchorElement || null;
    const inferredDayCell = !suppliedAnchor && mode !== "detail" ? findDateCell(nextDateKey) : null;
    const anchorElement = suppliedAnchor || inferredDayCell;
    if (mode === "detail" && (!nextDetail.itemId || !anchorElement)) return;
    const preferredSide = nextDetail.preferredSide
      || (String(nextDetail.anchorKind || "").startsWith("agenda") ? "left" : null);
    setSyncedFloatingDetail((current) => {
      if (
        mode === "detail"
        && current?.open
        && (current.view !== nextView || current.dateKey !== nextDateKey)
      ) {
        clearAllSessionSides(sessionSideByViewRef);
      }
      const userForcedSide = mode === "detail"
        ? nextDetail.forcedSide
          || rememberedSessionSide(sessionSideByViewRef, { ...nextDetail, dateKey: nextDateKey }, nextView)
          || null
        : null;
      const autoSide = mode === "detail"
        ? preservedReanchorSide(current, nextDetail, nextView, nextDateKey)
        : null;
      const forcedSide = userForcedSide;
      const sideIntent = forcedSide ? "user-flip" : "auto";
      const resolvedPreferredSide = preferredSide || autoSide || null;
      const initialPlacement = resolveFloatingDetailPlacement({
        anchorRect: elementRect(anchorElement),
        sourceRect: elementRect(nextDetail.sourceCellElement || inferredDayCell),
        exclusionRect: elementRect(nextDetail.exclusionElement),
        calendarRect: elementRect(panelRef.current),
        railRect: elementRect(railRef?.current),
        panelHeight: mode === "detail" ? 300 : 560,
        mode,
        preferredSide: resolvedPreferredSide,
        forcedSide,
        allowRailOverlap: sideIntent === "user-flip",
      });
      const nextItemId = nextDetail.itemId != null ? String(nextDetail.itemId) : null;
      const detailKind = nextDetail.detailKind || null;
      const canReuseSnapshot = current?.open
        && String(current.itemId) === nextItemId
        && current.view === nextView
        && current.detailKind === detailKind
        && current.dateKey === nextDateKey
        && Array.isArray(current.itemsSnapshot);
      const isSameSession = current?.open
        && current.mode === mode
        && current.view === nextView
        && current.detailKind === detailKind
        && String(current.itemId || "") === String(nextItemId || "")
        && current.dateKey === nextDateKey;
      const shakeKey = isSameSession ? current?.shakeKey || 0 : 0;
      return {
        open: true,
        mode,
        placementKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        view: nextView,
        detailKind,
        itemId: nextItemId,
        dateKey: nextDateKey,
        day: nextDetail.day ?? null,
        anchorElement,
        sourceCellElement: nextDetail.sourceCellElement || inferredDayCell || null,
        exclusionElement: nextDetail.exclusionElement || null,
        anchorKind: nextDetail.anchorKind || (inferredDayCell ? "day-cell" : mode === "detail" ? "chip" : "day-cell"),
        preferredSide: resolvedPreferredSide,
        forcedSide,
        sideIntent,
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
        shakeKey,
      };
    });
  }, [findDateCell, panelRef, railRef, setSyncedFloatingDetail, view]);

  const closeFloatingDetail = useCallback(() => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (current.dirty) {
        shakeFloatingEditor();
        return false;
      }
    }
    clearSessionSide(sessionSideByViewRef, current);
    setSyncedFloatingDetail(null);
    return true;
  }, [setSyncedFloatingDetail, shakeFloatingEditor]);

  const setFloatingDetailDragged = useCallback((userDragged, placementKey = null) => {
    if (userDragged) {
      clearSessionSide(sessionSideByViewRef, floatingDetailRef.current);
    }
    setSyncedFloatingDetail((current) => (
      current?.open && (!userDragged || !placementKey || current.placementKey === placementKey)
        ? {
            ...current,
            userDragged: !!userDragged,
            forcedSide: userDragged ? null : current.forcedSide || null,
            sideIntent: userDragged ? "auto" : current.sideIntent || "auto",
          }
        : current
    ));
  }, [setSyncedFloatingDetail]);

  const flipFloatingDetailSide = useCallback(() => {
    const currentDetail = floatingDetailRef.current;
    if (!isGridOriginFloatingDetail(currentDetail) || currentDetail.dirty) return;
    setSyncedFloatingDetail((current) => {
      if (!isGridOriginFloatingDetail(current) || current.dirty) return current;
      const currentSide = current.forcedSide
        || placementSideFromCaret(current.initialPlacement?.caretSide)
        || current.preferredSide
        || "right";
      const forcedSide = currentSide === "left" ? "right" : "left";
      const key = floatingDetailSessionKey(current.view, current.dateKey);
      if (!key) return current;
      sessionSideByViewRef.current = {
        ...sessionSideByViewRef.current,
        [key]: forcedSide,
      };
      return {
        ...current,
        forcedSide,
        sideIntent: "user-flip",
      };
    });
  }, [setSyncedFloatingDetail]);

  return {
    floatingDetail,
    setFloatingDetail: setSyncedFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
    closeFloatingDetail,
    setFloatingDetailDragged,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setFloatingEditorDirty,
    setFloatingEditorSaveRequest,
  };
}
