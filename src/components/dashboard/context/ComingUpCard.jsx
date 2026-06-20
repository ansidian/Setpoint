import { CreditCard, CalendarClock } from "lucide-react";
import { SectionHeader, EmptyRow } from "../rails/railPrimitives.jsx";
import { StatusChip } from "../../shared/StatusChip.jsx";

// Map buildComingUp short chip keys to the canonical token strings StatusChip expects.
const CHIP_TONE = { rose: "var(--sp-rose)", cream: "var(--sp-cream)", muted: "rgba(205,214,244,0.55)" };

export default function ComingUpCard({ items = [], onJump }) {
  return (
    <div
      data-testid="context-coming-up"
      style={{
        flex: "none", padding: "15px 17px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.004))",
        border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14,
      }}
    >
      <SectionHeader title="Coming up" right={<div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)" }}>Next 7 days</div>} />
      <div style={{ marginTop: 6 }}>
        {items.map((row, i) => (
          <div
            key={row.id}
            role="button"
            tabIndex={0}
            onClick={() => onJump?.(row)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onJump?.(row); }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "9px 0",
              borderBottom: i === items.length - 1 ? "none" : "1px solid rgba(255,255,255,0.04)",
              cursor: "pointer", transition: "background 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
              {row.kind === "bill" && <CreditCard size={13} color="rgba(205,214,244,0.45)" aria-hidden />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "rgba(205,214,244,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
                <div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{row.meta}</div>
              </div>
            </div>
            <StatusChip label={row.chipLabel} tone={CHIP_TONE[row.chipTone] || CHIP_TONE.muted} />
          </div>
        ))}
        {items.length === 0 && <EmptyRow icon={CalendarClock} label="Nothing in the next 7 days" />}
      </div>
    </div>
  );
}
