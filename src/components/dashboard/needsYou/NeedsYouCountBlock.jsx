import { StatusDot } from "../../shared/StatusDot";

// The leading count block, shown only when something needs attention. The
// all-clear state is owned by NeedsYouBand (a centered, label-less treatment),
// so this block always renders the count + breakdown.
export function NeedsYouCountBlock({ countN, countColor, breakdown = [] }) {
  return (
    <div style={{ width: 190, flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", paddingRight: 18, borderRight: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "var(--sp-rose)" }}>
        <StatusDot tone="var(--sp-rose)" state="glow" />
        Needs you now
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 5 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 46, fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1, color: countColor, fontVariantNumeric: "tabular-nums" }}>{countN}</span>
        <span style={{ fontSize: 12.5, color: "rgba(205,214,244,0.6)", lineHeight: 1.3 }}>items want<br />your call</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 11, fontSize: 11.5 }}>
        {breakdown.map((seg, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span style={{ color: "rgba(205,214,244,0.3)", fontWeight: 400 }}>·</span>}
            <span style={{ color: seg.color, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{seg.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
