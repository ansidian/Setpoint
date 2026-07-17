/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import TimelineDetailRail from "../../TimelineDetailRail.tsx";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.tsx";
import { formatAmount, daysLabel, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { billMatchesItemId, formatFullDate, getDayState, getScheduleUrl, payUrlForBill } from "./billsModel.ts";
import BillSelectedCard from "./BillSelectedCard.tsx";
import TransactionSelectedCard from "./TransactionSelectedCard.tsx";
import { FINANCE_SOURCE_COLORS, transactionDirectionColor } from "./financeSourceColors.ts";
import type { BillsViewData, FinanceItem } from "./billsModel";

interface BillsDetailData extends BillsViewData {
  errors?: unknown[];
  transactionsTruncated?: boolean;
  payLinksByScheduleId?: Record<string, string>;
}
interface TimelineRailItem {
  id: string;
  timeLabel: string;
  title: string;
  subtitle: string | null;
  meta: string;
  complete?: boolean;
  selected: boolean;
  onClick?: () => void;
  dotColor: string;
  trailing: ReactNode;
}
interface TimelineSection {
  id: string;
  label: string;
  items: TimelineRailItem[];
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  itemCount?: number;
}
interface TimelineProps {
  eyebrow?: string;
  title: string;
  summary?: string;
  accent?: string;
  headerContent?: ReactNode;
  actionContent?: ReactNode;
  sections?: TimelineSection[];
}
interface BillDetailProps {
  selectedDay: number;
  selectedDateKey?: string | null;
  viewYear: number;
  viewMonth: number;
  items: unknown;
  data?: BillsDetailData | null;
  selectedItemId?: unknown;
  onSelectItem?: (itemId: string) => void;
}
type BillFloatingDetailProps = Pick<BillDetailProps, "items" | "data" | "selectedItemId">;
const Timeline = TimelineDetailRail as ComponentType<TimelineProps>;
const Action = RailAction as ComponentType<{
  icon: LucideIcon;
  label: string;
  href?: string | null;
  accent?: string;
  tone?: string;
  size?: string;
  onClick?: () => void;
}>;
const formatDaysLabel = daysLabel as (days: number | null) => string;

function BillSelectedActions({ bill, actualBudgetUrl, payUrl, compact = false }: {
  bill?: FinanceItem | null;
  actualBudgetUrl?: string | null;
  payUrl?: string | null;
  compact?: boolean;
}) {
  if (!bill) return null;
  const scheduleUrl = getScheduleUrl(bill, actualBudgetUrl);
  if (!scheduleUrl && !payUrl) return null;

  return (
    <RailActionGroup align="end">
      {scheduleUrl ? (
        <Action
          icon={ExternalLink}
          label="Open in Actual"
          href={scheduleUrl}
          accent="var(--sp-green)"
          tone="accent"
          size={compact ? "compact" : "default"}
        />
      ) : null}
      {payUrl ? (
        <Action
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

function SourceWarning({ errors = [], transactionsTruncated = false }: { errors?: unknown[]; transactionsTruncated?: boolean }) {
  if (!errors.length && !transactionsTruncated) return null;
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
      {errors.length && transactionsTruncated
        ? "Actual finance data is partially unavailable, and transaction results are limited for this range."
        : transactionsTruncated
          ? "Transaction results are limited for this range."
          : "Actual finance data is partially unavailable."}
    </div>
  );
}

function toBillRailItem(bill: FinanceItem, selectedBillId: unknown, onSelectItem?: (itemId: string) => void): TimelineRailItem {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);

  return {
    id: String(bill.id),
    timeLabel: bill.paid ? "Paid" : formatDaysLabel(days),
    title: bill.name || bill.payee || "Untitled bill",
    subtitle: bill.payee && bill.payee !== bill.name ? bill.payee : null,
    meta: bill.type === "transfer" ? "Transfer" : bill.paid ? "Cleared" : "Scheduled",
    complete: bill.paid,
    selected: billMatchesItemId(bill, selectedBillId),
    onClick: onSelectItem ? () => onSelectItem(String(bill.id)) : undefined,
    dotColor: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? FINANCE_SOURCE_COLORS.transfer : urgency.accent,
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
        {formatAmount(bill.amount || 0)}
      </span>
    ),
  };
}

function toTransactionRailItem(transaction: FinanceItem, selectedItemId: unknown, onSelectItem?: (itemId: string) => void): TimelineRailItem {
  const income = transaction.direction === "income";
  const accent = transactionDirectionColor(transaction.direction);
  return {
    id: String(transaction.id),
    timeLabel: income ? "Inflow" : "Outflow",
    title: transaction.payee || transaction.name || "Unknown",
    subtitle: transaction.category || "Uncategorized",
    meta: transaction.account || "Transaction",
    selected: billMatchesItemId(transaction, selectedItemId),
    onClick: onSelectItem ? () => onSelectItem(String(transaction.id)) : undefined,
    dotColor: accent,
    trailing: (
      <span style={{ color: accent, fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {income ? "+" : "−"}{formatAmount(transaction.amount || 0)}
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
}: BillDetailProps) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const sourceErrors = Array.isArray(data?.errors) ? data.errors : [];
  const state = getDayState(items);
  const [showCompleted, setShowCompleted] = useState(state.activeCount === 0 && state.completedCount > 0);
  const allItems = state.items;
  const selectedBill = allItems.find((bill) => billMatchesItemId(bill, selectedItemId)) || null;
  const compactDetail = state.totalCount >= 4;
  const selectedTransaction = selectedBill?.type === "transaction" ? selectedBill : null;
  const selectedSchedule = selectedTransaction ? null : selectedBill;
  const selectedScheduleUrl = selectedSchedule ? getScheduleUrl(selectedSchedule, actualBudgetUrl) : null;
  const selectedPayUrl = selectedSchedule ? payUrlForBill(selectedSchedule, data?.payLinksByScheduleId) : null;
  const summary = [
    `${state.activeCount} unpaid`,
    state.completedCount ? `${state.completedCount} paid` : null,
    state.transactionCount
      ? `${state.transactionCount} transaction${state.transactionCount === 1 ? "" : "s"}`
      : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  return (
    <Timeline
      eyebrow="Billing ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay, selectedDateKey)}
      summary={summary}
      accent="var(--sp-green)"
      headerContent={selectedTransaction ? (
        <TransactionSelectedCard transaction={selectedTransaction} compact={compactDetail} />
      ) : selectedSchedule ? (
        <BillSelectedCard
          bill={selectedSchedule}
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
      actionContent={(
        <SourceWarning
          errors={sourceErrors}
          transactionsTruncated={!!data?.transactionsTruncated}
        />
      )}
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
        {
          id: "transaction-inflows",
          label: "Inflows",
          items: state.incomeItems.map((transaction) => toTransactionRailItem(transaction, selectedItemId, onSelectItem)),
        },
        {
          id: "transaction-outflows",
          label: "Outflows",
          items: state.expenseItems.map((transaction) => toTransactionRailItem(transaction, selectedItemId, onSelectItem)),
        },
      ]}
    />
  );
}

function BillsFloatingDetail({
  items,
  data,
  selectedItemId,
}: BillFloatingDetailProps) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const state = getDayState(items);
  const allItems = state.items;
  const selectedBill = allItems.find((bill) => billMatchesItemId(bill, selectedItemId)) || null;
  const compactDetail = state.totalCount >= 4;
  const selectedTransaction = selectedBill?.type === "transaction" ? selectedBill : null;
  const selectedScheduleUrl = selectedBill && !selectedTransaction ? getScheduleUrl(selectedBill, actualBudgetUrl) : null;
  const selectedPayUrl = selectedBill && !selectedTransaction ? payUrlForBill(selectedBill, data?.payLinksByScheduleId) : null;

  if (!selectedBill) return null;

  if (selectedTransaction) {
    return <TransactionSelectedCard transaction={selectedTransaction} compact={compactDetail} />;
  }

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

export function renderBillsDetail(props: BillDetailProps) {
  const state = getDayState(props.items);
  return <BillsDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}

export function renderBillsFloatingDetail(props: BillFloatingDetailProps) {
  const state = getDayState(props.items);
  return <BillsFloatingDetail key={`${props.selectedItemId}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
