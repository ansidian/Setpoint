import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { RailFactTile, RailHeroCard, RailMetaChip } from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import { formatAmount, formatDate } from "../../../../lib/bill-utils";
import { transactionDirectionColor } from "./financeSourceColors.ts";
import type { FinanceItem } from "./billsModel";

const FactTile = RailFactTile as ComponentType<{ label: ReactNode; value: ReactNode; color?: string }>;
const MetaChip = RailMetaChip as ComponentType<{ children?: ReactNode; tone?: string; color?: string }>;

export default function TransactionSelectedCard({ transaction, compact = false }: { transaction?: FinanceItem | null; compact?: boolean }) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  if (!transaction) return null;

  const income = transaction.direction === "income";
  const accent = transactionDirectionColor(transaction.direction);
  const directionLabel = income ? "Inflow" : "Outflow";

  return (
    <Motion.div layout transition={layoutTransition} style={{ flexShrink: 0 }}>
      <RailHeroCard accent={accent} compact={compact} actions={null}>
        <Motion.div
          layout
          transition={layoutTransition}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
        >
          <span style={{ color: "rgba(205,214,244,0.66)", fontSize: 10, fontWeight: 700 }}>
            Actual transaction
          </span>
          <MetaChip tone="accent" color={accent}>{directionLabel}</MetaChip>
        </Motion.div>

        <Motion.div
          className="calendar-detail-title"
          layout="position"
          transition={layoutTransition}
          style={{ color: "#fff", fontSize: compact ? 20 : 24, fontWeight: 500, lineHeight: 1.08 }}
        >
          {transaction.payee || transaction.name || "Unknown"}
        </Motion.div>

        <Motion.div
          layout="position"
          transition={layoutTransition}
          style={{ color: accent, fontSize: compact ? 26 : 32, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
        >
          {income ? "+" : "−"}{formatAmount(transaction.amount || 0)}
        </Motion.div>

        <Motion.div
          layout
          transition={layoutTransition}
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
        >
          <FactTile label="Date" value={transaction.date ? formatDate(transaction.date) : "No date"} />
          <FactTile label="Direction" value={directionLabel} color={accent} />
          <FactTile label="Category" value={transaction.category || "Uncategorized"} />
          <FactTile label="Account" value={transaction.account || "Unknown"} />
        </Motion.div>

        {transaction.notes ? (
          <Motion.div
            layout="position"
            transition={layoutTransition}
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
