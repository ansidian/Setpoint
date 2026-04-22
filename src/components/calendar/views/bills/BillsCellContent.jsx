/* eslint-disable react-refresh/only-export-components */
import { Check } from "lucide-react";
import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { getDayState, MAX_PILLS } from "./billsModel.js";

function CompletedCount({ count }) {
  if (!count) return null;
  return (
    <div
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        color: "rgba(166,227,161,0.55)",
        letterSpacing: 0.2,
      }}
    >
      <Check size={10} />
      <span>{count}</span>
    </div>
  );
}

function CompletedPreview({ label, amount, count }) {
  return (
    <div
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "rgba(166,227,161,0.72)",
          boxShadow: "0 0 4px rgba(166,227,161,0.22)",
        }}
      />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "rgba(205,214,244,0.42)",
          fontSize: 11,
          textDecoration: "line-through",
          textDecorationColor: "rgba(205,214,244,0.2)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flexShrink: 0,
          color: "rgba(166,227,161,0.58)",
          fontSize: 10.5,
          fontWeight: 500,
        }}
      >
        {amount}
      </span>
      {count > 1 && <CompletedCount count={count} />}
    </div>
  );
}

export function renderBillsCellContents({ items, hasOverdue: overdue }) {
  const state = getDayState(items);
  const visibleItems = state.activeItems.slice(0, MAX_PILLS);
  const hiddenActiveCount = Math.max(0, state.activeCount - visibleItems.length);
  const completedPreview = state.activeCount === 0 ? state.completedItems[0] : null;

  return (
    <>
      {visibleItems.map((bill) => {
        const days = daysUntil(bill.next_date);
        const urgency = urgencyColor(days);
        const isTransfer = bill.type === "transfer";
        const amountColor = isTransfer
          ? "#b4befe"
          : overdue && days < 0
            ? "#f38ba8"
            : urgency.text === "rgba(205,214,244,0.5)"
              ? "#a6e3a1"
              : urgency.text;

        return (
          <div
            key={bill.id}
            style={{
              display: "flex",
              gap: 4,
              fontSize: 11,
              marginTop: 3,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                color: "rgba(205,214,244,0.45)",
              }}
            >
              {bill.name}
            </span>
            <span
              style={{
                flexShrink: 0,
                color: amountColor,
                fontWeight: 500,
              }}
            >
              {formatAmount(bill.amount).replace(".00", "")}
            </span>
          </div>
        );
      })}

      {hiddenActiveCount > 0 && (
        <div style={{ fontSize: 10, color: "rgba(203,166,218,0.6)", marginTop: 2 }}>
          +{hiddenActiveCount} more
        </div>
      )}

      {completedPreview ? (
        <CompletedPreview
          label={completedPreview.name}
          amount={formatAmount(completedPreview.amount).replace(".00", "")}
          count={state.completedCount}
        />
      ) : (
        <CompletedCount count={state.completedCount} />
      )}
    </>
  );
}
