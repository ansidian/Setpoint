export function railStaticStyle() {
  return {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  };
}

export function railContentStyle({ compact = false } = {}) {
  return {
    boxSizing: "border-box",
    padding: compact ? "18px 20px" : "20px 22px",
    display: "flex",
    flexDirection: "column",
    gap: compact ? 12 : 14,
    minHeight: "100%",
  };
}

export function heroCardStyle(accent) {
  return {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
    background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 18%, transparent), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    flexShrink: 0,
  };
}
