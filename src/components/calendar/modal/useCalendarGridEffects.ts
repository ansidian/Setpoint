import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CalendarGridOverflowState } from "./useCalendarGridOverflow";
import {
  getModalScrollContainer,
  isCalendarEventSpanTarget,
  isCalendarFloatingDetailTarget,
  isCalendarGridCellTarget,
  isCalendarInlineOverflowTarget,
  isCalendarRailTarget,
} from "./calendarGridUtils";

export interface CalendarGridEffectsOptions {
  enabled?: boolean;
  overflowInteractionEnabled?: boolean;
  closeOverflow: (options?: { restoreFocus?: boolean }) => void;
  floatingDetailOpen: boolean;
  gridShellRef: RefObject<HTMLElement | null>;
  ignoreOverflowScrollUntilRef: RefObject<number>;
  eventSelectionActive?: boolean;
  resolvedOverflow: CalendarGridOverflowState | null;
  setOverflowState: Dispatch<SetStateAction<CalendarGridOverflowState | null>>;
}

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
}: CalendarGridEffectsOptions): void {
  useEffect(() => {
    if (!overflowInteractionEnabled || !resolvedOverflow) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
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
    const overflow = resolvedOverflow;
    function handlePointerDown(event: PointerEvent) {
      if (eventSelectionActive) return;
      const target = event.target instanceof Node ? event.target : null;
      if (overflow.sourceCellElement?.contains(target)) return;
      if (overflow.triggerElement?.contains(target)) return;
      if (isCalendarInlineOverflowTarget(event.target)) return;
      if (isCalendarEventSpanTarget(event.target)) return;
      if (isCalendarFloatingDetailTarget(event.target)) return;
      if (isCalendarRailTarget(event.target)) return;
      if (
        gridShellRef.current?.contains(target) &&
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
