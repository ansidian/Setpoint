// A status pill. Tone is any CSS color string the caller supplies — a hex
// (#f38ba8) or a token reference (var(--sp-rose)). The chip color-mixes the
// tone for its fill and uses the raw tone for text, so it stays correct
// whether or not the --sp-* tokens are present. Mirrors the mockup pill()
// helper (Dashboard.dc.html:312-319): the canonical band/peek/coming-up chip.
export function StatusChip({ label, tone, glyph = null, compact = false }) {
  return (
    <span
      data-testid="status-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        flexShrink: 1,
        overflow: "hidden",
        gap: glyph ? 4 : 0,
        fontSize: compact ? 9.5 : 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 99,
        background: `color-mix(in srgb, ${tone} 15%, transparent)`,
        color: tone,
        letterSpacing: 0.2,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {glyph}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}
