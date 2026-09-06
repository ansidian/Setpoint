import { useCallback, useLayoutEffect, useMemo, useState, useRef } from "react";
import { getVisibleCellItemCount } from "./calendarCellItemMetrics";
import { ItemChip, MoreButton } from "./CalendarCellItemChip";
import { getChipLeadingColumnWidth } from "./CalendarCellItemChipModel";
import {
  calendarCellItemMatchesSelected,
  getMeasuredCellItemStackPlan,
  getReservedCellItemLaneHeight,
  getSelectedHiddenCellItemKey,
  splitVisibleCellItems,
} from "./CalendarCellItemStackModel";
import type { CalendarCellStackMetrics } from "./CalendarCellItemStackModel";
import type { CalendarChipItem, CalendarItemQuickActions } from "./CalendarCellItemChip";
import type { CalendarOverflowComposition } from "./useCalendarGridOverflow";
import { overflowCompletionSignature } from "./calendarGridUtils";

function isClippingAncestor(node: Element | null | undefined): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(node);
  return (["overflow", "overflowY"] as const).some((property) => {
    const value = style[property];
    return value && value !== "visible";
  });
}

function nearestMeasuredHeight(node: HTMLElement | null | undefined): number {
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
  inlineOverflowAutoFocus = true,
  inlineOverflowVisibleCount = null,
  inlineOverflowExternal = false,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  suppressedSelectedHiddenAutoOpenKey = null,
}: {
  day: number;
  dateKey?: string | null;
  items?: CalendarChipItem[] | null;
  selectedItemId?: unknown;
  onSelectItem?: (itemId: string, context: Record<string, unknown>) => void;
  onOpenOverflow?: (options: {
    triggerElement: HTMLButtonElement;
    hiddenItems: CalendarChipItem[];
    totalCount: number;
    visibleCount: number;
    dateKey?: string | null;
    hiddenStackHeight: number;
    leadingColumnWidth: number;
    focusOnOpen?: boolean;
  }) => void;
  quickActions?: CalendarItemQuickActions | null;
  pastTone?: string | null;
  metrics?: CalendarCellStackMetrics;
  reservedLaneCount?: number;
  overflowOpen?: boolean;
  overflowAnchorKey?: string;
  inlineOverflowOpen?: boolean;
  inlineOverflowAutoFocus?: boolean;
  inlineOverflowVisibleCount?: number | null;
  inlineOverflowExternal?: boolean;
  onInlineOverflowInteraction?: () => void;
  onCloseInlineOverflow?: () => void;
  onHiddenItemsChange?: (composition: CalendarOverflowComposition) => void;
  onBeforeItemAction?: () => void;
  suppressedSelectedHiddenAutoOpenKey?: string | null;
}) {
  const stackItems = useMemo(() => items || [], [items]);
  const [activeChipId, setActiveChipId] = useState<string | null>(null);
  const [moreActive, setMoreActive] = useState(false);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineOverflowRef = useRef<HTMLDivElement | null>(null);
  const hiddenItemsNotificationRef = useRef<string | null>(null);
  const lastAutoOpenedHiddenKeyRef = useRef<string | null>(null);
  const reservedHeight = getReservedCellItemLaneHeight(Math.max(0, reservedLaneCount), metrics);
  const measuredMetrics = useMemo(() => ({
    ...metrics,
    reservedHeight,
  }), [metrics, reservedHeight]);
  const [measuredPlan, setMeasuredPlan] = useState(() => {
    const visibleCount = getVisibleCellItemCount(stackItems.length, measuredMetrics);
    return {
      visibleCount,
      overflowVisible: visibleCount < stackItems.length,
    };
  });

  const calculateVisibleCount = useCallback(() => {
    if (inlineOverflowOpen) {
      if (typeof inlineOverflowVisibleCount === "number" && Number.isFinite(inlineOverflowVisibleCount)) {
        setMeasuredPlan((current) => (
          current.visibleCount === inlineOverflowVisibleCount && current.overflowVisible
            ? current
            : { visibleCount: inlineOverflowVisibleCount, overflowVisible: true }
        ));
      }
      return;
    }

    if (!stackItems.length) {
      setMeasuredPlan((current) => (
        current.visibleCount === 0 && !current.overflowVisible
          ? current
          : { visibleCount: 0, overflowVisible: false }
      ));
      return;
    }

    const measuredHeight = nearestMeasuredHeight(stackRef.current);
    const availableHeight = measuredHeight > 0 ? measuredHeight : undefined;
    const nextPlan = getMeasuredCellItemStackPlan(stackItems, availableHeight, measuredMetrics);
    setMeasuredPlan((current) => (
      current.visibleCount === nextPlan.visibleCount && current.overflowVisible === nextPlan.overflowVisible
        ? current
        : nextPlan
    ));
  }, [inlineOverflowOpen, inlineOverflowVisibleCount, stackItems, measuredMetrics]);

  useLayoutEffect(() => {
    calculateVisibleCount(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [calculateVisibleCount]);

  useLayoutEffect(() => {
    const target = stackRef.current?.parentElement;
    if (!target || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => calculateVisibleCount());
    observer.observe(target);
    return () => observer.disconnect();
  }, [calculateVisibleCount]);

  const visibleCount = inlineOverflowOpen && typeof inlineOverflowVisibleCount === "number" && Number.isFinite(inlineOverflowVisibleCount)
    ? inlineOverflowVisibleCount
    : measuredPlan.visibleCount;
  const { visibleItems, hiddenItems } = splitVisibleCellItems(stackItems, visibleCount);
  const leadingColumnWidth = useMemo(() => (
    getChipLeadingColumnWidth(stackItems)
  ), [stackItems]);
  const hiddenCount = hiddenItems.length;
  const overflowTriggerVisible = hiddenCount > 0 && measuredPlan.overflowVisible;
  const hiddenStackHeight = hiddenCount > 0
    ? (hiddenCount * (metrics?.itemHeight ?? 24)) + ((hiddenCount - 1) * (metrics?.gap ?? 4))
    : 0;
  const hiddenSignature = hiddenItems.map((item) => String(item.id)).join("\u001f");
  const hiddenNotificationSignature = [
    dateKey || "",
    day ?? "",
    hiddenSignature,
    overflowCompletionSignature(hiddenItems),
    leadingColumnWidth,
    stackItems.length,
    visibleCount,
    overflowTriggerVisible ? "overflow" : "no-overflow",
  ].join("\u001e");
  const clearActiveChip = useCallback((itemId: string) => {
    setActiveChipId((current) => (
      current === itemId ? null : current
    ));
  }, []);
  // Shared by inline-overflow chips' onBeforeDragStart/onBeforeDeleteMenu so
  // both stay referentially stable across renders instead of the inline
  // arrow functions that used to be recreated every render, which defeated
  // ItemChip's memo for every hidden chip on every stack re-render.
  const closeInlineOverflowBeforeItemAction = useCallback(() => {
    onCloseInlineOverflow?.();
    onBeforeItemAction?.();
  }, [onCloseInlineOverflow, onBeforeItemAction]);

  useLayoutEffect(() => {
    if (hiddenItemsNotificationRef.current === hiddenNotificationSignature) return;
    hiddenItemsNotificationRef.current = hiddenNotificationSignature;
    onHiddenItemsChange?.({
      dateKey,
      day,
      hiddenItems,
      hiddenSignature,
      leadingColumnWidth,
      totalCount: stackItems.length,
      visibleCount,
    });
  }, [dateKey, day, hiddenItems, hiddenNotificationSignature, hiddenSignature, leadingColumnWidth, onHiddenItemsChange, stackItems.length, visibleCount]);

  useLayoutEffect(() => {
    if (!inlineOverflowOpen) return;
    if (hiddenCount <= 0) {
      onCloseInlineOverflow?.();
      return;
    }
    if (!inlineOverflowAutoFocus) return;
    const firstChip = inlineOverflowRef.current?.querySelector<HTMLButtonElement>(
      "button[data-testid='calendar-cell-item-chip']",
    );
    firstChip?.focus?.();
  }, [hiddenCount, inlineOverflowAutoFocus, inlineOverflowOpen, onCloseInlineOverflow]);

  const selectedHiddenKey = getSelectedHiddenCellItemKey({ hiddenItems, selectedItemId, dateKey });
  useLayoutEffect(() => {
    if (!selectedHiddenKey) {
      lastAutoOpenedHiddenKeyRef.current = null;
      return;
    }
    if (selectedHiddenKey === suppressedSelectedHiddenAutoOpenKey) return;
    if (overflowOpen || inlineOverflowOpen) return;
    if (!overflowTriggerVisible) return;
    if (lastAutoOpenedHiddenKeyRef.current === selectedHiddenKey) return;
    const triggerElement = moreButtonRef.current;
    if (!triggerElement) return;
    lastAutoOpenedHiddenKeyRef.current = selectedHiddenKey;
    onOpenOverflow?.({
      triggerElement,
      hiddenItems,
      totalCount: stackItems.length,
      visibleCount,
      dateKey,
      hiddenStackHeight,
      leadingColumnWidth,
      focusOnOpen: false,
    });
  }, [
    dateKey,
    hiddenItems,
    hiddenStackHeight,
    inlineOverflowOpen,
    leadingColumnWidth,
    onOpenOverflow,
    overflowOpen,
    overflowTriggerVisible,
    selectedHiddenKey,
    suppressedSelectedHiddenAutoOpenKey,
    stackItems.length,
    visibleCount,
  ]);

  if (!stackItems.length) return null;

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
        const selected = calendarCellItemMatchesSelected(item, selectedItemId);
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
          onKeyDown={(event) => {
            const isSpaceKey = event.key === " " || event.code === "Space";
            if (
              isSpaceKey
              && event.target instanceof HTMLElement
              && event.target.closest("[data-calendar-event-activation='true']")
            ) {
              return;
            }
            event.stopPropagation();
          }}
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
            background: "var(--sp-panel)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
            pointerEvents: "auto",
            animation: "calendarInlineOverflowIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {hiddenItems.map((item) => {
            const selected = calendarCellItemMatchesSelected(item, selectedItemId);
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
                onBeforeDragStart={closeInlineOverflowBeforeItemAction}
                onBeforeDeleteMenu={closeInlineOverflowBeforeItemAction}
                inlineOverflowItem
                stackRef={stackRef}
                dateKey={dateKey}
                leadingColumnWidth={leadingColumnWidth}
              />
            );
          })}
        </div>
      ) : overflowTriggerVisible ? (
        <MoreButton
          day={day}
          hiddenCount={hiddenCount}
          buttonRef={moreButtonRef}
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
