import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  isCompleteItem,
  itemMatchesViewId,
  type CalendarControllerItem,
  type CalendarViewAdapter,
} from "./calendarControllerHelpers";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";

interface ControllerSelectionLifecycle {
  setItemId: Dispatch<SetStateAction<string | null>>;
}

interface ControllerFloatingLifecycle {
  detail: CalendarFloatingDetail | null;
  detailRef: MutableRefObject<CalendarFloatingDetail | null>;
  setDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
}

interface CalendarControllerLifecycleOptions {
  open: boolean;
  view: string;
  completedDeadlineOverlayVisible: boolean;
  activeView: CalendarViewAdapter;
  selection: ControllerSelectionLifecycle;
  floating: ControllerFloatingLifecycle;
  eventEditor: {
    editable: boolean;
    isOpen: boolean;
    prefetchSources: () => void;
  };
  mobileTodayRequest: {
    id: number;
    isMobile: boolean;
    navigateToToday: () => void;
  };
}

/** Reconciles editor/detail lifecycle after controller renders. */
export default function useCalendarControllerLifecycle({
  open,
  view,
  completedDeadlineOverlayVisible,
  activeView,
  selection,
  floating,
  eventEditor,
  mobileTodayRequest,
}: CalendarControllerLifecycleOptions) {
  const { setItemId } = selection;
  const { detail, detailRef, setDetail } = floating;
  const { editable, isOpen, prefetchSources } = eventEditor;
  const { id: todayRequestId, isMobile, navigateToToday } = mobileTodayRequest;

  useEffect(() => {
    if (!editable || typeof window === "undefined") return undefined;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchSources(), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => prefetchSources(), 400);
    return () => window.clearTimeout(id);
  }, [editable, open, prefetchSources, view]);

  useLayoutEffect(() => {
    if (
      !open
      || view !== "events"
      || completedDeadlineOverlayVisible
      || !detail?.open
      || detail.detailKind !== "deadline"
    ) return;
    const snapshotItem = (detail.itemsSnapshot || []).find((item) => (
      itemMatchesViewId(activeView, item as CalendarControllerItem, detail.itemId)
    )) as FloatingEditorItem | undefined;
    if (!isCompleteItem(snapshotItem as CalendarControllerItem | undefined)) return;
    setDetail(null);
    setItemId(null);
  }, [
    activeView,
    completedDeadlineOverlayVisible,
    detail,
    open,
    setDetail,
    setItemId,
    view,
  ]);

  useEffect(() => {
    const current = detailRef.current;
    if (
      !current?.open
      || current.view !== "events"
      || current.detailKind === "deadline"
      || (current.mode !== "edit" && current.mode !== "create")
      || isOpen
    ) return;
    const id = window.requestAnimationFrame(() => {
      setDetail((latest) => {
        if (
          !latest?.open
          || latest.view !== "events"
          || latest.detailKind === "deadline"
          || (latest.mode !== "edit" && latest.mode !== "create")
        ) return latest;
        return latest.mode === "create"
          ? null
          : {
              ...latest,
              mode: "detail",
              editorSessionId: null,
              saveRequestId: null,
              activeSaveRequestId: null,
              dirty: false,
            };
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [detailRef, isOpen, setDetail]);

  const handledJumpTodayRef = useRef(todayRequestId);
  useEffect(() => {
    if (todayRequestId === handledJumpTodayRef.current) return;
    handledJumpTodayRef.current = todayRequestId;
    if (isMobile) navigateToToday();
  }, [isMobile, navigateToToday, todayRequestId]);
}
