import { useCallback, useLayoutEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { getVisibleGridRange, parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import useCalendarModalSearch, { type CalendarSearchActivationContext } from "./useCalendarModalSearch";
import { activationTargetFromCalendarSearchResult, type CalendarSearchResultLike } from "./calendarModalSearchModel";
import { findGridChipAnchor, findItemLocation, type CalendarComputedItems, type CalendarViewAdapter } from "./calendarControllerHelpers";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { PendingDashboardDetailFocus } from "./useDashboardDetailFocus";

interface CalendarMonthValue { year: number; month: number }
interface SearchEventEditor { isEditorOpen: boolean; isDirty: boolean; closeEditor?: () => void }

export interface CalendarSearchActivationOptions {
  open: boolean;
  view: string;
  onViewChange?: (view: string) => void;
  viewYear: number;
  viewMonth: number;
  activeView: CalendarViewAdapter;
  computed: CalendarComputedItems;
  eventOverlayVisible: boolean;
  deadlineOverlayVisible: boolean;
  completedDeadlineOverlayVisible: boolean;
  floatingDetailRef: MutableRefObject<CalendarFloatingDetail | null>;
  eventEditor: SearchEventEditor;
  closeEventEditor: () => void;
  shakeFloatingEditor: () => void;
  setDeadlineEditor: (value: null) => void;
  setDeadlineDraftPreview: (value: null) => void;
  setFloatingDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
  setViewDate: Dispatch<SetStateAction<CalendarMonthValue>>;
  setFetchAnchor: Dispatch<SetStateAction<CalendarMonthValue>>;
  setLabelMonth: Dispatch<SetStateAction<CalendarMonthValue>>;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setPendingItemDetailFocus: Dispatch<SetStateAction<PendingDashboardDetailFocus | null>>;
  panelRef: RefObject<HTMLElement | null>;
  activeSelectedDateKey: string | null;
  activeSelectedItemId: string | null;
}

// The calendar-search activation cluster, lifted out of useCalendarModalController.
// It owns the search UI hook plus every rule that maps a search result onto the
// grid: visibility-in-current-grid, result/date-header activation (with the
// month-jump + editor-guard dance), grid-navigability, and anchor resolution.
//
// The cluster straddles the view-model boundary: activation needs only view
// state, but anchor/navigability resolution reads `computed` (the expanded day
// data the view model produces). The original bridged this with a layout-effect
// writing `searchResultGridNavigableRef`; that bridge is preserved here. Because
// of the `computed` dependency this hook MUST be called after the view model —
// `useCalendarModalSearch` moves with it, but its effects only touch its own
// state, so the relocation is behavior-preserving.
export default function useCalendarSearchActivation({
  open,
  view,
  onViewChange,
  viewYear,
  viewMonth,
  activeView,
  computed,
  eventOverlayVisible,
  deadlineOverlayVisible,
  completedDeadlineOverlayVisible,
  floatingDetailRef,
  eventEditor,
  closeEventEditor,
  shakeFloatingEditor,
  setDeadlineEditor,
  setDeadlineDraftPreview,
  setFloatingDetail,
  setViewDate,
  setFetchAnchor,
  setLabelMonth,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  setPendingItemDetailFocus,
  panelRef,
  activeSelectedDateKey,
  activeSelectedItemId,
}: CalendarSearchActivationOptions) {
  const searchActivationSeqRef = useRef(0);
  const searchResultGridNavigableRef = useRef<(result: CalendarSearchResultLike) => boolean>(() => true);

  const searchTargetVisibleInCurrentGrid = useCallback((dateKey: string | null | undefined) => {
    const range = getVisibleGridRange(viewYear, viewMonth);
    return !!dateKey && dateKey >= range.start && dateKey <= range.end;
  }, [viewMonth, viewYear]);

  const activateCalendarSearchResult = useCallback((result: CalendarSearchResultLike, activationContext: CalendarSearchActivationContext | null = null) => {
    const target = activationTargetFromCalendarSearchResult(result);
    const parsed = parseYmd(target?.dateKey);
    if (!target || !parsed) return false;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return false;
    }
    if (eventEditor.isEditorOpen && eventEditor.isDirty) {
      shakeFloatingEditor();
      return false;
    }

    const targetView = target.view === "bills" ? "bills" : "events";
    if (targetView !== view) onViewChange?.(targetView);
    closeEventEditor();
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(target.dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
    }
    setSelectedDay(parsed.day);
    setSelectedDateKey(target.dateKey);
    setSelectedItemId(target.itemId);
    searchActivationSeqRef.current += 1;
    const requestKey = `search:${searchActivationSeqRef.current}:${targetView}:${target.dateKey}:${target.itemId}`;
    setPendingItemDetailFocus({
      openRequestId: searchActivationSeqRef.current,
      view: targetView,
      detailKind: target.detailKind || null,
      dateKey: target.dateKey,
      itemId: target.itemId,
      requestKey,
      attempts: 0,
      anchorElement: activationContext?.anchorElement || null,
      sourceCellElement: activationContext?.sourceCellElement || activationContext?.anchorElement || null,
      anchorKind: activationContext?.anchorKind || "search-result-row",
      searchResult: result,
    });
    return true;
  }, [
    closeEventEditor,
    eventEditor.isDirty,
    eventEditor.isEditorOpen,
    floatingDetailRef,
    onViewChange,
    setFloatingDetail,
    setDeadlineDraftPreview,
    setDeadlineEditor,
    searchTargetVisibleInCurrentGrid,
    setFetchAnchor,
    setLabelMonth,
    setPendingItemDetailFocus,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    setViewDate,
    shakeFloatingEditor,
    view,
  ]);

  const isCalendarSearchResultGridNavigable = useCallback((result: CalendarSearchResultLike) => (
    searchResultGridNavigableRef.current(result)
  ), []);

  const activateCalendarSearchDateHeader = useCallback((dateKey: string) => {
    const parsed = parseYmd(dateKey);
    if (!parsed) return false;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (current.dirty) {
        shakeFloatingEditor();
        return false;
      }
      if (current.view === "events") eventEditor.closeEditor?.();
      if (current.detailKind === "deadline") {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      }
    } else {
      closeEventEditor();
    }
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
    }
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    setSelectedItemId(null);
    return true;
  }, [
    closeEventEditor,
    eventEditor,
    floatingDetailRef,
    setDeadlineDraftPreview,
    setDeadlineEditor,
    setFloatingDetail,
    searchTargetVisibleInCurrentGrid,
    setFetchAnchor,
    setLabelMonth,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    setViewDate,
    shakeFloatingEditor,
  ]);

  const calendarSearch = useCalendarModalSearch({
    modalOpen: open,
    view,
    onActivateResult: activateCalendarSearchResult,
  });

  const getCalendarSearchResultActivationContext = useCallback((result: CalendarSearchResultLike, _index: number, fallbackContext: CalendarSearchActivationContext = {}) => {
    const target = activationTargetFromCalendarSearchResult(result);
    const parsed = parseYmd(target?.dateKey);
    if (!target || !parsed) {
      return {
        anchorKind: "search-result-row",
        anchorElement: fallbackContext.anchorElement || null,
        sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement || null,
      };
    }
    const targetView = target.view === "bills" ? "bills" : "events";
    const fallbackRowContext = fallbackContext.anchorElement
      ? {
          anchorKind: "search-result-row",
          anchorElement: fallbackContext.anchorElement,
          sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement,
        }
      : null;
    if (targetView !== view || !searchTargetVisibleInCurrentGrid(target.dateKey)) {
      if (fallbackRowContext && (result?.type === "event" || result?.type === "deadline")) return fallbackRowContext;
      return { anchorKind: "grid-chip" };
    }
    const location = findItemLocation(activeView, computed, target.itemId, target.dateKey);
    const itemId = activeView.getItemId && location?.item ? activeView.getItemId(location.item) : location?.item?.id;
    const gridAnchor = findGridChipAnchor(panelRef.current, itemId ?? target.itemId, location?.dateKey || target.dateKey);
    if (gridAnchor) return { anchorKind: "grid-chip" };
    return {
      anchorKind: "search-result-row",
      anchorElement: fallbackContext.anchorElement || null,
      sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement || null,
    };
  }, [
    activeView,
    computed,
    panelRef,
    searchTargetVisibleInCurrentGrid,
    view,
  ]);

  useLayoutEffect(() => {
    searchResultGridNavigableRef.current = (result) => {
      const target = activationTargetFromCalendarSearchResult(result);
      const parsed = parseYmd(target?.dateKey);
      if (!target || !parsed) return false;
      const targetView = target.view === "bills" ? "bills" : "events";
      if (targetView !== view) return true;
      if (!target.detailKind && result?.type === "event" && !eventOverlayVisible) return false;
      if (target.detailKind === "deadline") return true;
      if (!searchTargetVisibleInCurrentGrid(target.dateKey)) return true;
      const location = findItemLocation(activeView, computed, target.itemId, target.dateKey);
      if (location) return true;
      return result?.type === "event" || result?.type === "deadline";
    };
  }, [
    activeView,
    completedDeadlineOverlayVisible,
    computed,
    deadlineOverlayVisible,
    eventOverlayVisible,
    searchTargetVisibleInCurrentGrid,
    view,
  ]);

  const calendarSearchShell = useMemo(() => ({
    ...calendarSearch,
    selectedDateKey: activeSelectedDateKey,
    selectedItemId: activeSelectedItemId,
    activateDateHeader: activateCalendarSearchDateHeader,
    getResultActivationContext: getCalendarSearchResultActivationContext,
    isResultNavigable: isCalendarSearchResultGridNavigable,
  }), [
    activateCalendarSearchDateHeader,
    activeSelectedDateKey,
    activeSelectedItemId,
    calendarSearch,
    getCalendarSearchResultActivationContext,
    isCalendarSearchResultGridNavigable,
  ]);

  return { calendarSearch, calendarSearchShell };
}

export type CalendarSearchActivationController = ReturnType<typeof useCalendarSearchActivation>;
