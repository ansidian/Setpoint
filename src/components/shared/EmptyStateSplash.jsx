export default function EmptyStateSplash({
  icon = null,
  eyebrow = "Nothing here",
  title,
  message,
  actions = null,
  compact = false,
  minHeight = null,
  align = "center",
}) {
  const resolvedMinHeight = minHeight ?? (compact ? 220 : 320);
  const justifyContent = align === "start" ? "flex-start" : "center";

  return (
    <div
      data-testid="empty-state-splash"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent,
        minHeight: resolvedMinHeight,
        width: "100%",
        overflow: "hidden",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "radial-gradient(circle at 20% 20%, rgba(203,166,218,0.12), transparent 32%), radial-gradient(circle at 78% 30%, rgba(137,180,250,0.1), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 0.8px, transparent 0.8px)",
          backgroundSize: compact ? "20px 20px" : "24px 24px",
          opacity: 0.28,
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.25))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: compact ? -42 : -30,
          top: compact ? -52 : -18,
          width: compact ? 140 : 180,
          height: compact ? 140 : 180,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(203,166,218,0.18), transparent 70%)",
          filter: "blur(6px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: compact ? -34 : -12,
          bottom: compact ? -60 : -30,
          width: compact ? 120 : 160,
          height: compact ? 120 : 160,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(137,180,250,0.16), transparent 70%)",
          filter: "blur(6px)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: compact ? 520 : 720,
          padding: compact ? "26px 22px" : "34px 30px",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "minmax(140px, 0.78fr) minmax(220px, 1fr)",
          alignItems: "center",
          gap: compact ? 18 : 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: compact ? 96 : 140,
          }}
        >
          <div
            style={{
              position: "relative",
              width: compact ? 96 : 134,
              height: compact ? 96 : 134,
              borderRadius: compact ? 24 : 32,
              border: "1px solid rgba(255,255,255,0.09)",
              background: "linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 16px 40px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: compact ? 10 : 14,
                borderRadius: compact ? 18 : 22,
                border: "1px dashed rgba(255,255,255,0.12)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: compact ? 18 : 24,
                borderRadius: compact ? 16 : 18,
                background: "radial-gradient(circle at 30% 30%, rgba(203,166,218,0.18), transparent 45%), rgba(11,11,19,0.55)",
              }}
            />
            <div style={{ position: "relative", color: "rgba(205,214,244,0.82)" }}>
              {icon}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: compact ? "center" : "flex-start",
            textAlign: compact ? "center" : "left",
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.4,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.5)",
            }}
          >
            {eyebrow}
          </div>
          <div
            className="ea-display"
            style={{
              fontSize: compact ? 24 : 30,
              lineHeight: 1.1,
              color: "#eef2ff",
              letterSpacing: -0.5,
            }}
          >
            {title}
          </div>
          <div
            style={{
              maxWidth: 420,
              fontSize: compact ? 12.5 : 13.5,
              lineHeight: 1.65,
              color: "rgba(205,214,244,0.6)",
            }}
          >
            {message}
          </div>
          {actions ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 4,
              }}
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
