import { useEffect, useLayoutEffect } from "react";
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

const FLOATING_DETAIL_GRID_ANCHOR_SELECTOR = [
  "[data-testid='calendar-cell-item-chip']",
  "[data-testid='calendar-event-span-segment']",
].join(", ");
const FLOATING_DETAIL_OVERFLOW_ANCHOR_SELECTOR = "[data-testid='calendar-cell-overflow-item']";
const GRID_ORIGIN_ANCHOR_KINDS = new Set(["chip", "span", "overflow-row"]);

function dateCellFor(gridShell, dateKey) {
  if (!gridShell || !dateKey) return null;
  return gridShell.querySelector?.(`[role='gridcell'][data-date-key='${dateKey}']`) || null;
}

function segmentCoversDate(anchor, dateKey) {
  const segmentStart = anchor?.getAttribute?.("data-segment-start");
  const segmentEnd = anchor?.getAttribute?.("data-segment-end");
  return !!dateKey && !!segmentStart && !!segmentEnd && segmentStart <= dateKey && dateKey <= segmentEnd;
}

function anchorMatchesDate(anchor, dateKey) {
  if (!anchor || !dateKey) return false;
  const directDateKey = anchor.getAttribute?.("data-date-key");
  if (directDateKey) return directDateKey === dateKey;
  const sourceCellElement = anchor.closest?.("[role='gridcell']");
  if (sourceCellElement?.getAttribute("data-date-key") === dateKey) return true;
  return segmentCoversDate(anchor, dateKey);
}

function sourceCellForAnchor(anchor, gridShell, dateKey, resolvedOverflow) {
  const sourceCellElement = anchor?.closest?.("[role='gridcell']");
  if (sourceCellElement) return sourceCellElement;
  if (resolvedOverflow?.dateKey === dateKey && resolvedOverflow.sourceCellElement?.isConnected) {
    return resolvedOverflow.sourceCellElement;
  }
  return dateCellFor(gridShell, dateKey);
}

function anchorKindForReanchor(anchor) {
  if (anchor?.getAttribute?.("data-testid") === "calendar-cell-overflow-item") return "overflow-row";
  if (anchor?.getAttribute?.("data-inline-overflow-item") === "true") return "overflow-row";
  return "chip";
}

function findFloatingDetailAnchor({ gridShell, itemId, dateKey, resolvedOverflow }) {
  if (!gridShell || itemId == null || !dateKey) return null;
  const targetId = String(itemId);
  const gridAnchors = [
    ...(gridShell.querySelectorAll?.(FLOATING_DETAIL_GRID_ANCHOR_SELECTOR) || []),
  ];
  const overflowAnchors = resolvedOverflow?.dateKey === dateKey && typeof document !== "undefined"
    ? [...document.querySelectorAll(FLOATING_DETAIL_OVERFLOW_ANCHOR_SELECTOR)]
    : [];
  const anchor = [...gridAnchors, ...overflowAnchors].find((element) => (
    element.getAttribute("data-item-id") === targetId && anchorMatchesDate(element, dateKey)
  ));
  if (!anchor) return null;
  const sourceCellElement = sourceCellForAnchor(anchor, gridShell, dateKey, resolvedOverflow);
  if (!sourceCellElement?.isConnected) return null;
  return {
    anchorElement: anchor,
    sourceCellElement,
    anchorKind: anchorKindForReanchor(anchor),
  };
}

export default function useCalendarGridEffects({
  activeMonthWheelStateRef,
  canGoPrev,
  closeOverflow,
  floatingDetailAnchorElement,
  floatingDetailAnchorKind,
  floatingDetailDateKey,
  floatingDetailItemId,
  floatingDetailMode,
  floatingDetailOpen,
  floatingDetailParked,
  gridShellRef,
  ignoreOverflowScrollUntilRef,
  layout,
  eventSelectionActive = false,
  navigateMonth,
  onOpenOverflowForReanchor,
  onRefreshFloatingDetailAnchor,
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

  useLayoutEffect(() => {
    if (!floatingDetailOpen || floatingDetailParked) return;
    if (floatingDetailMode && floatingDetailMode !== "detail") return;
    if (!GRID_ORIGIN_ANCHOR_KINDS.has(floatingDetailAnchorKind)) return;
    if (floatingDetailAnchorElement?.isConnected) return;
    const targetDateKey = floatingDetailDateKey || selectedDateKey;
    const targetItemId = floatingDetailItemId ?? selectedItemId;
    if (targetItemId == null || !targetDateKey) return;
    const anchor = findFloatingDetailAnchor({
      gridShell: gridShellRef.current,
      itemId: targetItemId,
      dateKey: targetDateKey,
      resolvedOverflow,
    });
    if (!anchor) {
      return;
    }
    onRefreshFloatingDetailAnchor?.({
      mode: "detail",
      view,
      itemId: String(targetItemId),
      dateKey: targetDateKey,
      day:
        Number(anchor.sourceCellElement?.getAttribute("data-date-key")?.slice(-2)) ||
        selectedDay,
      anchorElement: anchor.anchorElement,
      sourceCellElement: anchor.sourceCellElement,
      exclusionElement: null,
      anchorKind: anchor.anchorKind,
    });
  }, [
    floatingDetailAnchorElement,
    floatingDetailAnchorKind,
    floatingDetailDateKey,
    floatingDetailItemId,
    floatingDetailMode,
    floatingDetailOpen,
    floatingDetailParked,
    gridShellRef,
    onRefreshFloatingDetailAnchor,
    resolvedOverflow,
    selectedDateKey,
    selectedDay,
    selectedItemId,
    view,
  ]);

  useLayoutEffect(() => {
    if (!floatingDetailParked) return;
    const reanchorMode = floatingDetailMode === "edit" || floatingDetailMode === "create"
      ? floatingDetailMode
      : "detail";
    const targetDateKey = floatingDetailDateKey || selectedDateKey;
    if (!targetDateKey) return;
    const targetItemId = floatingDetailItemId ?? selectedItemId;
    if (targetItemId != null) {
      const anchor = findFloatingDetailAnchor({
        gridShell: gridShellRef.current,
        itemId: targetItemId,
        dateKey: targetDateKey,
        resolvedOverflow,
      });
      if (!anchor) {
        if (resolvedOverflow?.dateKey !== targetDateKey) {
          const overflowOpened = onOpenOverflowForReanchor?.(targetDateKey);
          if (overflowOpened) return;
        }
        return;
      }
      onReanchorFloatingDetail?.({
        mode: reanchorMode,
        view,
        itemId: String(targetItemId),
        dateKey: targetDateKey,
        day:
          Number(anchor.sourceCellElement?.getAttribute("data-date-key")?.slice(-2)) ||
          selectedDay,
        anchorElement: anchor.anchorElement,
        sourceCellElement: anchor.sourceCellElement,
        exclusionElement: null,
        anchorKind: anchor.anchorKind,
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
    floatingDetailItemId,
    floatingDetailMode,
    floatingDetailParked,
    onOpenOverflowForReanchor,
    onReanchorFloatingDetail,
    resolvedOverflow,
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
