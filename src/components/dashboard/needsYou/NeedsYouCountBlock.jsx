import { CheckCircle2 } from "lucide-react";
import { StatusDot } from "../../shared/StatusDot";

export function NeedsYouCountBlock({ countN, countColor, breakdown = [], empty = false }) {
  return (
    <div style={{ width: 190, flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", paddingRight: 18, borderRight: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "var(--sp-rose)" }}>
        <StatusDot tone="var(--sp-rose)" state="glow" />
        Needs you now
      </div>
      {empty ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <CheckCircle2 size={18} color="var(--sp-green)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--sp-green)" }}>All clear</span>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
