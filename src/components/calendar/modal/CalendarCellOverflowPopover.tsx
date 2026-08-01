import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveOverflowPopoverPosition } from "./CalendarCellOverflowPopover.position";
import CalendarCellOverflowItem from "./CalendarCellOverflowItem";
import { getChipLeadingColumnWidth } from "./CalendarCellItemChipModel";
import type { CalendarCellQuickActions } from "./CalendarCell";
import type { CalendarGridFloatingAnchorMeta } from "./CalendarGrid";
import type { CalendarGridOverflowState } from "./useCalendarGridOverflow";

type CalendarOverflowPopoverState = Partial<CalendarGridOverflowState> & Pick<
  CalendarGridOverflowState,
  "day" | "triggerElement" | "items"
>;

function isOverflowTriggerTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-overflow-trigger='true']");
}

function isCalendarRailTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-modal-rail']");
}

function isCalendarGridCellTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-grid-shell'] [role='gridcell']");
}

function isCalendarFloatingDetailTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

function shellTransition(reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0.01 };
  return {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
  };
}

function fadeTransition(reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0 };
  return {
    duration: 0.14,
    ease: [0.22, 1, 0.36, 1],
  };
}

export default function CalendarCellOverflowPopover({
  popover,
  selectedItemId,
  onSelectItem,
  onClose,
  onOverflowInteraction,
  quickActions,
  onBeforeItemAction,
  floatingDetailOpen = false,
}: {
  popover: CalendarOverflowPopoverState | null;
  selectedItemId?: unknown;
  onSelectItem?: (itemId: unknown, anchorMeta: CalendarGridFloatingAnchorMeta) => void;
  onClose?: () => void;
  onOverflowInteraction?: () => void;
  quickActions?: CalendarCellQuickActions | null;
  onBeforeItemAction?: () => boolean | void;
  floatingDetailOpen?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const positionRafRef = useRef(0);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300, maxHeight: 320 });
  const leadingColumnWidth = popover?.leadingColumnWidth ?? getChipLeadingColumnWidth(popover?.items || []);

  const updatePosition = useCallback(() => {
    if (!popover?.triggerElement?.isConnected) {
      onClose?.();
      return;
    }

    setPos((current) => {
      const next = resolveOverflowPopoverPosition(popover.triggerElement);
      if (
        current.top === next.top
        && current.left === next.left
        && current.width === next.width
        && current.maxHeight === next.maxHeight
      ) {
        return current;
      }
      return next;
    });
  }, [popover, onClose]);

  const schedulePositionUpdate = useCallback(() => {
    if (positionRafRef.current) return;
    positionRafRef.current = window.requestAnimationFrame(() => {
      positionRafRef.current = 0;
      updatePosition();
    });
  }, [updatePosition]);

  useLayoutEffect(() => {
    if (!popover) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement before paint
    updatePosition();
  }, [popover, updatePosition]);

  useEffect(() => {
    if (!popover) return undefined;
    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate);
    return () => {
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      window.removeEventListener("resize", schedulePositionUpdate);
      if (positionRafRef.current) {
        window.cancelAnimationFrame(positionRafRef.current);
        positionRafRef.current = 0;
      }
    };
  }, [popover, schedulePositionUpdate]);

  useEffect(() => {
    if (!popover) return undefined;
    const triggerElement = popover.triggerElement;
    function handlePointerDown(event: PointerEvent) {
      if (quickActions?.eventSelectionActive) return;
      if (isOverflowTriggerTarget(event.target)) return;
      if (triggerElement.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      if (isCalendarFloatingDetailTarget(event.target)) return;
      if (isCalendarRailTarget(event.target)) return;
      if (isCalendarGridCellTarget(event.target)) return;
      onClose?.();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [popover, onClose, quickActions?.eventSelectionActive]);

  useEffect(() => {
    if (!popover) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (floatingDetailOpen && document.querySelector("[data-testid='calendar-floating-detail-panel']")) return;
      onClose?.();
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [floatingDetailOpen, popover, onClose]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!popover || !element) return undefined;
    const scrollElement = element;
    function onWheel(event: WheelEvent) {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        event.preventDefault();
        return;
      }
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop >= maxScroll && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    scrollElement.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollElement.removeEventListener("wheel", onWheel);
  }, [popover]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on content change
    setActiveItemId(null);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [popover?.day, popover?.viewMonth, popover?.viewYear]);

  if (!popover) return null;

  const contentKey = `${popover.view}-${popover.viewYear}-${popover.viewMonth}-${popover.day}-${popover.totalCount}-${popover.visibleCount}`;

  return createPortal(
    <Motion.div
      ref={popoverRef}
      data-testid="calendar-cell-overflow-popover"
      data-overflow-day={String(popover.day)}
      className="isolate"
      onPointerDown={() => onOverflowInteraction?.()}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={{
        opacity: 1,
        scale: 1,
      }}
      exit={reducedMotion ? undefined : { opacity: 0, scale: 0.985 }}
      transition={{
        opacity: fadeTransition(reducedMotion),
        scale: fadeTransition(reducedMotion),
      }}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        zIndex: 52,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 12px 10px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "var(--sp-panel)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        isolation: "isolate",
        overscrollBehavior: "contain",
        willChange: "transform, opacity",
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <Motion.div
          key={contentKey}
          layout
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
          transition={{
            layout: shellTransition(reducedMotion),
            opacity: fadeTransition(reducedMotion),
            y: fadeTransition(reducedMotion),
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "var(--color-text-faint)",
              }}
            >
              {popover.viewLabel} overflow
            </div>
            <div className="ea-display" style={{ fontSize: 18, lineHeight: 1.04, letterSpacing: -0.28, color: "#f6f7fb" }}>
              {popover.label}
            </div>
          </div>

          <div
            ref={scrollRef}
            data-calendar-local-scroll="true"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minHeight: 0,
              overflowY: "auto",
              overscrollBehavior: "contain",
              paddingRight: 2,
            }}
          >
            {popover.items.map((item) => {
              const itemId = String(item.id);
              const ghost = !!item.isGhost;
              return (
                <CalendarCellOverflowItem
                  key={item.id}
                  item={item}
                  selected={itemId === String(selectedItemId)}
                  active={!ghost && itemId === String(activeItemId)}
                  leadingColumnWidth={leadingColumnWidth}
                  interaction={{
                    dateKey: popover.dateKey,
                    sourceCellElement: popover.sourceCellElement,
                    popoverRef,
                    quickActions,
                    onSelectItem,
                    onBeforeItemAction,
                    onClose,
                    onActivate: () => setActiveItemId(itemId),
                    onDeactivate: () => setActiveItemId((current) => (
                      current === itemId ? null : current
                    )),
                  }}
                />
              );
            })}
          </div>
        </Motion.div>
      </AnimatePresence>
    </Motion.div>,
    document.body,
  );
}
