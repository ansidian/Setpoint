import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import {
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import { formatAmount, formatDate, daysLabel, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import type { FinanceItem } from "./billsModel";

const FactTile = RailFactTile as ComponentType<{ label: ReactNode; value: ReactNode; color?: string }>;
const MetaChip = RailMetaChip as ComponentType<{ children?: ReactNode; tone?: string; color?: string }>;
const formatDaysLabel = daysLabel as (days: number | null) => string;

export default function BillSelectedCard({ bill, compact = false, actions }: {
  bill: FinanceItem;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  const days = daysUntil(bill.next_date);
  const urgency = urgencyColor(days);
  const statusLabel = bill.paid ? "Cleared" : "Scheduled";

  return (
    <Motion.div layout transition={layoutTransition} style={{ flexShrink: 0 }}>
      <RailHeroCard accent="var(--sp-green)" actions={actions}>
        <Motion.div
          layout
          transition={layoutTransition}
          style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: bill.paid ? "var(--sp-green)" : urgency.accent,
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
          <MetaChip tone="accent" color={bill.paid ? "#a6e3a1" : urgency.accent}>
            {bill.paid ? "Paid" : formatDaysLabel(days)}
          </MetaChip>
        </Motion.div>

        <Motion.div
          layout
          transition={layoutTransition}
          style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}
        >
          <Motion.div
            className="calendar-detail-title"
            layout="position"
            transition={layoutTransition}
            style={{
              fontSize: compact ? 20 : 24,
              lineHeight: 1.08,
              letterSpacing: -0.4,
              color: "#fff",
              fontWeight: 500,
            }}
          >
            {bill.name}
          </Motion.div>
          {bill.payee && bill.payee !== bill.name ? (
            <Motion.div
              layout="position"
              transition={layoutTransition}
              style={{
                fontSize: compact ? 11 : 12,
                lineHeight: 1.4,
                color: "rgba(205,214,244,0.56)",
              }}
            >
              {bill.payee}
            </Motion.div>
          ) : null}
        </Motion.div>

        <Motion.div
          layout="position"
          transition={layoutTransition}
          style={{
            fontSize: compact ? 26 : 32,
            lineHeight: 1,
            letterSpacing: -0.8,
            fontWeight: 600,
            color: bill.paid ? "var(--sp-green)" : urgency.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatAmount(bill.amount || 0)}
        </Motion.div>

        <Motion.div
          layout
          transition={layoutTransition}
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
        >
          <FactTile
            label={bill.paid ? "Scheduled" : "Due"}
            value={bill.next_date
              ? bill.paid
                ? formatDate(bill.next_date)
                : `${formatDaysLabel(days)} · ${formatDate(bill.next_date)}`
              : "No date"}
            color={bill.paid ? "var(--sp-green)" : urgency.text}
          />
          <FactTile label="Status" value={statusLabel} />
        </Motion.div>
      </RailHeroCard>
    </Motion.div>
  );
}
