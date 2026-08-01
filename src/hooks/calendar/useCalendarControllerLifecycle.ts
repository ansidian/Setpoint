import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getMultiMonthGridRange, getVisibleGridRange, parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import {
  findItemLocation,
  isCompleteItem,
  itemMatchesViewId,
  type CalendarComputedItems,
  type CalendarControllerItem,
  type CalendarViewAdapter,
} from "./calendarControllerHelpers";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";

const BILLS_FETCH_MONTH_RADIUS = 2;

interface ControllerSelectionLifecycle {
  activeDateKey: string | null;
  activeItemId: string | null;
  setDateKey: Dispatch<SetStateAction<string | null>>;
  setDay: Dispatch<SetStateAction<number | null>>;
  setItemId: Dispatch<SetStateAction<string | null>>;
}

interface ControllerFloatingLifecycle {
  detail: CalendarFloatingDetail | null;
  detailRef: MutableRefObject<CalendarFloatingDetail | null>;
  setDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
}

interface ControllerViewDataLifecycle {
  ensureRange?: (start: string, end: string) => Promise<unknown>;
  revision?: unknown;
}

interface CalendarControllerLifecycleOptions {
  open: boolean;
  view: string;
  fetchYear: number;
  fetchMonth: number;
  completedDeadlineOverlayVisible: boolean;
  activeView: CalendarViewAdapter;
  computed: CalendarComputedItems;
  viewData: ControllerViewDataLifecycle;
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

/** Reconciles cached domain data and editor/detail lifecycle after controller renders. */
export default function useCalendarControllerLifecycle({
  open,
  view,
  fetchYear,
  fetchMonth,
  completedDeadlineOverlayVisible,
  activeView,
  computed,
  viewData,
  selection,
  floating,
  eventEditor,
  mobileTodayRequest,
}: CalendarControllerLifecycleOptions) {
  const {
    activeDateKey,
    activeItemId,
    setDateKey,
    setDay,
    setItemId,
  } = selection;
  const { detail, detailRef, setDetail } = floating;
  const { editable, isOpen, prefetchSources } = eventEditor;
  const { id: todayRequestId, isMobile, navigateToToday } = mobileTodayRequest;
  const { ensureRange, revision } = viewData;

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

  useLayoutEffect(() => {
    if (!open || view !== "bills" || !activeItemId || !activeDateKey) return;
    const currentLocation = findItemLocation(
      activeView,
      computed,
      activeItemId,
      activeDateKey,
    );
    if (currentLocation?.dateKey === activeDateKey) return;
    const nextLocation = findItemLocation(activeView, computed, activeItemId);
    const parsed = parseYmd(nextLocation?.dateKey);
    if (!nextLocation || !parsed) return;
    setDateKey(nextLocation.dateKey);
    setDay(parsed.day);
    setItemId(String(activeItemId));
    setDetail((current) => {
      if (
        !current?.open
        || current.view !== "bills"
        || !itemMatchesViewId(activeView, nextLocation.item, current.itemId)
      ) return current;
      return {
        ...current,
        itemId: String(activeItemId),
        dateKey: nextLocation.dateKey,
        day: parsed.day,
        itemsSnapshot: [nextLocation.item],
      };
    });
  }, [
    activeView,
    computed,
    activeDateKey,
    activeItemId,
    open,
    setDateKey,
    setDay,
    setDetail,
    setItemId,
    view,
  ]);

  useEffect(() => {
    if (!open || view === "events" || !ensureRange) return;
    const { start, end } = view === "bills"
      ? getMultiMonthGridRange(fetchYear, fetchMonth, BILLS_FETCH_MONTH_RADIUS)
      : getVisibleGridRange(fetchYear, fetchMonth);
    ensureRange(start, end).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") return;
      console.error(`[Calendar] ${view} range fetch failed:`, error);
    });
  }, [ensureRange, fetchMonth, fetchYear, open, revision, view]);

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
