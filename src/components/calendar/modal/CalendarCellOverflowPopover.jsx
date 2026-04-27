import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isOverflowTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-overflow-trigger='true']");
}

function resolvePosition(triggerElement) {
  const viewportPadding = 16;
  const width = Math.min(320, window.innerWidth - viewportPadding * 2);

  if (!triggerElement?.isConnected) {
    return { top: viewportPadding, left: viewportPadding, width };
  }

  const rect = triggerElement.getBoundingClientRect();
  const left = clamp(rect.left, viewportPadding, window.innerWidth - width - viewportPadding);
  const top = clamp(rect.bottom + 8, viewportPadding, window.innerHeight - 180);
  return { top, left, width };
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
}) {
  return {
    display: "grid",
    gridTemplateColumns: "inherit",
    alignItems: "start",
    gap: 10,
    padding: "11px 12px",
    borderRadius: 10,
    border: selected
      ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : "1px solid rgba(255,255,255,0.05)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, transparent), color-mix(in srgb, ${accent} 6%, transparent))`
      : active
        ? "rgba(255,255,255,0.062)"
        : "rgba(255,255,255,0.024)",
    boxShadow: active && !selected
      ? "inset 0 1px 0 rgba(255,255,255,0.04)"
      : "none",
    color: "#eef2ff",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "border-color 140ms, background 140ms, box-shadow 140ms",
  };
}

export default function CalendarCellOverflowPopover({
  popover,
  selectedItemId,
  onSelectItem,
  onClose,
  suppressOutsideClick,
}) {
  const reducedMotion = useReducedMotion();
  const popoverRef = useRef(null);
  const scrollRef = useRef(null);
  const positionRafRef = useRef(0);
  const [activeItemId, setActiveItemId] = useState(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300 });

  const updatePosition = useCallback(() => {
    if (!popover?.triggerElement?.isConnected) {
      onClose?.();
      return;
    }

    setPos((current) => {
      const next = resolvePosition(popover.triggerElement);
      if (
        current.top === next.top
        && current.left === next.left
        && current.width === next.width
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
      if (isOverflowTriggerTarget(event.target)) return;
      if (popover.triggerElement?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      onClose?.();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [popover, onClose]);

  useEffect(() => {
    if (!popover) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      onClose?.();
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [popover, onClose]);

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
        maxHeight: 320,
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
              const active = itemId === String(activeItemId);
              const accent = item.accent || "var(--ea-accent)";

              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="calendar-cell-overflow-item"
                  data-item-id={itemId}
                  data-hovered={active ? "true" : "false"}
                  onClick={() => {
                    onSelectItem?.(item.id);
                    onClose?.();
                  }}
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
                    }),
                    gridTemplateColumns: item.leadingLabel ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
                    textDecoration: item.complete ? "line-through" : "none",
                    textDecorationColor: "rgba(205,214,244,0.28)",
                  }}
                >
                  {item.leadingLabel ? (
                    <span
                      style={{
                        paddingTop: 2,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.2,
                        color: item.leadingColor || accent,
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {item.leadingLabel}
                    </span>
                  ) : null}
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: selected ? 600 : 500,
                        lineHeight: 1.25,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
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
                </button>
              );
            })}
          </div>
        </Motion.div>
      </AnimatePresence>
    </Motion.div>,
    document.body,
  );
}
