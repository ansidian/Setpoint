import { pacificClock } from "../../../lib/redesign-helpers";

export default function TimelineNowMarker({
  accent,
  isMobile = false,
  now,
  spineLeft,
  top,
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          ...(isMobile
            ? { left: spineLeft + 10 }
            : { left: 0 }),
          top: 0,
          transform: "translateY(-50%)",
          fontSize: isMobile ? 9 : 9.5,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: accent,
          padding: isMobile ? "2px 7px" : "2px 8px",
          background: `${accent}15`,
          borderRadius: 99,
          border: `1px solid ${accent}30`,
          whiteSpace: "nowrap",
        }}
      >
        Now · {pacificClock(new Date(now))}
      </div>
      <div
        style={{
          position: "absolute",
          left: spineLeft - 6,
          top: 0,
          transform: "translateY(-50%)",
          width: 13,
          height: 13,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 99,
            background: accent,
            boxShadow: `0 0 12px ${accent}, 0 0 0 3px ${accent}25`,
            animation: "dashPulse 2s ease-in-out infinite",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: spineLeft + 8,
          right: 0,
          top: 0,
          height: 1,
          background: `linear-gradient(90deg, ${accent}60, transparent)`,
        }}
      />
    </div>
  );
}
