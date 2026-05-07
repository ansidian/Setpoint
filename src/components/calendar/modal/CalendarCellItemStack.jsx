import { useCallback, useLayoutEffect, useMemo, useState, useRef } from "react";
import { getVisibleCellItemCount } from "./calendarCellItemMetrics.js";
import { ItemChip, MoreButton } from "./CalendarCellItemChip.jsx";
import { getChipLeadingColumnWidth } from "./CalendarCellItemChipModel.js";
import {
  getMeasuredVisibleCellItemCount,
  getReservedCellItemLaneHeight,
  splitVisibleCellItems,
} from "./CalendarCellItemStackModel.js";

function isClippingAncestor(node) {
  if (!(node instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(node);
  return ["overflow", "overflowY"].some((property) => {
    const value = style[property];
    return value && value !== "visible";
  });
}

function nearestMeasuredHeight(node) {
  let current = node?.parentElement || null;
  let fallback = 0;
  while (current) {
    const height = current.clientHeight;
    if (height > 0) {
      if (isClippingAncestor(current)) return height;
      if (!fallback) fallback = height;
    }
    if (current.getAttribute?.("data-testid")?.startsWith("calendar-cell-")) return fallback;
    current = current.parentElement;
  }
  return fallback;
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
  reservedLaneCount = 0,
  overflowOpen = false,
  overflowAnchorKey,
  inlineOverflowOpen = false,
  inlineOverflowVisibleCount = null,
  inlineOverflowExternal = false,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
}) {
  const stackItems = useMemo(() => items || [], [items]);
  const [activeChipId, setActiveChipId] = useState(null);
  const [moreActive, setMoreActive] = useState(false);
  const stackRef = useRef(null);
  const inlineOverflowRef = useRef(null);
  const reservedHeight = getReservedCellItemLaneHeight(Math.max(0, reservedLaneCount), metrics);
  const measuredMetrics = useMemo(() => ({
    ...metrics,
    reservedHeight,
  }), [metrics, reservedHeight]);
  const [measuredCount, setMeasuredCount] = useState(() => (
    getVisibleCellItemCount(stackItems.length, measuredMetrics)
  ));

  const calculateVisibleCount = useCallback(() => {
    if (inlineOverflowOpen) {
      if (Number.isFinite(inlineOverflowVisibleCount)) {
        setMeasuredCount((current) => (
          current === inlineOverflowVisibleCount ? current : inlineOverflowVisibleCount
        ));
      }
      return;
    }

    if (!stackItems.length) {
      setMeasuredCount(0);
      return;
    }

    const availableHeight = nearestMeasuredHeight(stackRef.current);
    const nextCount = getMeasuredVisibleCellItemCount(stackItems, availableHeight, measuredMetrics);
    setMeasuredCount((current) => (current === nextCount ? current : nextCount));
  }, [inlineOverflowOpen, inlineOverflowVisibleCount, stackItems, measuredMetrics]);

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

  const visibleCount = inlineOverflowOpen && Number.isFinite(inlineOverflowVisibleCount)
    ? inlineOverflowVisibleCount
    : measuredCount;
  const { visibleItems, hiddenItems } = splitVisibleCellItems(stackItems, visibleCount);
  const leadingColumnWidth = useMemo(() => (
    getChipLeadingColumnWidth(stackItems)
  ), [stackItems]);
  const hiddenCount = hiddenItems.length;
  const hiddenStackHeight = hiddenCount > 0
    ? (hiddenCount * (metrics?.itemHeight ?? 24)) + ((hiddenCount - 1) * (metrics?.gap ?? 4))
    : 0;
  const hiddenSignature = hiddenItems.map((item) => String(item.id)).join("\u001f");
  const clearActiveChip = useCallback((itemId) => {
    setActiveChipId((current) => (
      current === itemId ? null : current
    ));
  }, []);

  useLayoutEffect(() => {
    onHiddenItemsChange?.({
      dateKey,
      day,
      hiddenItems,
      hiddenSignature,
      leadingColumnWidth,
      totalCount: stackItems.length,
      visibleCount,
    });
  }, [dateKey, day, hiddenItems, hiddenSignature, leadingColumnWidth, onHiddenItemsChange, stackItems.length, visibleCount]);

  useLayoutEffect(() => {
    if (!inlineOverflowOpen) return;
    if (hiddenCount <= 0) {
      onCloseInlineOverflow?.();
      return;
    }
    const firstChip = inlineOverflowRef.current?.querySelector(
      "button[data-testid='calendar-cell-item-chip']",
    );
    firstChip?.focus?.();
  }, [hiddenCount, inlineOverflowOpen, onCloseInlineOverflow]);

  if (!stackItems.length) return null;
  const itemMatchesSelected = (item) => {
    if (String(item.id) === String(selectedItemId)) return true;
    return (item.matchItemIds || []).some((id) => String(id) === String(selectedItemId));
  };

  return (
    <div
      ref={stackRef}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: metrics?.gap ?? 4,
        minWidth: 0,
        paddingTop: reservedHeight || undefined,
      }}
    >
      {visibleItems.map((item) => {
        const selected = itemMatchesSelected(item);
        return (
          <ItemChip
            key={item.renderKey || item.id}
            item={item}
            selected={selected}
            active={!item.isGhost && String(item.id) === String(activeChipId)}
            pastTone={pastTone}
            metrics={metrics}
            quickActions={quickActions}
            onSelectItem={onSelectItem}
            onSetActive={setActiveChipId}
            onClearActive={clearActiveChip}
            onBeforeDragStart={onBeforeItemAction}
            onBeforeDeleteMenu={onBeforeItemAction}
            stackRef={stackRef}
            dateKey={dateKey}
            leadingColumnWidth={leadingColumnWidth}
          />
        );
      })}

      {hiddenCount > 0 && inlineOverflowOpen && inlineOverflowExternal ? null : hiddenCount > 0 && inlineOverflowOpen ? (
        <div
          ref={inlineOverflowRef}
          data-testid="calendar-cell-inline-overflow"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            onInlineOverflowInteraction?.();
            event.stopPropagation();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          style={{
            position: "relative",
            zIndex: 3,
            isolation: "isolate",
            display: "flex",
            flexDirection: "column",
            gap: metrics?.gap ?? 4,
            minWidth: 0,
            padding: "4px",
            marginInline: -4,
            borderRadius: "0 0 10px 10px",
            border: "1px solid rgba(255,255,255,0.08)",
            borderTop: 0,
            background: "#16161e",
            boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
            pointerEvents: "auto",
            animation: "calendarInlineOverflowIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {hiddenItems.map((item) => {
            const selected = itemMatchesSelected(item);
            return (
              <ItemChip
                key={item.renderKey || item.id}
                item={item}
                selected={selected}
                active={!item.isGhost && String(item.id) === String(activeChipId)}
                pastTone={pastTone}
                metrics={metrics}
                quickActions={quickActions}
                onSelectItem={onSelectItem}
                onSetActive={setActiveChipId}
                onClearActive={clearActiveChip}
                onBeforeDragStart={() => {
                  onCloseInlineOverflow?.();
                  onBeforeItemAction?.();
                }}
                onBeforeDeleteMenu={() => {
                  onCloseInlineOverflow?.();
                  onBeforeItemAction?.();
                }}
                inlineOverflowItem
                stackRef={stackRef}
                dateKey={dateKey}
                leadingColumnWidth={leadingColumnWidth}
              />
            );
          })}
        </div>
      ) : hiddenCount > 0 ? (
        <MoreButton
          day={day}
          hiddenCount={hiddenCount}
          pastTone={pastTone}
          active={moreActive}
          metrics={metrics}
          open={overflowOpen}
          anchorKey={overflowAnchorKey}
          onPointerEnter={() => setMoreActive(true)}
          onPointerLeave={() => setMoreActive(false)}
          onFocus={() => setMoreActive(true)}
          onBlur={() => setMoreActive(false)}
          onClick={(event) => {
            onOpenOverflow?.({
              triggerElement: event.currentTarget,
              hiddenItems,
              totalCount: stackItems.length,
              visibleCount,
              dateKey,
              hiddenStackHeight,
              leadingColumnWidth,
            });
          }}
        />
      ) : null}
    </div>
  );
}
