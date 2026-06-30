/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.jsx";
import { formatAmount, daysLabel, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { billMatchesItemId, formatFullDate, getDayState, getScheduleUrl, payUrlForBill } from "./billsModel.js";
import BillSelectedCard from "./BillSelectedCard.jsx";

function BillSelectedActions({ bill, actualBudgetUrl, payUrl, compact = false }) {
  if (!bill) return null;
  const scheduleUrl = getScheduleUrl(bill, actualBudgetUrl);
  if (!scheduleUrl && !payUrl) return null;

  return (
    <RailActionGroup align="end">
      {scheduleUrl ? (
        <RailAction
          icon={ExternalLink}
          label="Open in Actual"
          href={scheduleUrl}
          accent="var(--sp-green)"
          tone="accent"
          size={compact ? "compact" : "default"}
        />
      ) : null}
      {payUrl ? (
        <RailAction
          icon={CreditCard}
          label="Pay Online"
          href={payUrl}
          accent="var(--sp-blue)"
          tone="accent"
          size={compact ? "compact" : "default"}
        />
      ) : null}
    </RailActionGroup>
  );
}

function SourceWarning({ errors = [] }) {
  if (!errors.length) return null;
  return (
    <div
      data-testid="calendar-bills-source-warning"
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--sp-cream) 16%, transparent)",
        background: "color-mix(in srgb, var(--sp-cream) 6%, transparent)",
        color: "color-mix(in srgb, var(--sp-cream) 86%, transparent)",
        fontSize: 11,
        lineHeight: 1.35,
      }}
    >
      Actual bills are partially unavailable.
    </div>
  );
}

function toBillRailItem(bill, selectedBillId, onSelectItem) {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);

  return {
    id: String(bill.id),
    timeLabel: bill.paid ? "Paid" : daysLabel(days),
    title: bill.name,
    subtitle: bill.payee && bill.payee !== bill.name ? bill.payee : null,
    meta: bill.type === "transfer" ? "Transfer" : bill.paid ? "Cleared" : "Scheduled",
    complete: bill.paid,
    selected: billMatchesItemId(bill, selectedBillId),
    onClick: onSelectItem ? () => onSelectItem(String(bill.id)) : undefined,
    dotColor: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? "#b4befe" : urgency.accent,
    trailing: (
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: bill.paid ? "var(--sp-green)" : bill.type === "transfer" ? "var(--sp-lavender)" : urgency.text,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatAmount(bill.amount)}
      </span>
    ),
  };
}

function BillsDetail({
  selectedDay,
  selectedDateKey,
  viewYear,
  viewMonth,
  items,
  data,
  selectedItemId,
  onSelectItem,
}) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const sourceErrors = Array.isArray(data?.errors) ? data.errors : [];
  const state = getDayState(items);
  const [showCompleted, setShowCompleted] = useState(state.activeCount === 0 && state.completedCount > 0);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedBill = allItems.find((bill) => billMatchesItemId(bill, selectedItemId)) || null;
  const compactDetail = state.totalCount >= 4;
  const selectedScheduleUrl = selectedBill ? getScheduleUrl(selectedBill, actualBudgetUrl) : null;
  const selectedPayUrl = selectedBill ? payUrlForBill(selectedBill, data?.payLinksByScheduleId) : null;
  const summary = [
    `${state.activeCount} unpaid`,
    state.completedCount ? `${state.completedCount} paid` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  return (
    <TimelineDetailRail
      eyebrow="Billing ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay, selectedDateKey)}
      summary={summary}
      accent="var(--sp-green)"
      headerContent={selectedBill ? (
        <BillSelectedCard
          bill={selectedBill}
          compact={compactDetail}
          actions={(selectedScheduleUrl || selectedPayUrl) ? (
            <BillSelectedActions
              bill={selectedBill}
              actualBudgetUrl={actualBudgetUrl}
              payUrl={selectedPayUrl}
              compact={compactDetail}
            />
          ) : null}
        />
      ) : null}
      actionContent={<SourceWarning errors={sourceErrors} />}
      sections={[
        {
          id: "active-bills",
          label: "Unpaid",
          items: state.activeItems.map((bill) => toBillRailItem(bill, selectedItemId, onSelectItem)),
        },
        {
          id: "completed-bills",
          label: "Paid",
          collapsible: true,
          expanded: showCompleted,
          onToggle: () => setShowCompleted((prev) => !prev),
          itemCount: state.completedCount,
          items: state.completedItems.map((bill) => toBillRailItem(bill, selectedItemId, onSelectItem)),
        },
      ]}
    />
  );
}

function BillsFloatingDetail({
  items,
  data,
  selectedItemId,
}) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const state = getDayState(items);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedBill = allItems.find((bill) => billMatchesItemId(bill, selectedItemId)) || null;
  const compactDetail = state.totalCount >= 4;
  const selectedScheduleUrl = selectedBill ? getScheduleUrl(selectedBill, actualBudgetUrl) : null;
  const selectedPayUrl = selectedBill ? payUrlForBill(selectedBill, data?.payLinksByScheduleId) : null;

  if (!selectedBill) return null;

  return (
    <BillSelectedCard
      bill={selectedBill}
      compact={compactDetail}
      actions={(selectedScheduleUrl || selectedPayUrl) ? (
        <BillSelectedActions
          bill={selectedBill}
          actualBudgetUrl={actualBudgetUrl}
          payUrl={selectedPayUrl}
          compact={compactDetail}
        />
      ) : null}
    />
  );
}

export function renderBillsDetail(props) {
  const state = getDayState(props.items);
  return <BillsDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}

export function renderBillsFloatingDetail(props) {
  const state = getDayState(props.items);
  return <BillsFloatingDetail key={`${props.selectedItemId}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
