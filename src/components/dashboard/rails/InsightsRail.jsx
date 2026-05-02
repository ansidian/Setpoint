import { useEffect, useReducer, useState } from "react";
import { resolveInsight } from "../../../lib/insight-resolver";
import { Icon } from "@/lib/icons.jsx";
import { SectionHeader } from "./railPrimitives.jsx";

const SIGNAL_GRADIENT = "linear-gradient(120deg, #c88fa0 0%, #c89b85 25%, #8fb8c8 55%, #a89bc4 80%, #c88fa0 100%)";

export default function InsightsRail({ accent, insights = [], onJump, isMobile = false, maxItems = 5 }) {
  const [, forceTick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const visibleInsights = insights.slice(0, maxItems);

  return (
    <div data-sect="insights">
      <SectionHeader
        title="Signals"
        subtitle={isMobile ? "One quick pattern worth surfacing" : "Patterns across your day"}
        isMobile={isMobile}
      />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: isMobile ? 6 : 8 }}>
        {visibleInsights.map((ins, i) => (
          <InsightRow
            key={ins.id || i}
            insight={ins}
            accent={accent}
            onJump={onJump}
            now={now}
            featured={!isMobile && i === 0}
            isMobile={isMobile}
          />
        ))}
        {visibleInsights.length === 0 && (
          <div
            style={{
              padding: isMobile ? "14px 12px" : "16px 14px", borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              fontSize: isMobile ? 11 : 11.5, color: "rgba(205,214,244,0.5)", lineHeight: 1.5,
            }}
          >
            No signals yet. Run a fresh briefing to surface patterns across your day.
          </div>
        )}
      </div>
    </div>
  );
}

function InsightRow({ insight, accent, onJump, now, featured, isMobile = false }) {
  const [hovered, setHovered] = useState(false);
  const text = resolveInsight(insight, now);
  if (!text) return null;

  const handlers = {
    role: "button",
    tabIndex: 0,
    onClick: () => onJump?.({ kind: "insight", insight }),
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") onJump?.({ kind: "insight", insight }); },
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  const innerBg = hovered ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)";

  if (featured) {
    const featuredInner = `linear-gradient(${innerBg}, ${innerBg}), #121220`;
    return (
      <div
        {...handlers}
        style={{
          borderRadius: 10,
          background: SIGNAL_GRADIENT,
          backgroundSize: "240% 100%",
          animation: hovered ? "aiGradientShift 7s ease-in-out infinite" : "none",
          padding: 1,
          cursor: "pointer", position: "relative",
        }}
      >
        <div
          style={{
            padding: "12px 14px", borderRadius: 9,
            background: featuredInner,
            display: "flex", alignItems: "flex-start", gap: 10,
            transition: "background 130ms",
          }}
        >
          <InsightRowContent accent={accent} insight={insight} text={text} />
        </div>
      </div>
    );
  }

  return (
    <div
      {...handlers}
      style={{
        padding: isMobile ? "10px 12px" : "12px 14px", borderRadius: 10,
        background: innerBg,
        border: hovered ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.05)",
        cursor: "pointer", position: "relative",
        transition: "background 130ms, border-color 130ms",
        display: "flex", alignItems: "flex-start", gap: 10,
      }}
    >
      <InsightRowContent accent={accent} insight={insight} text={text} isMobile={isMobile} />
    </div>
  );
}

function InsightRowContent({ accent, insight, text, isMobile = false }) {
  return (
    <>
      <div
        style={{
          width: isMobile ? 20 : 22, height: isMobile ? 20 : 22, borderRadius: 6, flexShrink: 0,
          background: `${accent}14`, display: "grid", placeItems: "center",
          marginTop: 1,
        }}
      >
        <Icon name={insight.icon || "Sparkles"} size={isMobile ? 10 : 11} color={accent} />
      </div>
      <div
        style={{
          fontSize: isMobile ? 11.5 : 12, color: "rgba(205,214,244,0.85)",
          lineHeight: 1.5, textWrap: "pretty", minWidth: 0,
        }}
      >
        {text}
      </div>
    </>
  );
}
