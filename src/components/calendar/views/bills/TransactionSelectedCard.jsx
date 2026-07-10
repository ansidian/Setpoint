import { motion as Motion } from "motion/react";
import { RailFactTile, RailHeroCard, RailMetaChip } from "../../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../../detailRailMotion.js";
import { formatAmount, formatDate } from "../../../../lib/bill-utils";
import { transactionDirectionColor } from "./financeSourceColors.js";

export default function TransactionSelectedCard({ transaction, compact = false }) {
  const motion = useDetailRailMotion();
  if (!transaction) return null;

  const income = transaction.direction === "income";
  const accent = transactionDirectionColor(transaction.direction);
  const directionLabel = income ? "Inflow" : "Outflow";

  return (
    <Motion.div layout transition={motion.layout} style={{ flexShrink: 0 }}>
      <RailHeroCard accent={accent} compact={compact}>
        <Motion.div
          layout
          transition={motion.layout}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
        >
          <span style={{ color: "rgba(205,214,244,0.66)", fontSize: 10, fontWeight: 700 }}>
            Actual transaction
          </span>
          <RailMetaChip tone="accent" color={accent}>{directionLabel}</RailMetaChip>
        </Motion.div>

        <Motion.div
          layout="position"
          transition={motion.layout}
          style={{ color: "#fff", fontSize: compact ? 20 : 24, fontWeight: 500, lineHeight: 1.08 }}
        >
          {transaction.payee || transaction.name || "Unknown"}
        </Motion.div>

        <Motion.div
          layout="position"
          transition={motion.layout}
          style={{ color: accent, fontSize: compact ? 26 : 32, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
        >
          {income ? "+" : "−"}{formatAmount(transaction.amount)}
        </Motion.div>

        <Motion.div
          layout
          transition={motion.layout}
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
        >
          <RailFactTile label="Date" value={transaction.date ? formatDate(transaction.date) : "No date"} />
          <RailFactTile label="Direction" value={directionLabel} color={accent} />
          <RailFactTile label="Category" value={transaction.category || "Uncategorized"} />
          <RailFactTile label="Account" value={transaction.account || "Unknown"} />
        </Motion.div>

        {transaction.notes ? (
          <Motion.div
            layout="position"
            transition={motion.layout}
            style={{
              padding: "8px 10px",
              border: "1px solid rgba(255,255,255,0.055)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
              color: "rgba(205,214,244,0.72)",
              fontSize: 11,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {transaction.notes}
          </Motion.div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}
