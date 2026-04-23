import { daysUntil, formatAmount, urgencyColor } from "../../../../lib/bill-utils";
import { RailFactTile, RailHeroCard, RailMetaChip } from "../../DetailRailPrimitives.jsx";

function clampStyle(lines = 2) {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

export default function BillSupportCard({ bill, compact = false }) {
  const days = daysUntil(bill?.next_date);
  const urgency = urgencyColor(days);
  const statusColor = bill?.paid ? "#a6e3a1" : urgency.accent;

  return (
    <div data-testid="calendar-selected-bill-card">
      <RailHeroCard accent="#a6e3a1" compact={compact}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.56)",
            }}
          >
            Selected bill
          </div>
          <RailMetaChip tone="accent" color={statusColor} compact={compact}>
            {bill?.paid ? "Paid" : days === 0 ? "Due today" : days < 0 ? "Overdue" : `In ${days}d`}
          </RailMetaChip>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
          <div style={{ ...clampStyle(2), fontSize: compact ? 20 : 24, lineHeight: 1.06, letterSpacing: compact ? -0.34 : -0.44, color: "#fff", fontWeight: 500 }}>
            {bill?.name || "Unnamed bill"}
          </div>
          <div style={{ ...clampStyle(2), fontSize: compact ? 11 : 12.5, lineHeight: 1.35, color: "rgba(205,214,244,0.58)" }}>
            {bill?.payee && bill.payee !== bill.name ? bill.payee : "Scheduled payment"}
          </div>
        </div>

        <div style={{ fontSize: compact ? 24 : 30, lineHeight: 1, letterSpacing: compact ? -0.48 : -0.7, fontWeight: 600, color: bill?.paid ? "#a6e3a1" : urgency.text }}>
          {formatAmount(bill?.amount || 0)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: compact ? 6 : 8 }}>
          <RailFactTile label="Due" value={bill?.next_date || "No date"} color={bill?.paid ? "#a6e3a1" : urgency.text} compact={compact} />
          <RailFactTile label="Status" value={bill?.paid ? "Cleared" : bill?.type === "transfer" ? "Transfer" : "Scheduled"} compact={compact} />
        </div>
      </RailHeroCard>
    </div>
  );
}
