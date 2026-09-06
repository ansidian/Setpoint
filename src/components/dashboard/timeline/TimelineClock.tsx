const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function TimelineClock({ now }: { now: number }) {
  return (
    <span
      data-testid="timeline-clock"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        fontSize: 11, fontWeight: 500,
        color: "var(--color-text-secondary, #a6adc8)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: 99, background: "var(--sp-green)" }}
      />
      {CLOCK_FORMATTER.format(new Date(now))}
    </span>
  );
}
