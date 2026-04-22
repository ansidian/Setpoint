/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import Tooltip from "../../../shared/Tooltip";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import { formatAmount, daysLabel, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { formatFullDate, getDayState } from "./billsModel.js";

function toBillRailItem(bill, actualBudgetUrl) {
  const days = daysUntil(bill.next_date);
  const scheduleUrl = actualBudgetUrl
    ? `${actualBudgetUrl.replace(/\/+$/, "")}/schedules?highlight=${bill.id}`
    : null;

  return {
    id: String(bill.id),
    timeLabel: bill.paid ? "Paid" : daysLabel(days),
    title: bill.name,
    subtitle: bill.payee && bill.payee !== bill.name ? bill.payee : null,
    meta: bill.type === "transfer" ? "Transfer" : null,
    complete: bill.paid,
    dotColor: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? "#b4befe" : urgencyColor(days).accent,
    trailing: (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: bill.paid ? "#a6e3a1" : bill.type === "transfer" ? "#b4befe" : urgencyColor(days).text,
            whiteSpace: "nowrap",
          }}
        >
          {formatAmount(bill.amount)}
        </span>
        {scheduleUrl && (
          <Tooltip text="Edit Schedule in Actual">
            <a
              href={scheduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              style={{
                color: "rgba(203,166,218,0.5)",
                display: "inline-flex",
                alignItems: "center",
                padding: 4,
                borderRadius: 4,
                transition: "color 150ms",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "#cba6da";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "rgba(203,166,218,0.5)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M6 3H3.5A1.5 1.5 0 002 4.5v8A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M9 2h5v5M14 2L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </Tooltip>
        )}
      </div>
    ),
  };
}

function BillsDetail({ selectedDay, viewYear, viewMonth, items, data }) {
  const actualBudgetUrl = data?.actualBudgetUrl;
  const state = getDayState(items);
  const [showCompleted, setShowCompleted] = useState(state.activeCount === 0 && state.completedCount > 0);
  const summary = [
    `${state.activeCount} unpaid`,
    state.completedCount ? `${state.completedCount} paid` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  return (
    <TimelineDetailRail
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={summary}
      sections={[
        {
          id: "active-bills",
          label: "Unpaid",
          items: state.activeItems.map((bill) => toBillRailItem(bill, actualBudgetUrl)),
        },
        {
          id: "completed-bills",
          label: "Paid",
          collapsible: true,
          expanded: showCompleted,
          onToggle: () => setShowCompleted((prev) => !prev),
          itemCount: state.completedCount,
          items: state.completedItems.map((bill) => toBillRailItem(bill, actualBudgetUrl)),
        },
      ]}
    />
  );
}

export function renderBillsDetail(props) {
  const state = getDayState(props.items);
  return <BillsDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
