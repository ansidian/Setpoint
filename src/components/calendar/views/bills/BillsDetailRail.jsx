/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  RailAction,
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../../DetailRailPrimitives.jsx";
import { formatAmount, formatDate, daysLabel, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { formatFullDate, getDayState } from "./billsModel.js";

function getScheduleUrl(bill, actualBudgetUrl) {
  return actualBudgetUrl
    ? `${actualBudgetUrl.replace(/\/+$/, "")}/schedules?highlight=${bill.id}`
    : null;
}

function BillSelectedCard({ bill, actualBudgetUrl, compact = false }) {
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);
  const scheduleUrl = getScheduleUrl(bill, actualBudgetUrl);
  const statusLabel = bill.paid ? "Cleared" : "Scheduled";

  return (
    <RailHeroCard accent="#a6e3a1">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: bill.paid ? "#a6e3a1" : urgency.accent,
              boxShadow: `0 0 0 1px ${bill.paid ? "#a6e3a122" : `${urgency.accent}22`}, 0 0 10px ${bill.paid ? "#a6e3a12b" : `${urgency.accent}2b`}`,
            }}
          />
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.56)",
            }}
          >
            {bill.type === "transfer" ? "Transfer" : "Scheduled bill"}
          </div>
        </div>
        <RailMetaChip tone="accent" color={bill.paid ? "#a6e3a1" : urgency.accent}>
          {bill.paid ? "Paid" : daysLabel(days)}
        </RailMetaChip>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
        <div
          style={{
            fontSize: compact ? 20 : 24,
            lineHeight: 1.08,
            letterSpacing: -0.4,
            color: "#fff",
            fontWeight: 500,
          }}
        >
          {bill.name}
        </div>
        {bill.payee && bill.payee !== bill.name ? (
          <div
            style={{
              fontSize: compact ? 11 : 12,
              lineHeight: 1.4,
              color: "rgba(205,214,244,0.56)",
            }}
          >
            {bill.payee}
          </div>
        ) : null}
      </div>

      <div
        style={{
          fontSize: compact ? 26 : 32,
          lineHeight: 1,
          letterSpacing: -0.8,
          fontWeight: 600,
          color: bill.paid ? "#a6e3a1" : urgency.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatAmount(bill.amount)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <RailFactTile
          label={bill.paid ? "Scheduled" : "Due"}
          value={bill.next_date
            ? bill.paid
              ? formatDate(bill.next_date)
              : `${daysLabel(days)} · ${formatDate(bill.next_date)}`
            : "No date"}
          color={bill.paid ? "#a6e3a1" : urgency.text}
        />
        <RailFactTile label="Status" value={statusLabel} />
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: compact ? 10 : 12,
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {bill.type === "transfer" ? <RailMetaChip tone="quiet">Transfer</RailMetaChip> : null}
        </div>
        {scheduleUrl ? (
          <RailAction
            icon={ExternalLink}
            label="Open in Actual"
            href={scheduleUrl}
          accent="#a6e3a1"
          tone="accent"
        />
      ) : null}
      </div>
    </RailHeroCard>
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
    selected: String(bill.id) === String(selectedBillId),
    onClick: onSelectItem ? () => onSelectItem(String(bill.id)) : undefined,
    dotColor: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? "#b4befe" : urgency.accent,
    trailing: (
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? "#b4befe" : urgency.text,
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
  viewYear,
  viewMonth,
  items,
  data,
  selectedItemId,
  onSelectItem,
  supportBandActive = false,
}) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const state = getDayState(items);
  const [showCompleted, setShowCompleted] = useState(state.activeCount === 0 && state.completedCount > 0);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedBill = allItems.find((bill) => String(bill.id) === String(selectedItemId)) || null;
  const compactDetail = state.totalCount >= 4;
  const summary = [
    `${state.activeCount} unpaid`,
    state.completedCount ? `${state.completedCount} paid` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  return (
    <TimelineDetailRail
      eyebrow="Billing ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={summary}
      accent="#a6e3a1"
      supportBandActive={supportBandActive}
      headerContent={supportBandActive ? null : selectedBill ? (
        <BillSelectedCard bill={selectedBill} actualBudgetUrl={actualBudgetUrl} compact={compactDetail} />
      ) : null}
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

export function renderBillsDetail(props) {
  const state = getDayState(props.items);
  return <BillsDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
