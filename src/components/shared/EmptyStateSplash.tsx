import type { CSSProperties, ReactNode } from "react";

export type EmptyStateSplashProps = {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  minHeight?: CSSProperties["minHeight"] | null;
  align?: "center" | "start";
};

export default function EmptyStateSplash({
  icon = null,
  eyebrow = "Nothing here",
  title,
  message,
  actions = null,
  compact = false,
  minHeight = null,
  align = "center",
}: EmptyStateSplashProps) {
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
        background: "radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--sp-accent) 12%, transparent), transparent 32%), radial-gradient(circle at 78% 30%, color-mix(in srgb, var(--sp-blue) 10%, transparent), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(var(--sp-dot) 0.5px, transparent 0.5px)",
          backgroundSize: "10px 10px",
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
          background: "radial-gradient(circle, color-mix(in srgb, var(--sp-accent) 18%, transparent), transparent 70%)",
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
          background: "radial-gradient(circle, color-mix(in srgb, var(--sp-blue) 16%, transparent), transparent 70%)",
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
                background: "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--sp-accent) 18%, transparent), transparent 45%), color-mix(in srgb, var(--sp-deep) 55%, transparent)",
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
              color: "var(--color-text-faint)",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              fontSize: compact ? 24 : 30,
              lineHeight: 1.1,
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              color: "var(--sp-text)",
              letterSpacing: -0.25,
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
