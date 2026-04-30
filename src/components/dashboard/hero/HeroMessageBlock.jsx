import { Activity } from "lucide-react";
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
  const greetingText = /[.!?]$/.test(greet.text) ? greet.text : `${greet.text}.`;

  return (
    <div style={{ minWidth: 0, maxWidth: isMobile ? "100%" : 700 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: isMobile ? 2 : 2.6,
          textTransform: "uppercase",
          color: "rgba(205,214,244,0.55)",
          marginBottom: isMobile ? 6 : 8,
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
          margin: "0 0 8px",
          fontSize: isMobile ? 22 : compact ? 32 : 36,
          fontWeight: 300,
          letterSpacing: 0,
          lineHeight: isMobile ? 1.08 : 1.02,
          color: "#cdd6f4",
          textWrap: "balance",
          maxWidth: isMobile ? "100%" : 480,
        }}
      >
        <span style={{ display: "block" }}>{greetingText}</span>
      </h1>

      {!isMobile && stateOfDay.headline && (
        <div
          style={{
            maxWidth: isMobile ? "100%" : 660,
            padding: isMobile ? "9px 11px" : "10px 12px",
            border: `1px solid ${accent}24`,
            borderRadius: 12,
            background: `${accent}0a`,
            marginBottom: isMobile ? 10 : 8,
          }}
        >
          <div
            className="ea-display"
            style={{
              fontSize: isMobile ? 17 : compact ? 21 : 23,
              lineHeight: isMobile ? 1.16 : 1.12,
              letterSpacing: 0,
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
            margin: "0 0 4px",
            maxWidth: isMobile ? "100%" : 560,
            fontSize: isMobile ? 12.5 : compact ? 13.5 : 14,
            lineHeight: isMobile ? 1.48 : 1.5,
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
          marginTop: isMobile ? 2 : 4,
          fontSize: isMobile ? 9 : 10,
          letterSpacing: 0.3,
          color: "rgba(205,214,244,0.4)",
        }}
      >
        <Activity size={9} color={accent} />
        Briefing · {(briefing?.aiInsights || []).length} signals
      </div>
    </div>
  );
}
