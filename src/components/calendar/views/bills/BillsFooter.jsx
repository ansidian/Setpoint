import { formatAmount } from "../../../../lib/bill-utils";

export function renderBillsFooter({ viewYear, viewMonth, computed }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 2.2,
          textTransform: "uppercase",
          color: "rgba(205,214,244,0.5)",
        }}
      >
        {new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" })} total
      </span>
      <span
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.3,
        }}
      >
        {formatAmount(computed?.monthTotal || 0)}
      </span>
    </div>
  );
}
