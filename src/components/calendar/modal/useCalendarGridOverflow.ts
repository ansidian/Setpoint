import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CURRENT_MONTH_BOUNDARY_COLOR,
  OTHER_MONTH_BOUNDARY_COLOR,
  overflowHiddenSignature,
  overflowStateIsLiveInScope,
  overflowCompletionSignature,
  resolveOverflowPresentation,
  sameOverflowDate,
} from "./calendarGridUtils";
import {
  OVERFLOW_INTERACTION_IGNORE_MS,
  markOverflowScrollIgnoreWindow,
} from "../../../hooks/calendar/calendarScrollModel";
import type { CalendarBoundarySide, CalendarInlineOverflowAnchor, CalendarMonthCell } from "./calendarGridUtils";
import type { CalendarChipItem } from "./CalendarCellItemChip";

export interface CalendarOverflowItem extends CalendarChipItem {
  matchItemIds?: unknown[];
}

export interface CalendarGridOverflowState {
  mode: "inline" | "fallback";
  triggerElement: HTMLElement;
  sourceCellElement: Element | null;
  inlineAnchor: CalendarInlineOverflowAnchor | null;
  carryBoundaryToBottom?: boolean;
  boundarySides: CalendarBoundarySide[];
  boundaryColor?: string | null;
  items: CalendarOverflowItem[];
  totalCount: number;
  visibleCount: number;
  leadingColumnWidth: number;
  focusOnOpen: boolean;
  label: string;
  viewLabel: string;
  day: number;
  dateKey: string;
  view: string;
  viewYear: number;
  viewMonth: number;
  anchorKey: string;
  hiddenSignature: string;
  keepOpenItemId: string | null;
}

export interface CalendarOverflowComposition {
  dateKey?: string | null;
  day?: number;
  hiddenSignature?: string;
  hiddenItems: CalendarOverflowItem[];
  totalCount: number;
  visibleCount: number;
  leadingColumnWidth: number;
}

export interface OpenCalendarOverflowOptions {
  triggerElement: HTMLElement;
  hiddenItems: CalendarOverflowItem[];
  totalCount: number;
  visibleCount: number;
  leadingColumnWidth: number;
  focusOnOpen?: boolean;
  forceOpen?: boolean;
  anchorKey: string;
  cell: CalendarMonthCell;
  day: number;
}

export interface CalendarGridOverflowOptions {
  activeView: { label?: string };
  currentSelectionKey?: string | null;
  currentMonth: number;
  currentYear: number;
  enabled?: boolean;
  gridBodyRef: RefObject<HTMLElement | null>;
  gridSelectedItemId?: unknown;
  gridShellRef: RefObject<HTMLElement | null>;
  layout?: { stacked?: boolean } | null;
  view: string;
  viewMonth: number;
  viewYear: number;
}

function overflowItemMatchesId(item: CalendarOverflowItem, itemId: unknown): boolean {
  if (itemId == null) return false;
  const target = String(itemId);
  if (String(item?.id) === target) return true;
  if (item?.selectionId != null && String(item.selectionId) === target) return true;
  return (item?.matchItemIds || []).some((id) => String(id) === target);
}

export default function useCalendarGridOverflow({
  activeView,
  currentSelectionKey,
  currentMonth,
  currentYear,
  enabled = true,
  gridBodyRef,
  gridSelectedItemId,
  gridShellRef,
  layout,
  view,
  viewMonth,
  viewYear,
}: CalendarGridOverflowOptions) {
  const ignoreOverflowScrollUntilRef = useRef(0);
  const [suppressedSelectedHiddenAutoOpenKey, setSuppressedSelectedHiddenAutoOpenKey] = useState<string | null>(null);
  const [overflowState, setOverflowState] = useState<CalendarGridOverflowState | null>(null);
  const resolvedOverflow =
    overflowStateIsLiveInScope(overflowState, { view, viewYear, viewMonth })
      ? overflowState
      : null;
  const resolvedPopover =
    resolvedOverflow?.mode === "fallback" ? resolvedOverflow : null;

  const getTrailingBoundaryColor = useCallback((cellBoundaryColor?: string | null): string => {
    if (cellBoundaryColor) return cellBoundaryColor;
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    const boundaryTouchesCurrentMonth =
      (viewYear === currentYear && viewMonth === currentMonth)
      || (nextYear === currentYear && nextMonth === currentMonth);
    return boundaryTouchesCurrentMonth
      ? CURRENT_MONTH_BOUNDARY_COLOR
      : OTHER_MONTH_BOUNDARY_COLOR;
  }, [currentMonth, currentYear, viewMonth, viewYear]);

  const closeOverflow = useCallback(
    ({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
      if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
      const anchorKey = overflowState?.anchorKey;
      setOverflowState(null);
      if (!restoreFocus || !anchorKey) return;
      window.requestAnimationFrame(() => {
        const trigger = [
          ...(gridShellRef.current?.querySelectorAll<HTMLElement>(
            "[data-calendar-overflow-anchor-key]",
          ) || []),
        ].find(
          (element) =>
            element.getAttribute("data-calendar-overflow-anchor-key") ===
            anchorKey,
        );
        trigger?.focus?.();
      });
    },
    [currentSelectionKey, gridShellRef, overflowState?.anchorKey],
  );

  const closeOverflowWithoutFocus = useCallback(() => {
    if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
    setOverflowState(null);
  }, [currentSelectionKey]);

  const clearSuppressedSelectedHiddenAutoOpenKey = useCallback(() => {
    setSuppressedSelectedHiddenAutoOpenKey(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    function handleOverflowCloseRequest() {
      if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
      setOverflowState(null);
    }
    document.addEventListener("calendar-overflow-close", handleOverflowCloseRequest);
    return () => document.removeEventListener("calendar-overflow-close", handleOverflowCloseRequest);
  }, [currentSelectionKey, enabled]);

  const validateOverflowHiddenItems = useCallback((composition: CalendarOverflowComposition) => {
    setOverflowState((current) => {
      if (!current || !sameOverflowDate(current, composition.dateKey, composition.day)) {
        return current;
      }
      const nextSignature = composition.hiddenSignature ?? overflowHiddenSignature(composition.hiddenItems);
      if (
        current.hiddenSignature === nextSignature
        && current.totalCount === composition.totalCount
        && current.visibleCount === composition.visibleCount
        && current.leadingColumnWidth === composition.leadingColumnWidth
      ) {
        // Completion changes the receipt, not overflow membership or anchoring.
        return overflowCompletionSignature(current.items) === overflowCompletionSignature(composition.hiddenItems)
          ? current
          : { ...current, items: composition.hiddenItems };
      }
      const keepOpenItemId = current.keepOpenItemId ?? gridSelectedItemId;
      if (
        keepOpenItemId != null
        && (composition.hiddenItems || []).some((item) => overflowItemMatchesId(item, keepOpenItemId))
      ) {
        return {
          ...current,
          items: composition.hiddenItems,
          hiddenSignature: nextSignature,
          totalCount: composition.totalCount,
          visibleCount: composition.visibleCount,
          leadingColumnWidth: composition.leadingColumnWidth,
          keepOpenItemId: String(keepOpenItemId),
        };
      }
      return null;
    });
  }, [gridSelectedItemId]);

  const markOverflowInteraction = useCallback(() => {
    const now = performance.now();
    ignoreOverflowScrollUntilRef.current = now + OVERFLOW_INTERACTION_IGNORE_MS;
    // P3-11: also open the module-shared ignore window so the parent
    // CalendarScrollContainer's overflow-close dispatcher skips the programmatic
    // alignment scroll this interaction provokes.
    markOverflowScrollIgnoreWindow(now);
  }, []);

  const handleOpenOverflow = useCallback(({
    triggerElement,
    hiddenItems,
    totalCount,
    visibleCount,
    leadingColumnWidth,
    focusOnOpen,
    forceOpen,
    anchorKey,
    cell,
    day,
  }: OpenCalendarOverflowOptions) => {
    const sourceCellElement =
      triggerElement?.closest?.("[role='gridcell']");
    setOverflowState((current) => {
      if (current?.anchorKey === anchorKey) {
        const sameLiveOverflow = overflowStateIsLiveInScope(current, {
          view,
          viewYear,
          viewMonth,
        });
        if (sameLiveOverflow) {
          if (!forceOpen) return null;
          return current;
        }
      }
      const presentation = resolveOverflowPresentation({
        triggerElement,
        layout,
        containerElement: gridBodyRef.current,
        hiddenItemCount: hiddenItems?.length ?? 0,
        boundaryColor: getTrailingBoundaryColor(cell.boundaryColor),
      });
      if (!presentation) return current;
      return {
        mode: presentation.mode,
        triggerElement,
        sourceCellElement,
        inlineAnchor: presentation.inlineAnchor,
        carryBoundaryToBottom: presentation.carryBoundaryToBottom,
        boundarySides: cell.boundarySides,
        boundaryColor: presentation.boundaryColor,
        items: hiddenItems,
        totalCount,
        visibleCount,
        leadingColumnWidth,
        focusOnOpen: focusOnOpen ?? true,
        label: new Date(
          `${cell.dateKey}T00:00:00`,
        ).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
        viewLabel:
          activeView.label ||
          view[0]!.toUpperCase() + view.slice(1),
        day,
        dateKey: cell.dateKey,
        view,
        viewYear,
        viewMonth,
        anchorKey,
        hiddenSignature: overflowHiddenSignature(hiddenItems),
        keepOpenItemId: null,
      };
    });
  }, [activeView.label, getTrailingBoundaryColor, gridBodyRef, layout, view, viewMonth, viewYear]);

  return {
    clearSuppressedSelectedHiddenAutoOpenKey,
    closeOverflow,
    closeOverflowWithoutFocus,
    handleOpenOverflow,
    ignoreOverflowScrollUntilRef,
    markOverflowInteraction,
    resolvedOverflow,
    resolvedPopover,
    setOverflowState,
    suppressedSelectedHiddenAutoOpenKey,
    validateOverflowHiddenItems,
  };
}
