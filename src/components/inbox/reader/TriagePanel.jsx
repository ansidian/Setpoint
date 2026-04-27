import { Sparkles, AlertCircle } from "lucide-react";
import { LANE } from "../../../lib/redesign-helpers";

export default function TriagePanel({ email, accent }) {
  if (!email?.claude && !email?.aiSummary) return null;
  const summary = email.claude?.summary || email.aiSummary;
  const points = email.claude?.points || email.claude?.bulletPoints || [];
  const why = email.claude?.why;
  const laneKey = email._lane;
  const L = laneKey && LANE[laneKey];
  const urg = email.urgency;
  const urgColor = urg === "high" ? "#f38ba8" : urg === "medium" ? "#fab387" : "#a6adc8";

  return (
    <div
      style={{
        margin: "16px 20px 0",
        borderRadius: 12, overflow: "hidden",
        background: `linear-gradient(135deg, ${accent}10, rgba(137,220,235,0.02))`,
        border: `1px solid ${accent}38`,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 6px" }}>
        <span
          style={{
            width: 22, height: 22, borderRadius: 6,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: `${accent}24`,
          }}
        >
          <Sparkles size={11} color={accent} />
        </span>
        <span
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 2,
            textTransform: "uppercase", color: accent,
          }}
        >
          Briefing triage
        </span>
        <span style={{ flex: 1 }} />
        {L && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
              padding: "3px 7px", borderRadius: 4,
              color: L.color, background: L.soft, border: `1px solid ${L.border}`,
            }}
          >
            {L.label}
          </span>
        )}
        {urg && (
          <span
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
              padding: "3px 7px", borderRadius: 4,
              color: urgColor, background: `${urgColor}22`, border: `1px solid ${urgColor}44`,
            }}
          >
            {urg} urgency
          </span>
        )}
      </div>
      <div style={{ padding: "4px 14px 14px" }}>
        {summary && (
          <p
            className="ea-display"
            style={{
              margin: "4px 0 10px",
              fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.92)",
              fontWeight: 400,
            }}
          >
            {summary}
          </p>
        )}
        {points.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", rowGap: 4 }}>
            {points.map((p, i) => (
              <li
                key={i}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 7,
                  fontSize: 11, color: "rgba(205,214,244,0.82)", lineHeight: 1.45,
                }}
              >
                <span
                  style={{
                    marginTop: 6, width: 3, height: 3, borderRadius: 999,
                    background: accent, flexShrink: 0, opacity: 0.8,
                  }}
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
        {why && L && (
          <div
            style={{
              marginTop: 10, paddingTop: 10,
              borderTop: `1px dashed ${accent}33`,
              fontSize: 10, color: "rgba(205,214,244,0.5)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <AlertCircle size={10} color={`${accent}aa`} />
            Why this landed in{" "}
            <span style={{ color: L.color, fontWeight: 600 }}>{L.label}</span>: {why}
          </div>
        )}
      </div>
    </div>
  );
}
