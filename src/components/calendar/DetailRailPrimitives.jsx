import { useState } from "react";

export function RailHeroCard({ accent = "var(--ea-accent)", compact = false, actions, children }) {
  const pad = compact ? 12 : 14;
  return (
    <div
      style={{
        minHeight: 0,
        padding: pad,
        borderRadius: compact ? 14 : 16,
        border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
        background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 14%, transparent), transparent 44%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 8 : 10,
      }}
    >
      {children}
      {actions ? (
        <>
          <div
            style={{
              height: 1,
              background: "rgba(255,255,255,0.05)",
              margin: `0 -${pad}px`,
            }}
          />
          <div
            data-testid="timeline-detail-action-dock"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: compact ? 6 : 8,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            {actions}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function RailMetaChip({ children, tone = "default", color = null, compact = false }) {
  const styles = tone === "quiet"
    ? {
        color: "rgba(205,214,244,0.62)",
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.018)",
      }
    : tone === "accent"
      ? {
          color: color || "#f5e0dc",
          border: `1px solid ${color ? `${color}38` : "rgba(245,224,220,0.14)"}`,
          background: color ? `${color}16` : "rgba(245,224,220,0.08)",
        }
      : {
          color: "rgba(205,214,244,0.78)",
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.03)",
        };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "4px 8px" : "5px 10px",
        borderRadius: 999,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        letterSpacing: 0.12,
        whiteSpace: "nowrap",
        ...styles,
      }}
    >
      {children}
    </span>
  );
}

export function RailFactTile({
  label,
  value,
  color,
  valueNoWrap = false,
  valueFontSize = null,
  compact = false,
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: compact ? "10px" : "12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.016)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 5 : 7,
      }}
    >
      <div
        style={{
          color: "rgba(205,214,244,0.45)",
          letterSpacing: 1.4,
          textTransform: "uppercase",
          fontSize: compact ? 8.5 : 9,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: color || "rgba(205,214,244,0.88)",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: valueFontSize || (compact ? 12 : 13),
          lineHeight: 1.35,
          minHeight: 18,
          whiteSpace: valueNoWrap ? "nowrap" : compact ? "normal" : "normal",
          overflow: valueNoWrap || compact ? "hidden" : "visible",
          textOverflow: valueNoWrap ? "ellipsis" : "clip",
          fontVariantNumeric: valueNoWrap ? "tabular-nums" : undefined,
          ...(compact && !valueNoWrap
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }
            : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function RailActionDock({
  accent = "var(--ea-accent)",
  compact = false,
  children,
}) {
  if (!children) return null;

  return (
    <div
      data-testid="timeline-detail-action-dock"
      style={{
        flexShrink: 0,
        padding: compact ? "8px" : "9px",
        borderRadius: 14,
        border: `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.06))`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 8%, rgba(255,255,255,0.028)), rgba(255,255,255,0.018))`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: compact ? 6 : 8,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

export function RailActionGroup({ align = "start", children }) {
  if (!children) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "end" ? "flex-end" : "flex-start",
        gap: 8,
        flexWrap: "wrap",
        minWidth: 0,
        marginLeft: align === "end" ? "auto" : undefined,
      }}
    >
      {children}
    </div>
  );
}

export function RailAction({
  icon: Icon,
  label,
  accent = "var(--ea-accent)",
  tone = "default",
  size = "default",
  disabled = false,
  loading = false,
  href,
  onClick,
}) {
  const [hovered, setHovered] = useState(false);
  const isGhost = tone === "ghost";
  const isAccent = tone === "accent";
  const isSuccess = tone === "success";
  const color = isSuccess
    ? "#a6e3a1"
    : isAccent
      ? "#f6f7fb"
      : isGhost
        ? "rgba(205,214,244,0.74)"
        : "rgba(238,242,255,0.84)";
  const background = isSuccess
    ? "rgba(166,227,161,0.12)"
    : isAccent
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 34%, rgba(255,255,255,0.03)), color-mix(in srgb, ${accent} 22%, rgba(255,255,255,0.02)))`
      : isGhost
        ? "transparent"
        : "rgba(255,255,255,0.025)";
  const border = isSuccess
    ? "1px solid rgba(166,227,161,0.3)"
    : isAccent
      ? `1px solid color-mix(in srgb, ${accent} 40%, rgba(255,255,255,0.08))`
      : isGhost
        ? "1px solid transparent"
        : "1px solid rgba(255,255,255,0.08)";
  const hoverBackground = isSuccess
    ? "rgba(166,227,161,0.18)"
    : isAccent
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.04)), color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.03)))`
      : isGhost
        ? "rgba(255,255,255,0.03)"
        : "rgba(255,255,255,0.045)";
  const hoverBorder = isSuccess
    ? "rgba(166,227,161,0.42)"
    : isAccent
      ? `color-mix(in srgb, ${accent} 52%, rgba(255,255,255,0.12))`
      : isGhost
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.12)";
  const hoverShadow = isSuccess
    ? "0 10px 22px rgba(166,227,161,0.12)"
    : isAccent
      ? `0 0 0 1px color-mix(in srgb, ${accent} 10%, transparent), 0 12px 24px color-mix(in srgb, ${accent} 12%, transparent)`
      : "none";
  const compact = size === "compact";

  const sharedProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: (event) => {
      event.stopPropagation();
      onClick?.(event);
    },
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: compact ? 7 : 8,
      minHeight: compact ? 32 : 38,
      padding: compact
        ? (isGhost ? "6px 8px" : "7px 11px")
        : (isGhost ? "8px 10px" : "10px 14px"),
      borderRadius: 12,
      fontSize: compact ? 11.5 : isGhost ? 12 : 13,
      fontWeight: 600,
      fontFamily: "inherit",
      cursor: disabled ? "default" : "pointer",
      background: hovered ? hoverBackground : background,
      border: hovered ? `1px solid ${hoverBorder}` : border,
      color,
      opacity: disabled ? 0.58 : 1,
      whiteSpace: "nowrap",
      textDecoration: "none",
      transform: hovered && !disabled ? "translateY(-1px)" : "translateY(0)",
      boxShadow: hovered ? hoverShadow : "none",
      transition: "background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms, color 140ms",
    },
  };

  const content = (
    <>
      {loading ? (
        <span
          aria-hidden
          style={{
            width: compact ? 11 : 12,
            height: compact ? 11 : 12,
            borderRadius: "50%",
            border: "1.5px solid currentColor",
            borderTopColor: "transparent",
            animation: "spin 700ms linear infinite",
          }}
        />
      ) : Icon ? (
        <Icon size={compact ? 13 : 14} />
      ) : null}
      <span>{label}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
        {...sharedProps}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      {...sharedProps}
    >
      {content}
    </button>
  );
}
