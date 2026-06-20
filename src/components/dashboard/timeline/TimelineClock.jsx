const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function TimelineClock({ now }) {
  return (
    <span
      data-testid="timeline-clock"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500,
        color: "rgba(205,214,244,0.7)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: 99, background: "var(--sp-green)", boxShadow: "0 0 6px var(--sp-green)" }}
      />
      {CLOCK_FORMATTER.format(new Date(now))}
    </span>
  );
}
