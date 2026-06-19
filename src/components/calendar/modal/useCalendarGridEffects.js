import { useEffect } from "react";
import {
  getModalScrollContainer,
  isCalendarEventSpanTarget,
  isCalendarFloatingDetailTarget,
  isCalendarGridCellTarget,
  isCalendarInlineOverflowTarget,
  isCalendarRailTarget,
} from "./calendarGridUtils.js";

export default function useCalendarGridEffects({
  enabled = true,
  overflowInteractionEnabled = enabled,
  closeOverflow,
  floatingDetailOpen,
  gridShellRef,
  ignoreOverflowScrollUntilRef,
  eventSelectionActive = false,
  resolvedOverflow,
  setOverflowState,
}) {
  useEffect(() => {
    if (!overflowInteractionEnabled || !resolvedOverflow) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (floatingDetailOpen) return;
      closeOverflow({ restoreFocus: true });
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [overflowInteractionEnabled, closeOverflow, floatingDetailOpen, resolvedOverflow]);

  useEffect(() => {
    if (!overflowInteractionEnabled || resolvedOverflow?.mode !== "inline") return undefined;
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
  }, [overflowInteractionEnabled, eventSelectionActive, gridShellRef, resolvedOverflow, setOverflowState]);

  useEffect(() => {
    if (!overflowInteractionEnabled) return undefined;
    const scrollContainer = getModalScrollContainer(gridShellRef.current);
    if (!resolvedOverflow || !scrollContainer) return undefined;
    function handleScroll() {
      if (performance.now() < ignoreOverflowScrollUntilRef.current) return;
      setOverflowState(null);
    }
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [overflowInteractionEnabled, gridShellRef, ignoreOverflowScrollUntilRef, resolvedOverflow, setOverflowState]);
}
