import { useEffect } from "react";
import {
  MONTH_WHEEL_COOLDOWN_MS,
  createMonthWheelState,
  getModalScrollContainer,
  isCalendarEventSpanTarget,
  isCalendarFloatingDetailTarget,
  isCalendarGridCellTarget,
  isCalendarInlineOverflowTarget,
  isCalendarRailTarget,
  isCoarseMonthWheel,
  isIntentionalMonthWheel,
  normalizeWheelDeltaY,
} from "./calendarGridUtils.js";

export default function useCalendarGridEffects({
  activeMonthWheelStateRef,
  canGoPrev,
  closeOverflow,
  floatingDetailDateKey,
  floatingDetailMode,
  floatingDetailOpen,
  floatingDetailParked,
  gridShellRef,
  ignoreOverflowScrollUntilRef,
  layout,
  eventSelectionActive = false,
  navigateMonth,
  onReanchorFloatingDetail,
  resolvedOverflow,
  selectedDateKey,
  selectedDay,
  selectedItemId,
  setOverflowState,
  suppressOutsideClick,
  view,
  viewMonth,
  viewYear,
}) {
  useEffect(() => {
    if (!resolvedOverflow) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (floatingDetailOpen) return;
      closeOverflow({ restoreFocus: true });
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [closeOverflow, floatingDetailOpen, resolvedOverflow]);

  useEffect(() => {
    if (resolvedOverflow?.mode !== "inline") return undefined;
    function handlePointerDown(event) {
      if (eventSelectionActive) return;
      if (resolvedOverflow.sourceCellElement?.contains(event.target)) return;
      if (resolvedOverflow.triggerElement?.contains(event.target)) return;
      if (isCalendarInlineOverflowTarget(event.target)) return;
      if (isCalendarEventSpanTarget(event.target)) return;
      if (isCalendarFloatingDetailTarget(event.target)) return;
      if (isCalendarRailTarget(event.target)) return;
      if (
        gridShellRef.current?.contains(event.target) &&
        isCalendarGridCellTarget(event.target)
      )
        return;
      setOverflowState(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [eventSelectionActive, gridShellRef, resolvedOverflow, setOverflowState]);

  useEffect(() => {
    if (!floatingDetailParked) return;
    const reanchorMode = floatingDetailMode === "edit" || floatingDetailMode === "create"
      ? floatingDetailMode
      : "detail";
    const targetDateKey = floatingDetailDateKey || selectedDateKey;
    if (!targetDateKey) return;
    if (selectedItemId) {
      const chips = [
        ...(gridShellRef.current?.querySelectorAll(
          "[data-testid='calendar-cell-item-chip'], [data-testid='calendar-event-span-segment']",
        ) || []),
      ];
      const anchor = chips.find(
        (element) =>
          element.getAttribute("data-item-id") === String(selectedItemId),
      );
      if (!anchor) return;
      const sourceCellElement = anchor.closest("[role='gridcell']");
      if (sourceCellElement?.getAttribute("data-date-key") !== targetDateKey)
        return;
      onReanchorFloatingDetail?.({
        mode: reanchorMode,
        view,
        itemId: String(selectedItemId),
        dateKey: targetDateKey,
        day:
          Number(sourceCellElement?.getAttribute("data-date-key")?.slice(-2)) ||
          selectedDay,
        anchorElement: anchor,
        sourceCellElement,
        exclusionElement: null,
        anchorKind: "chip",
      });
      return;
    }

    if (reanchorMode === "detail") return;
    const sourceCellElement = gridShellRef.current?.querySelector?.(
      `[role='gridcell'][data-date-key='${targetDateKey}']`,
    ) || null;
    if (!sourceCellElement) return;
    onReanchorFloatingDetail?.({
      mode: reanchorMode,
      view,
      dateKey: targetDateKey,
      day:
        Number(sourceCellElement?.getAttribute("data-date-key")?.slice(-2)) ||
        selectedDay,
      anchorElement: sourceCellElement,
      sourceCellElement,
      exclusionElement: null,
      anchorKind: "day-cell",
    });
  }, [
    floatingDetailDateKey,
    floatingDetailMode,
    floatingDetailParked,
    onReanchorFloatingDetail,
    selectedDateKey,
    selectedDay,
    selectedItemId,
    view,
    viewMonth,
    viewYear,
    gridShellRef,
  ]);

  useEffect(() => {
    const scrollContainer = getModalScrollContainer(gridShellRef.current);
    if (!resolvedOverflow || !scrollContainer) return undefined;
    function handleScroll() {
      if (performance.now() < ignoreOverflowScrollUntilRef.current) return;
      setOverflowState(null);
    }
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [gridShellRef, ignoreOverflowScrollUntilRef, resolvedOverflow, setOverflowState]);

  useEffect(() => {
    if (!suppressOutsideClick || resolvedOverflow?.mode !== "inline")
      return undefined;
    suppressOutsideClick(
      (target) =>
        resolvedOverflow.sourceCellElement?.contains(target) ||
        resolvedOverflow.triggerElement?.contains(target) ||
        isCalendarInlineOverflowTarget(target) ||
        isCalendarEventSpanTarget(target) ||
        isCalendarRailTarget(target),
    );
    return () => suppressOutsideClick(null);
  }, [resolvedOverflow, suppressOutsideClick]);

  useEffect(() => {
    const element = gridShellRef.current;
    if (!element || layout.stacked || !navigateMonth) return undefined;

    function handleMonthWheel(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      if (isCalendarInlineOverflowTarget(event.target)) return;

      const absX = Math.abs(event.deltaX || 0);
      const absY = Math.abs(event.deltaY || 0);
      if (absY === 0 || absX > absY) return;

      const normalizedY = normalizeWheelDeltaY(
        event,
        element.clientHeight || window.innerHeight || 800,
      );
      if (!isCoarseMonthWheel(event, normalizedY)) return;

      const direction = normalizedY > 0 ? 1 : -1;
      if (direction < 0 && !canGoPrev) {
        if (event.cancelable) event.preventDefault();
        return;
      }

      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const wheelState =
        activeMonthWheelStateRef.current || createMonthWheelState();
      activeMonthWheelStateRef.current = wheelState;
      const intentionalWheel = isIntentionalMonthWheel({
        normalizedY,
        now,
        wheelState,
      });

      wheelState.lastWheelAt = now;
      wheelState.lastWheelDelta = normalizedY;

      if (!intentionalWheel) return;

      if (
        now < wheelState.ignoreUntil ||
        now - wheelState.lastNavigateAt < MONTH_WHEEL_COOLDOWN_MS
      ) {
        return;
      }

      navigateMonth(direction, { source: "month-grid-wheel" });
      wheelState.lastNavigateAt = now;
      wheelState.ignoreUntil = now + MONTH_WHEEL_COOLDOWN_MS;
    }

    element.addEventListener("wheel", handleMonthWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleMonthWheel);
  }, [activeMonthWheelStateRef, canGoPrev, gridShellRef, layout.stacked, navigateMonth]);
}
