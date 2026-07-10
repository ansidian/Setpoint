/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from "react";
import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { getCalendarCellCapacity } from "../../modal/calendarCellItemMetrics.js";
import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { getDayState, relativeDateLabel } from "./billsModel.js";

const LG_BILL_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_BILL_CHIP_METRICS = {
  itemHeight: 36,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

function computeBillChipMetrics(layout) {
  const tier = layout?.tier;
  const base = tier === "xl" || tier === "lg" ? LG_BILL_CHIP_METRICS : MD_BILL_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout),
  };
}

// `layout` objects are frozen per-tier singletons (see calendarLayout.js), so a
// WeakMap keyed on the layout object identity gives every cell/render the same
// metrics object for the same tier.
const billChipMetricsCache = new WeakMap();

export function resolveBillChipMetrics(layout) {
  if (!layout || typeof layout !== "object") return computeBillChipMetrics(layout);
  const cached = billChipMetricsCache.get(layout);
  if (cached) return cached;
  const metrics = computeBillChipMetrics(layout);
  billChipMetricsCache.set(layout, metrics);
  return metrics;
}

export function toBillDescriptor(bill) {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);
  const isTransfer = bill.type === "transfer";
  const accent = bill.paid
    ? "#a6e3a1"
    : isTransfer
      ? "#b4befe"
      : days < 0
        ? "#f38ba8"
        : days === null || days > 3
          ? "#a6e3a1"
          : urgency.text;

  return {
    id: String(bill.id),
    selectionId: String(bill.scheduleId || bill.id),
    renderKey: `bill:${bill.scheduleId || bill.id}`,
    layoutId: `calendar-bill-chip:${bill.scheduleId || bill.id}`,
    matchItemIds: [bill.id, bill.scheduleId].filter(Boolean).map(String),
    sourceItem: bill,
    title: bill.name,
    detail: bill.paid
      ? "Cleared"
      : isTransfer
        ? "Transfer"
        : bill.next_date
          ? relativeDateLabel(days)
          : "Scheduled",
    leadingLabel: formatAmount(bill.amount),
    preserveLeadingLabel: true,
    accent,
    leadingColor: accent,
    complete: bill.paid,
    quiet: bill.paid,
  };
}

// Builds the ordered chip descriptor array inside useMemo so an untouched
// cell keeps the same array/descriptor identities across re-renders it can't
// avoid (e.g. a sibling cell's selection change re-rendering the whole grid).
const BillsCellItems = memo(function BillsCellItems({
  day,
  dateKey,
  items,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  pastTone,
  metrics,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowAutoFocus,
  inlineOverflowVisibleCount,
  inlineOverflowExternal,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  onOverflowReanchorRequestHandled,
  overflowReanchorDateKey,
  suppressedSelectedHiddenAutoOpenKey,
}) {
  const descriptors = useMemo(() => {
    const state = getDayState(items);
    return state.items.map(toBillDescriptor);
  }, [items]);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStack
      day={day}
      dateKey={dateKey}
      items={descriptors}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={metrics}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowAutoFocus={inlineOverflowAutoFocus}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      inlineOverflowExternal={inlineOverflowExternal}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
      onOverflowReanchorRequestHandled={onOverflowReanchorRequestHandled}
      overflowReanchorDateKey={overflowReanchorDateKey}
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
    />
  );
});

export function renderBillsCellContents({
  items,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowAutoFocus,
  inlineOverflowVisibleCount,
  inlineOverflowExternal,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  onOverflowReanchorRequestHandled,
  overflowReanchorDateKey,
  suppressedSelectedHiddenAutoOpenKey,
  layout,
  day,
  dateKey,
}) {
  return (
    <BillsCellItems
      day={day}
      dateKey={dateKey}
      items={items}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={resolveBillChipMetrics(layout)}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowAutoFocus={inlineOverflowAutoFocus}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      inlineOverflowExternal={inlineOverflowExternal}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
      onOverflowReanchorRequestHandled={onOverflowReanchorRequestHandled}
      overflowReanchorDateKey={overflowReanchorDateKey}
      suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
    />
  );
}
