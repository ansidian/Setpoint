export default function HeroCalloutCard({
  accent,
  icon,
  isMobile = false,
  kind,
  lead,
  onJump,
  sub,
  title,
  urgency,
}) {
  const Icon = icon;
  const colors = {
    high: { bar: "#f38ba8", dot: "#f38ba8" },
    medium: { bar: "#f9e2af", dot: "#f9e2af" },
    low: { bar: accent, dot: accent },
  };
  const uc = colors[urgency] || colors.low;
  const kindLabel = { event: "Next up", deadline: "Deadline", bill: "Payment" }[kind] || "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onJump?.(e.currentTarget); }}
      style={{
        padding: isMobile ? "12px 14px" : "12px 16px 14px",
        borderRadius: isMobile ? 14 : 16,
        background: isMobile
          ? "rgba(255,255,255,0.03)"
          : "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "transform 220ms ease, background 150ms ease, border-color 150ms ease",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isMobile
          ? "rgba(255,255,255,0.03)"
          : "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = `2px solid ${accent}`;
        e.currentTarget.style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = "none";
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: isMobile ? 0 : 12,
          bottom: isMobile ? 0 : 12,
          width: 2,
          background: uc.bar,
          borderRadius: 9999,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <div
          style={{
            width: isMobile ? 20 : 22,
            height: isMobile ? 20 : 22,
            borderRadius: 6,
            background: isMobile ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.03)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={isMobile ? 10 : 11} color={uc.dot} />
        </div>
        <div
          style={{
            fontSize: isMobile ? 9 : 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.45)",
          }}
        >
          {kindLabel}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: isMobile ? 10 : 10.5,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: uc.dot,
            whiteSpace: "nowrap",
            marginLeft: "auto",
          }}
        >
          {lead}
        </div>
      </div>

      <div
        style={{
          fontSize: isMobile ? 13 : 14,
          fontWeight: 500,
          color: "#cdd6f4",
          lineHeight: 1.35,
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          paddingRight: isMobile ? 0 : 8,
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontSize: isMobile ? 11 : 11.5,
            color: "rgba(205,214,244,0.55)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingRight: isMobile ? 0 : 8,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
