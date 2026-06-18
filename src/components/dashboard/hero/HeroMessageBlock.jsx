import { pacificClock, pacificDate } from "../../../lib/shell-helpers";

export default function HeroMessageBlock({
  accent,
  compact,
  greet,
  isMobile = false,
  now,
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
          color: "var(--color-text-faint)",
          marginBottom: isMobile ? 5 : 6,
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
          margin: 0,
          fontSize: isMobile ? 22 : compact ? 26 : 28,
          fontWeight: 300,
          letterSpacing: 0,
          lineHeight: isMobile ? 1.08 : 1.04,
          color: "#cdd6f4",
          textWrap: "balance",
          maxWidth: isMobile ? "100%" : 360,
        }}
      >
        <span style={{ display: "block" }}>{greetingText}</span>
      </h1>
    </div>
  );
}
