import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURRENT_MONTH_BOUNDARY_COLOR,
  OTHER_MONTH_BOUNDARY_COLOR,
  overflowHiddenSignature,
  overflowStateIsLiveInScope,
  resolveOverflowPresentation,
  sameOverflowDate,
} from "./calendarGridUtils.js";

function overflowItemMatchesId(item, itemId) {
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
}) {
  const ignoreOverflowScrollUntilRef = useRef(0);
  const [suppressedSelectedHiddenAutoOpenKey, setSuppressedSelectedHiddenAutoOpenKey] = useState(null);
  const [overflowState, setOverflowState] = useState(null);
  const resolvedOverflow =
    overflowStateIsLiveInScope(overflowState, { view, viewYear, viewMonth })
      ? overflowState
      : null;
  const resolvedPopover =
    resolvedOverflow?.mode === "fallback" ? resolvedOverflow : null;

  const getTrailingBoundaryColor = useCallback((cellBoundaryColor) => {
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
    ({ restoreFocus = false } = {}) => {
      if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
      const anchorKey = overflowState?.anchorKey;
      setOverflowState(null);
      if (!restoreFocus || !anchorKey) return;
      window.requestAnimationFrame(() => {
        const trigger = [
          ...(gridShellRef.current?.querySelectorAll(
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

  const validateOverflowHiddenItems = useCallback((composition) => {
    setOverflowState((current) => {
      if (!sameOverflowDate(current, composition.dateKey, composition.day)) {
        return current;
      }
      const nextSignature = composition.hiddenSignature ?? overflowHiddenSignature(composition.hiddenItems);
      if (
        current.hiddenSignature === nextSignature
        && current.totalCount === composition.totalCount
        && current.visibleCount === composition.visibleCount
        && current.leadingColumnWidth === composition.leadingColumnWidth
      ) {
        return current;
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
    ignoreOverflowScrollUntilRef.current = performance.now() + 220;
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
  }) => {
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
          view[0].toUpperCase() + view.slice(1),
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
