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

function resolveBillChipMetrics(layout) {
  const tier = layout?.tier;
  const base = tier === "xl" || tier === "lg" ? LG_BILL_CHIP_METRICS : MD_BILL_CHIP_METRICS;
  return {
    ...base,
    ...getCalendarCellCapacity(layout),
  };
}

function toBillDescriptor(bill) {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);
  const isTransfer = bill.type === "transfer";
  const accent = bill.paid
    ? "#a6e3a1"
    : isTransfer
      ? "#b4befe"
      : days < 0
        ? "#f38ba8"
        : urgency.text === "rgba(205,214,244,0.5)"
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
    leadingLabel: formatAmount(bill.amount).replace(".00", ""),
    accent,
    leadingColor: accent,
    complete: bill.paid,
    quiet: bill.paid,
  };
}

export function renderBillsCellContents({
  items,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  overflowOpen,
  overflowAnchorKey,
  inlineOverflowOpen,
  inlineOverflowVisibleCount,
  onInlineOverflowInteraction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onBeforeItemAction,
  layout,
  day,
  dateKey,
}) {
  const state = getDayState(items);
  const descriptors = state.items.map(toBillDescriptor);

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
      metrics={resolveBillChipMetrics(layout)}
      overflowOpen={overflowOpen}
      overflowAnchorKey={overflowAnchorKey}
      inlineOverflowOpen={inlineOverflowOpen}
      inlineOverflowVisibleCount={inlineOverflowVisibleCount}
      onInlineOverflowInteraction={onInlineOverflowInteraction}
      onCloseInlineOverflow={onCloseInlineOverflow}
      onHiddenItemsChange={onHiddenItemsChange}
      onBeforeItemAction={onBeforeItemAction}
    />
  );
}
