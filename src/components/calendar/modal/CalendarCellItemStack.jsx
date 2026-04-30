import { useCallback, useLayoutEffect, useState, useRef } from "react";
import { getVisibleCellItemCount } from "./calendarCellItemMetrics.js";

function chipStyle({
  item,
  selected,
  pastTone,
  active,
  metrics,
}) {
  const accent = item.accent || "var(--ea-accent)";
  const ghost = !!item.isGhost;
  const isPast = pastTone === "items";
  const quiet = item.complete || item.quiet;
  const itemHeight = metrics?.itemHeight ?? 24;
  const isLarge = itemHeight >= 28;
  const isMedium = itemHeight >= 26;
  const horizontalPadding = isLarge ? 11 : isMedium ? 10 : 9;
  const leadingPadding = isLarge ? 10 : isMedium ? 9 : 8;
  const radius = isLarge ? 10 : isMedium ? 9 : 8;

  return {
    display: "grid",
    gridTemplateColumns: item.leadingLabel ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    padding: item.leadingLabel ? `0 ${horizontalPadding}px 0 ${leadingPadding}px` : `0 ${horizontalPadding}px`,
    height: itemHeight,
    borderRadius: radius,
    border: ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
      : quiet
        ? "1px solid rgba(255,255,255,0.035)"
        : "1px solid rgba(255,255,255,0.045)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 18%, transparent), color-mix(in srgb, ${accent} 8%, transparent))`
      : active
        ? "rgba(255,255,255,0.065)"
      : quiet
        ? "rgba(255,255,255,0.018)"
        : "rgba(255,255,255,0.03)",
    boxShadow: selected
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.02))`
      : active
        ? "inset 0 1px 0 rgba(255,255,255,0.04)"
        : "none",
    color: selected ? "#f6f7fb" : quiet ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.78)",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    opacity: isPast ? (selected ? 0.92 : 0.82) : quiet ? 0.88 : 1,
    transition: "background 140ms, border-color 140ms, opacity 140ms, box-shadow 140ms, color 140ms",
    textDecoration: item.complete ? "line-through" : "none",
    textDecorationColor: "rgba(205,214,244,0.24)",
    fontFamily: "inherit",
    textAlign: "left",
  };
}

function splitVisibleItems(items, visibleCount) {
  let count = Math.min(Math.max(0, visibleCount), items.length);
  if (count === 0 && items.some((item) => item.isGhost)) {
    count = 1;
  }
  if (count >= items.length) return { visibleItems: items, hiddenItems: [] };

  const visibleItems = items.slice(0, count);
  const visibleIds = new Set(visibleItems.map((item) => String(item.id)));

  for (const ghost of items.slice(count).filter((item) => item.isGhost)) {
    const replaceIndex = [...visibleItems]
      .reverse()
      .findIndex((item) => !item.isGhost);
    if (replaceIndex < 0) break;
    const index = visibleItems.length - 1 - replaceIndex;
    visibleIds.delete(String(visibleItems[index].id));
    visibleItems[index] = ghost;
    visibleIds.add(String(ghost.id));
  }

  return {
    visibleItems,
    hiddenItems: items.filter((item) => !visibleIds.has(String(item.id))),
  };
}

function stackHeight({ visibleCount, hasOverflow, metrics }) {
  const itemHeight = metrics?.itemHeight ?? 24;
  const moreHeight = metrics?.moreHeight ?? 22;
  const gap = metrics?.gap ?? 4;
  const childCount = visibleCount + (hasOverflow ? 1 : 0);

  if (childCount <= 0) return 0;
  return (visibleCount * itemHeight)
    + (hasOverflow ? moreHeight : 0)
    + ((childCount - 1) * gap);
}

function measuredVisibleCount(items, availableHeight, metrics) {
  const itemCount = items.length;
  if (itemCount <= 0) return 0;
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
    return getVisibleCellItemCount(itemCount, metrics);
  }

  if (stackHeight({ visibleCount: itemCount, hasOverflow: false, metrics }) <= availableHeight) {
    return itemCount;
  }

  const minimumVisible = items.some((item) => item.isGhost) ? 1 : 0;
  for (let count = itemCount - 1; count >= minimumVisible; count -= 1) {
    if (stackHeight({ visibleCount: count, hasOverflow: true, metrics }) <= availableHeight) {
      return count;
    }
  }

  return minimumVisible;
}

function nearestMeasuredHeight(node) {
  let current = node?.parentElement || null;
  while (current) {
    const height = current.clientHeight;
    if (height > 0) return height;
    if (current.getAttribute?.("data-testid")?.startsWith("calendar-cell-")) return 0;
    current = current.parentElement;
  }
  return 0;
}

function MoreButton({
  hiddenCount,
  onClick,
  pastTone,
  day,
  active,
  metrics,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  open,
}) {
  const buttonHeight = metrics?.moreHeight ?? 22;
  const compact = buttonHeight >= 24;
  const large = buttonHeight >= 26;
  return (
    <button
      type="button"
      data-testid={`calendar-cell-overflow-trigger-${day}`}
      data-calendar-overflow-trigger="true"
      data-active={active ? "true" : "false"}
      data-calendar-focus-ring="true"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        minHeight: buttonHeight,
        width: "100%",
        justifyContent: "flex-start",
        padding: large ? "0 12px" : compact ? "0 11px" : "0 10px",
        borderRadius: large ? 10 : compact ? 9 : 8,
        border: active || open
          ? "1px solid rgba(255,255,255,0.1)"
          : "1px solid rgba(255,255,255,0.045)",
        background: active || open ? "rgba(255,255,255,0.052)" : "rgba(255,255,255,0.018)",
        color: active || open
          ? "#eef2ff"
          : pastTone === "items" ? "rgba(205,214,244,0.42)" : "rgba(205,214,244,0.56)",
        cursor: "pointer",
        fontSize: large ? 12 : compact ? 11.5 : 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textAlign: "left",
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "stretch",
        transition: "color 140ms, background 140ms, border-color 140ms",
      }}
    >
      +{hiddenCount} more
    </button>
  );
}

export default function CalendarCellItemStack({
  day,
  dateKey,
  items,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  quickActions,
  pastTone,
  metrics,
  overflowOpen = false,
}) {
  const [activeChipId, setActiveChipId] = useState(null);
  const [moreActive, setMoreActive] = useState(false);
  const stackRef = useRef(null);
  const [measuredCount, setMeasuredCount] = useState(() => (
    getVisibleCellItemCount(items?.length || 0, metrics)
  ));

  const calculateVisibleCount = useCallback(() => {
    if (!items?.length) {
      setMeasuredCount(0);
      return;
    }

    const availableHeight = nearestMeasuredHeight(stackRef.current);
    const nextCount = measuredVisibleCount(items, availableHeight, metrics);
    setMeasuredCount((current) => (current === nextCount ? current : nextCount));
  }, [items, metrics]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => calculateVisibleCount());
    return () => cancelAnimationFrame(frame);
  }, [calculateVisibleCount]);

  useLayoutEffect(() => {
    const target = stackRef.current?.parentElement;
    if (!target || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => calculateVisibleCount());
    observer.observe(target);
    return () => observer.disconnect();
  }, [calculateVisibleCount]);

  if (!items?.length) return null;
  const visibleCount = measuredCount;
  const { visibleItems, hiddenItems } = splitVisibleItems(items, visibleCount);
  const hiddenCount = hiddenItems.length;

  return (
    <div
      ref={stackRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: metrics?.gap ?? 4,
        minWidth: 0,
      }}
    >
      {visibleItems.map((item) => {
        const selected = String(item.id) === String(selectedItemId);
        const ghost = !!item.isGhost;
        const active = !ghost && String(item.id) === String(activeChipId);
        const dragAllowed = !ghost && !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent;
        if (ghost) {
          return (
            <div
              key={item.id}
              data-testid="calendar-ghost-chip"
              data-ghost-kind={item.ghostKind || item.kind || "item"}
              data-ghost-start={item.ghostStart || item.startDate || undefined}
              data-ghost-end={item.ghostEnd || item.endDate || undefined}
              aria-hidden="true"
              style={chipStyle({
                item,
                selected: false,
                pastTone,
                active: false,
                metrics,
              })}
            >
              {item.leadingLabel ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 10.5 : (metrics?.itemHeight ?? 24) >= 26 ? 10 : 9.5,
                    fontWeight: 700,
                    letterSpacing: 0.2,
                    color: item.leadingColor || item.accent || "var(--ea-accent)",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.leadingLabel}
                </span>
              ) : null}
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 11.5 : (metrics?.itemHeight ?? 24) >= 26 ? 11 : 10.5,
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {item.title}
              </span>
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            data-testid="calendar-cell-item-chip"
            data-item-id={String(item.id)}
            data-hovered={active ? "true" : "false"}
            draggable={dragAllowed}
            data-calendar-focus-ring="true"
            onClick={(event) => {
              event.stopPropagation();
              onSelectItem?.(item.id);
            }}
            onContextMenu={(event) => {
              if (!item.sourceEvent?.writable) return;
              event.preventDefault();
              event.stopPropagation();
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
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
              event.dataTransfer.setData("text/plain", String(item.title || ""));
            }}
            onDragEnd={() => quickActions?.endDrag?.()}
            onPointerEnter={() => setActiveChipId(String(item.id))}
            onPointerLeave={() => setActiveChipId((current) => (
              current === String(item.id) ? null : current
            ))}
            onFocus={() => setActiveChipId(String(item.id))}
            onBlur={() => setActiveChipId((current) => (
              current === String(item.id) ? null : current
            ))}
            style={chipStyle({
              item,
              selected,
              pastTone,
              active,
              metrics,
            })}
          >
            {item.leadingLabel ? (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 10.5 : (metrics?.itemHeight ?? 24) >= 26 ? 10 : 9.5,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  color: selected
                    ? item.leadingColor || item.accent || "var(--ea-accent)"
                    : item.leadingColor || "rgba(205,214,244,0.62)",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.leadingLabel}
              </span>
            ) : null}
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 11.5 : (metrics?.itemHeight ?? 24) >= 26 ? 11 : 10.5,
                fontWeight: selected ? 600 : 500,
                lineHeight: 1.2,
              }}
            >
              {item.title}
            </span>
          </button>
        );
      })}

      {hiddenCount > 0 ? (
        <MoreButton
          day={day}
          hiddenCount={hiddenCount}
          pastTone={pastTone}
          active={moreActive}
          metrics={metrics}
          open={overflowOpen}
          onPointerEnter={() => setMoreActive(true)}
          onPointerLeave={() => setMoreActive(false)}
          onFocus={() => setMoreActive(true)}
          onBlur={() => setMoreActive(false)}
          onClick={(event) => {
            onOpenOverflow?.({
              triggerElement: event.currentTarget,
              hiddenItems,
              totalCount: items.length,
              visibleCount,
              dateKey,
            });
          }}
        />
      ) : null}
    </div>
  );
}
