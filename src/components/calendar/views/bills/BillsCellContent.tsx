/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from "react";
import type { ComponentProps, ComponentType } from "react";
import CalendarCellItemStack from "../../modal/CalendarCellItemStack";
import { getCalendarCellCapacity } from "../../modal/calendarCellItemMetrics";
import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { getDayState, relativeDateLabel } from "./billsModel.ts";
import { FINANCE_SOURCE_COLORS, transactionDirectionColor } from "./financeSourceColors.ts";
import type { CalendarChipItem } from "../../modal/CalendarCellItemChip";
import type { CalendarCellStackMetrics } from "../../modal/CalendarCellItemStackModel";
import type { CalendarLayoutTier } from "../../modal/calendarCellItemMetrics";
import type { FinanceItem } from "./billsModel";

type StackProps = ComponentProps<typeof CalendarCellItemStack>;
interface BillsCellItemsProps extends Omit<StackProps, "items" | "metrics" | "day"> {
  items: unknown;
  day?: number;
  metrics: CalendarCellStackMetrics;
  onOverflowReanchorRequestHandled?: () => void;
  overflowReanchorDateKey?: string | null;
}
export interface RenderBillsCellContentsProps extends Omit<BillsCellItemsProps, "metrics"> {
  layout?: { tier?: string } | null;
}
const CalendarCellItemStackCompat = CalendarCellItemStack as ComponentType<StackProps & {
  onOverflowReanchorRequestHandled?: () => void;
  overflowReanchorDateKey?: string | null;
}>;

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

function computeBillChipMetrics(layout?: { tier?: string } | null): CalendarCellStackMetrics {
  const tier = layout?.tier;
  const base = tier === "xl" || tier === "lg" ? LG_BILL_CHIP_METRICS : MD_BILL_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout as { tier?: CalendarLayoutTier }),
  };
}

// `layout` objects are frozen per-tier singletons (see calendarLayout.ts), so a
// WeakMap keyed on the layout object identity gives every cell/render the same
// metrics object for the same tier.
const billChipMetricsCache = new WeakMap<object, CalendarCellStackMetrics>();

export function resolveBillChipMetrics(layout?: { tier?: string } | null): CalendarCellStackMetrics {
  if (!layout || typeof layout !== "object") return computeBillChipMetrics(layout);
  const cached = billChipMetricsCache.get(layout);
  if (cached) return cached;
  const metrics = computeBillChipMetrics(layout);
  billChipMetricsCache.set(layout, metrics);
  return metrics;
}

export function toBillDescriptor(bill: FinanceItem): CalendarChipItem {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);
  const isTransfer = bill.type === "transfer";
  const accent = bill.paid
    ? "#a6e3a1"
    : isTransfer
      ? FINANCE_SOURCE_COLORS.transfer
      : days != null && days < 0
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
    sourceItem: bill as CalendarChipItem["sourceItem"],
    title: bill.name || bill.payee || "Untitled bill",
    detail: bill.paid
      ? "Cleared"
      : isTransfer
        ? "Transfer"
        : bill.next_date
          ? relativeDateLabel(days)
          : "Scheduled",
    leadingLabel: formatAmount(bill.amount || 0),
    preserveLeadingLabel: true,
    accent,
    leadingColor: accent,
    complete: bill.paid,
    quiet: bill.paid,
  };
}

export function toTransactionDescriptor(transaction: FinanceItem): CalendarChipItem {
  const income = transaction.direction === "income";
  const accent = transactionDirectionColor(transaction.direction);
  return {
    id: String(transaction.id),
    selectionId: String(transaction.id),
    renderKey: `transaction:${transaction.id}`,
    layoutId: `calendar-transaction-chip:${transaction.id}`,
    matchItemIds: [String(transaction.id)],
    sourceItem: transaction as CalendarChipItem["sourceItem"],
    title: transaction.payee || transaction.name || "Unknown",
    detail: income ? "Inflow" : "Outflow",
    detailKind: "transaction",
    leadingLabel: `${income ? "+" : "−"}${formatAmount(transaction.amount || 0)}`,
    preserveLeadingLabel: true,
    accent,
    leadingColor: accent,
    quiet: !income,
  };
}

// Builds the ordered chip descriptor array inside useMemo so an untouched
// cell keeps the same array/descriptor identities across re-renders it can't
// avoid (e.g. a sibling cell's selection change re-rendering the whole grid).
const BillsCellItems = memo(function BillsCellItems({
  day = 0,
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
}: BillsCellItemsProps) {
  const descriptors = useMemo(() => {
    const state = getDayState(items);
    return state.items.map((item) => (
      item.type === "transaction" ? toTransactionDescriptor(item) : toBillDescriptor(item)
    ));
  }, [items]);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStackCompat
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
}: RenderBillsCellContentsProps) {
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
