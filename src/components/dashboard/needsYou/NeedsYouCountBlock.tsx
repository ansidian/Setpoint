import { StatusDot } from "../../shared/StatusDot";

export interface NeedsYouBreakdownSegment { text: string; color: string }

// The leading count block, shown only when something needs attention. The
// all-clear state is owned by NeedsYouBand (a centered, label-less treatment),
// so this block always renders the count + breakdown.
export function NeedsYouCountBlock({ countN, countColor, breakdown = [], isMobile = false }: {
  countN: number;
  countColor: string;
  breakdown?: NeedsYouBreakdownSegment[];
  isMobile?: boolean;
}) {
  return (
    <div style={isMobile
      ? { width: "100%", flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.07)" }
      : { width: 190, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingRight: 18, borderRight: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--sp-text)" }}>
        <StatusDot tone="var(--sp-rose)" state="solid" />
        Needs you now
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 10 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 28, fontWeight: 600, lineHeight: 1.12, color: countColor, fontVariantNumeric: "tabular-nums" }}>{countN}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary, #a6adc8)", lineHeight: 1.4 }}>items want<br />your call</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11, lineHeight: 1.5 }}>
        {breakdown.map((seg, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span style={{ color: "rgba(205,214,244,0.3)", fontWeight: 400 }}>·</span>}
            <span style={{ color: seg.color, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{seg.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
