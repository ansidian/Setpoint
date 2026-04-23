import CalendarCellItemStack from "../../modal/CalendarCellItemStack.jsx";
import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { getDayState, relativeDateLabel } from "./billsModel.js";

const LG_BILL_CHIP_METRICS = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fallback: 2,
};

const MD_BILL_CHIP_METRICS = {
  itemHeight: 28,
  moreHeight: 26,
  gap: 4,
  fallback: 2,
};

function resolveBillChipMetrics(layout) {
  const tier = layout?.tier;
  if (tier === "xl" || tier === "lg") return LG_BILL_CHIP_METRICS;
  return MD_BILL_CHIP_METRICS;
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
  contentHeight,
  pastTone,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  overflowOpen,
  layout,
  day,
}) {
  const state = getDayState(items);
  const descriptors = state.items.map(toBillDescriptor);

  if (!descriptors.length) return null;

  return (
    <CalendarCellItemStack
      day={day}
      items={descriptors}
      contentHeight={contentHeight}
      selectedItemId={selectedItemId}
      onSelectItem={onSelectItem}
      onOpenOverflow={onOpenOverflow}
      pastTone={pastTone}
      metrics={resolveBillChipMetrics(layout)}
      overflowOpen={overflowOpen}
    />
  );
}
