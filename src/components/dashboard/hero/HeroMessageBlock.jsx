import { Sparkles } from "lucide-react";
import { pacificClock, pacificDate } from "../../../lib/redesign-helpers";

export default function HeroMessageBlock({
  accent,
  briefing,
  compact,
  greet,
  isMobile = false,
  now,
  stateOfDay,
}) {
  return (
    <div style={{ minWidth: 0, maxWidth: isMobile ? "100%" : 700 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: isMobile ? 2 : 2.6,
          textTransform: "uppercase",
          color: "rgba(205,214,244,0.55)",
          marginBottom: isMobile ? 8 : 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
            display: "inline-block",
          }}
        />
        {pacificDate(new Date(now))} · {pacificClock(new Date(now))}
      </div>

      <h1
        className="ea-display"
        style={{
          margin: "0 0 12px",
          fontSize: isMobile ? 24 : compact ? 35 : 41,
          fontWeight: 300,
          letterSpacing: isMobile ? -0.4 : -0.95,
          lineHeight: isMobile ? 1.08 : 0.98,
          color: "#cdd6f4",
          textWrap: "balance",
          maxWidth: isMobile ? "100%" : 480,
        }}
      >
        <span style={{ display: "block" }}>{greet.text}.</span>
      </h1>

      {!isMobile && stateOfDay.headline && (
        <div
          style={{
            maxWidth: isMobile ? "100%" : 660,
            padding: isMobile ? "0 0 0 14px" : "0 0 0 18px",
            borderLeft: `2px solid ${accent}55`,
            marginBottom: isMobile ? 12 : 12,
          }}
        >
          <div
            className="ea-display"
            style={{
              fontSize: isMobile ? 18 : compact ? 23 : 26,
              lineHeight: isMobile ? 1.16 : 1.12,
              letterSpacing: isMobile ? -0.2 : -0.35,
              color: "rgba(221,226,247,0.78)",
              fontStyle: "italic",
              textWrap: "pretty",
            }}
          >
            {stateOfDay.headline}
          </div>
        </div>
      )}

      {stateOfDay.summary && (
        <p
          style={{
            margin: "0 0 6px",
            maxWidth: isMobile ? "100%" : 560,
            fontSize: isMobile ? 13 : compact ? 14 : 14.5,
            lineHeight: isMobile ? 1.55 : 1.58,
            color: "rgba(205,214,244,0.72)",
            textWrap: "pretty",
          }}
        >
          {stateOfDay.summary}
        </p>
      )}

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginTop: isMobile ? 4 : 8,
          fontSize: isMobile ? 9 : 10,
          letterSpacing: 0.3,
          color: "rgba(205,214,244,0.4)",
        }}
      >
        <Sparkles size={9} color={accent} />
        {briefing?.model || "Claude"} · {(briefing?.aiInsights || []).length} insights
      </div>
    </div>
  );
}
