import { Sparkles } from "lucide-react";
import { LANE } from "../../lib/redesign-helpers";

export default function DigestStrip({ accent, counts, liveCount, liveLoading = false, summary, onJumpLane }) {
  const items = [
    { key: "action", count: counts.action, verb: "need you", ...LANE.action },
    { key: "fyi",    count: counts.fyi,    verb: "for your info", ...LANE.fyi },
    { key: "noise",  count: counts.noise,  verb: "filtered", ...LANE.noise },
  ];
  return (
    <div
      style={{
        margin: "14px 18px 0", padding: "14px 18px",
        borderRadius: 12,
        background: `linear-gradient(135deg, ${accent}14, rgba(137,220,235,0.04))`,
        border: `1px solid ${accent}38`,
        display: "grid",
        gridTemplateColumns: "minmax(260px, 1.25fr) auto minmax(196px, 0.9fr)",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          paddingRight: 22, borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Sparkles size={14} color={accent} />
        <div>
          <div
            style={{
              fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
              color: accent, fontWeight: 700,
            }}
          >
            Briefing snapshot
          </div>
          {summary && (
            <div
              className="ea-display"
              style={{
                fontSize: 12, color: "rgba(205,214,244,0.9)",
                marginTop: 4, fontStyle: "italic",
              }}
            >
              {summary}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          minWidth: 0,
        }}
      >
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onJumpLane(it.key)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10, padding: "2px 6px",
              borderRadius: 8, fontFamily: "inherit",
            }}
          >
            <span style={{ width: 3, height: 26, borderRadius: 2, background: it.color, opacity: 0.8 }} />
            <div style={{ textAlign: "left" }}>
              <div
                style={{
                  fontSize: 18, fontWeight: 500, color: "#fff", lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {it.count}
              </div>
              <div
                style={{
                  fontSize: 10, color: it.color, letterSpacing: 0.6,
                  textTransform: "uppercase", fontWeight: 600, marginTop: 3,
                }}
              >
                {it.verb}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div
        data-testid="digest-live-slot"
        style={{
          minHeight: 48,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "flex-end",
        }}
      >
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 10px 6px 8px", borderRadius: 8,
            background: liveCount > 0 || liveLoading ? "rgba(137,180,250,0.08)" : "rgba(255,255,255,0.02)",
            border: liveCount > 0 || liveLoading ? "1px dashed rgba(137,180,250,0.28)" : "1px dashed rgba(255,255,255,0.08)",
            opacity: liveCount > 0 || liveLoading ? 1 : 0.52,
            minWidth: 184,
          }}
        >
          <span
            style={{
              position: "relative", display: "inline-flex",
              alignItems: "center", justifyContent: "center",
              width: 10, height: 10,
            }}
            >
              <span
                style={{
                  position: "absolute", inset: 0, borderRadius: 999,
                  background: liveCount > 0 || liveLoading ? "#89b4fa" : "rgba(205,214,244,0.3)",
                  opacity: 0.3,
                  animation: liveCount > 0 || liveLoading ? "livepulse 2s ease-out infinite" : "none",
              }}
            />
            <span
              style={{
                width: 5, height: 5, borderRadius: 999, background: liveCount > 0 || liveLoading ? "#89b4fa" : "rgba(205,214,244,0.45)",
                boxShadow: liveCount > 0 || liveLoading ? "0 0 6px #89b4fa" : "none",
              }}
            />
          </span>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase",
                color: liveCount > 0 || liveLoading ? "#89b4fa" : "rgba(205,214,244,0.55)", fontWeight: 700,
              }}
            >
              {liveLoading ? "Live · checking" : liveCount > 0 ? "Live · untriaged" : "Live · quiet"}
            </div>
            <div style={{ fontSize: 11, color: "rgba(205,214,244,0.85)", marginTop: 2 }}>
              {liveLoading ? (
                "Retrieving live mail"
              ) : liveCount > 0 ? (
                <>
                  <span
                    style={{
                      fontWeight: 600, color: "#fff",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {liveCount}
                  </span>{" "}
                  new since briefing
                </>
              ) : (
                "No new live mail"
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
