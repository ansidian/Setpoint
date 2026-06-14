// Auto-rendered breakdown card for the summarize_transactions tool result (spending or income).
// Non-interactive display-only component (ADR 0006: read-only v1).
import { memo } from "react";
import { spendingBreakdownRows, formatAlfredMoney } from "./alfredPanelModel.js";

const text = "#cdd6f4";
const muted = "#a6adc8";
const subtle = "#6c7086";

const GROUP_LABELS = { category: "BY CATEGORY", payee: "BY PAYEE", month: "BY MONTH" };

function periodLabel(period) {
  const fmt = (iso) => {
    if (!iso) return "";
    const [y, m] = String(iso).split("-");
    if (!y || !m) return "";
    return new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString("en-US", { month: "short", year: "numeric" });
  };
  const a = fmt(period?.start);
  const b = fmt(period?.end);
  if (!a && !b) return "";
  if (a === b) return a;
  return `${a} – ${b}`;
}

function AlfredTransactionBreakdown({ buckets, period, group_by, accent }) {
  const rows = spendingBreakdownRows(buckets);
  if (!rows.length) return null;
  return (
    <div style={{ background: "rgba(36,36,58,0.45)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "13px 13px 9px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: subtle }}>{GROUP_LABELS[group_by] || "BY CATEGORY"}</span>
        <span style={{ fontSize: 11, color: subtle }}>{periodLabel(period)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: r.isOther ? subtle : text }}>{r.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.isOther ? muted : text, fontVariantNumeric: "tabular-nums" }}>
                {formatAlfredMoney(r.amount)} <span style={{ color: subtle, fontWeight: 400 }}>{"·"} {r.count}</span>
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.05)" }}>
              <div
                className="alfred-bar-grow"
                style={{ width: `${r.pct}%`, height: "100%", borderRadius: 2, transformOrigin: "left", background: r.isOther ? "rgba(108,112,134,0.7)" : accent, opacity: r.isOther ? 1 : 0.85 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(AlfredTransactionBreakdown);
