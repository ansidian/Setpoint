import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveOverflowPopoverPosition } from "./CalendarCellOverflowPopover.position.js";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.jsx";
import {
  CalendarChipRecurringIcon,
  CalendarChipReminderMarker,
  CalendarChipStatusIcon,
} from "./CalendarCellItemChip.jsx";
import { compactLeadingLabel, getChipLeadingColumnWidth } from "./CalendarCellItemChipModel.js";

function isOverflowTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-overflow-trigger='true']");
}

function isCalendarRailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-modal-rail']");
}

function isCalendarGridCellTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-grid-shell'] [role='gridcell']");
}

function isCalendarFloatingDetailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

function shellTransition(reducedMotion) {
  if (reducedMotion) return { duration: 0.01 };
  return {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
  };
}

function fadeTransition(reducedMotion) {
  if (reducedMotion) return { duration: 0 };
  return {
    duration: 0.14,
    ease: [0.22, 1, 0.36, 1],
  };
}

function itemButtonStyle({
  accent,
  selected,
  active,
  ghost,
  batchSelected = false,
  specialDate = false,
}) {
  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 5,
    padding: "11px 12px",
    borderRadius: 10,
    border: specialDate && !ghost
      ? selected
        ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
        : active
          ? `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`
          : `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.045))`
      : ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : batchSelected
      ? `1px solid color-mix(in srgb, ${accent} 68%, rgba(255,255,255,0.16))`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : "1px solid rgba(255,255,255,0.05)",
    background: specialDate && !ghost
      ? selected
        ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 7%, rgba(22,22,30,0.18)))`
        : active
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 5%, rgba(22,22,30,0.12)))`
          : `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, rgba(255,255,255,0.018)), rgba(255,255,255,0.018))`
      : batchSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 22%, transparent), color-mix(in srgb, ${accent} 9%, rgba(22,22,30,0.2)))`
      : selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, transparent), color-mix(in srgb, ${accent} 6%, transparent))`
      : active
        ? "rgba(255,255,255,0.062)"
        : "rgba(255,255,255,0.024)",
    boxShadow: specialDate && !ghost
      ? selected || active
        ? `inset 0 1px 0 color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.02))`
        : "none"
      : batchSelected
      ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 28%, transparent), 0 0 0 1px rgba(255,255,255,0.035)`
      : active && !selected
      ? "inset 0 1px 0 rgba(255,255,255,0.04)"
      : "none",
    color: "#eef2ff",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "border-color 140ms, background 140ms, box-shadow 140ms",
  };
}

function isEventSelectionModifier(event) {
  return !!(event?.metaKey || event?.ctrlKey);
}

function OverflowMetadata({ item, selected, accent, leadingColumnWidth }) {
  if (!leadingColumnWidth || item.specialDate) return null;
  const color = selected
    ? item.leadingColor || accent
    : item.leadingColor || accent;
  const preserveLeadingLabel = item.preserveLeadingLabel === true;

  return (
    <span
      style={{
        width: leadingColumnWidth,
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        maxWidth: leadingColumnWidth,
        overflow: "hidden",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: 1.05,
        color,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {item.leadingLabel ? (
        <span
          style={{
            minWidth: preserveLeadingLabel ? "max-content" : 0,
            overflow: preserveLeadingLabel ? "visible" : "hidden",
            textOverflow: preserveLeadingLabel ? "clip" : "ellipsis",
          }}
        >
          {compactLeadingLabel(item.leadingLabel)}
        </span>
      ) : null}
    </span>
  );
}

export default function CalendarCellOverflowPopover({
  popover,
  selectedItemId,
  onSelectItem,
  onClose,
  onOverflowInteraction,
  suppressOutsideClick,
  quickActions,
  onBeforeItemAction,
  floatingDetailOpen = false,
}) {
  const reducedMotion = useReducedMotion();
  const popoverRef = useRef(null);
  const scrollRef = useRef(null);
  const positionRafRef = useRef(0);
  const [activeItemId, setActiveItemId] = useState(null);
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
    function handlePointerDown(event) {
      if (quickActions?.eventSelectionActive) return;
      if (isOverflowTriggerTarget(event.target)) return;
      if (popover.triggerElement?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
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
    function handleKeyDown(event) {
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
    function onWheel(event) {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        event.preventDefault();
        return;
      }
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop >= maxScroll && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [popover]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on content change
    setActiveItemId(null);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [popover?.day, popover?.viewMonth, popover?.viewYear]);

  useEffect(() => {
    if (!suppressOutsideClick) return undefined;
    if (popover) {
      suppressOutsideClick((target) => (
        popoverRef.current?.contains(target)
        || popover.triggerElement?.contains(target)
        || isOverflowTriggerTarget(target)
        || isCalendarFloatingDetailTarget(target)
        || isCalendarRailTarget(target)
      ));
    } else {
      suppressOutsideClick(null);
    }
    return () => suppressOutsideClick(null);
  }, [popover, suppressOutsideClick]);

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
        background: "#16161e",
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
                color: "rgba(205,214,244,0.46)",
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
              const selected = itemId === String(selectedItemId);
              const ghost = !!item.isGhost;
              const active = !ghost && itemId === String(activeItemId);
              const specialDate = item.specialDate === true;
              const accent = specialDate ? item.specialDateAccent || item.accent || "var(--ea-accent)" : item.accent || "var(--ea-accent)";
              const dragAllowed = !ghost && !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent && !specialDate;
              const batchSelected = !specialDate && !!quickActions?.isEventSelectionSelected?.(item.sourceEvent || item.sourceItem);
              const Shell = ghost ? "div" : "button";

              return (
                <Shell
                  key={item.id}
                  type={ghost ? undefined : "button"}
                  data-testid={ghost ? "calendar-ghost-chip" : "calendar-cell-overflow-item"}
                  data-item-id={itemId}
                  data-date-key={popover.dateKey || undefined}
                  data-hovered={active ? "true" : "false"}
                  data-calendar-event-selection={batchSelected ? "true" : undefined}
                  data-calendar-event-activation="true"
                  draggable={dragAllowed}
                  onClick={(event) => {
                    event.stopPropagation();
                    event.currentTarget.focus({ preventScroll: true });
                    if (isEventSelectionModifier(event)) {
                      event.preventDefault();
                      if (specialDate) return;
                      quickActions?.toggleEventSelection?.({
                        event: item.sourceEvent || item.sourceItem,
                        dateKey: popover.dateKey || null,
                        anchorElement: event.currentTarget,
                        sourceCellElement: popover.sourceCellElement || null,
                        exclusionElement: popoverRef.current,
                        anchorKind: "overflow-row",
                      });
                      return;
                    }
                    onSelectItem?.(item.id, {
                      triggerElement: event.currentTarget,
                      sourceCellElement: popover.sourceCellElement || null,
                      exclusionElement: popoverRef.current,
                      dateKey: popover.dateKey || null,
                      anchorKind: "overflow-row",
                      detailKind: item.detailKind || null,
                      itemsSnapshot: item.sourceItem || item.sourceEvent ? [item.sourceItem || item.sourceEvent] : null,
                    });
                  }}
                  onContextMenu={(event) => {
                    if (specialDate) return;
                    if (quickActions?.openContextMenu?.({
                      item,
                      task: item.sourceItem,
                      x: event.clientX,
                      y: event.clientY,
                      anchorElement: event.currentTarget,
                      sourceCellElement: popover.sourceCellElement || null,
                      exclusionElement: popoverRef.current,
                      dateKey: popover.dateKey || null,
                      anchorKind: "overflow-row",
                    })) {
                      event.preventDefault();
                      event.stopPropagation();
                      onBeforeItemAction?.();
                      return;
                    }
                    if (!item.sourceEvent?.writable) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onBeforeItemAction?.();
                    quickActions?.openDeleteMenu?.({
                      event: item.sourceEvent,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDragStart={(event) => {
                    if (!dragAllowed || !quickActions?.beginDrag?.(item.sourceEvent)) {
                      event.preventDefault();
                      return;
                    }
                    onBeforeItemAction?.();
                    onClose?.();
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
                    event.dataTransfer.setData("text/plain", String(item.title || ""));
                  }}
                  onDragEnd={() => quickActions?.endDrag?.()}
                  onPointerEnter={() => setActiveItemId(itemId)}
                  onPointerLeave={() => setActiveItemId((current) => (
                    current === itemId ? null : current
                  ))}
                  onFocus={() => setActiveItemId(itemId)}
                  onBlur={() => setActiveItemId((current) => (
                    current === itemId ? null : current
                  ))}
                  style={{
                    ...itemButtonStyle({
                      accent,
                      selected,
                      active,
                      ghost,
                      batchSelected,
                      specialDate,
                    }),
                    display: "grid",
                    gridTemplateColumns: specialDate
                      ? "28px minmax(0, 1fr)"
                      : leadingColumnWidth ? `${leadingColumnWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
                    alignItems: "center",
                    columnGap: specialDate ? 8 : leadingColumnWidth ? 8 : 0,
                  }}
                >
                  <CalendarChipReminderMarker item={item} />
                  {specialDate ? (
                    <GoogleSpecialDateBadge
                      item={item}
                      color={item.specialDateAccent || accent}
                      selected={selected}
                      active={active}
                      variant="agenda"
                    />
                  ) : (
                    <OverflowMetadata
                      item={item}
                      selected={selected}
                      accent={accent}
                      leadingColumnWidth={leadingColumnWidth}
                    />
                  )}
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12.5,
                        fontWeight: 500,
                        lineHeight: 1.25,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <CalendarChipStatusIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
                      <CalendarChipRecurringIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
                      <span
                        style={{
                          minWidth: 0,
                          flex: "1 1 auto",
                          overflow: "hidden",
                          textOverflow: specialDate ? "clip" : "ellipsis",
                          whiteSpace: specialDate ? "normal" : "nowrap",
                          display: specialDate ? "-webkit-box" : "block",
                          WebkitLineClamp: specialDate ? 2 : undefined,
                          WebkitBoxOrient: specialDate ? "vertical" : undefined,
                          textDecoration: item.complete ? "line-through" : "none",
                          textDecorationColor: "rgba(205,214,244,0.28)",
                        }}
                      >
                        {item.title}
                      </span>
                    </span>
                    {item.detail ? (
                      <span
                        style={{
                          fontSize: 10.5,
                          lineHeight: 1.4,
                          color: "rgba(205,214,244,0.56)",
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                      >
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                </Shell>
              );
            })}
          </div>
        </Motion.div>
      </AnimatePresence>
    </Motion.div>,
    document.body,
  );
}
