import { useState } from "react";
import type { ComponentType, CSSProperties, MouseEvent, ReactNode } from "react";
import { isDemoMode } from "../../demo/config.ts";
import "./detail-cards.css";

export function RailHeroCard({ accent = "var(--ea-accent)", compact = false, actions, children }: { accent?: string; compact?: boolean; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="detail-card" data-accent={accent} style={{ "--detail-accent": accent, "--detail-padding": compact ? "15px" : "16px" } as CSSProperties}>
      {children}
      {actions ? <div className="detail-card-actions" data-testid="timeline-detail-action-dock">{actions}</div> : null}
    </div>
  );
}

export function RailMetaChip({ children, tone = "default", color = null, compact = false }: { children?: ReactNode; tone?: "default" | "quiet" | "accent"; color?: string | null; compact?: boolean }) {
  return (
    <span className="detail-card-meta-value" style={{ color: tone === "accent" ? color || "#f5e0dc" : undefined, fontSize: compact ? 10 : 11 }}>
      {children}
    </span>
  );
}

export function RailDueBadge({ color, children }: { color: string; children: ReactNode }) {
  return <span className="detail-card-due" style={{ color }}>{children}</span>;
}

export function RailReminderIndicator({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  return (
    <span
      data-testid="calendar-detail-reminder-indicator"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "4px 8px" : "5px 10px",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, var(--sp-cream) 28%, transparent)",
        background: "color-mix(in srgb, var(--sp-cream) 10%, transparent)",
        color: "var(--sp-cream)",
        fontSize: compact ? 10 : 11,
        fontWeight: 650,
        letterSpacing: 0.12,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function RailFactRow({ label, color, children }: { label: ReactNode; color?: string; children: ReactNode }) {
  return <div className="detail-card-fact"><dt>{label}</dt><dd style={{ color }}>{children}</dd></div>;
}

export function RailActionGroup({ align = "start", children }: { align?: "start" | "end"; children?: ReactNode }) {
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
}: { icon: ComponentType<{ size?: number; strokeWidth?: number }>; label: string; accent?: string; tone?: "default" | "ghost" | "accent" | "success"; size?: "default" | "compact"; disabled?: boolean; loading?: boolean; href?: string; onClick?: (event: MouseEvent<HTMLElement>) => void }) {
  const [hovered, setHovered] = useState(false);
  const demoLinkDisabled = !!href && isDemoMode();
  const resolvedDisabled = disabled || demoLinkDisabled;
  const isGhost = tone === "ghost";
  const isAccent = tone === "accent";
  const isSuccess = tone === "success";
  const color = isSuccess
    ? "var(--sp-green)"
    : isAccent
      ? "#f6f7fb"
      : isGhost
        ? "rgba(205,214,244,0.74)"
        : "rgba(238,242,255,0.84)";
  const background = isSuccess
    ? "color-mix(in srgb, var(--sp-green) 12%, transparent)"
    : isAccent
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 34%, rgba(255,255,255,0.03)), color-mix(in srgb, ${accent} 22%, rgba(255,255,255,0.02)))`
      : isGhost
        ? "transparent"
        : "rgba(255,255,255,0.025)";
  const border = isSuccess
    ? "1px solid color-mix(in srgb, var(--sp-green) 30%, transparent)"
    : isAccent
      ? `1px solid color-mix(in srgb, ${accent} 40%, rgba(255,255,255,0.08))`
      : isGhost
        ? "1px solid transparent"
        : "1px solid rgba(255,255,255,0.08)";
  const hoverBackground = isSuccess
    ? "color-mix(in srgb, var(--sp-green) 18%, transparent)"
    : isAccent
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.04)), color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.03)))`
      : isGhost
        ? "rgba(255,255,255,0.03)"
        : "rgba(255,255,255,0.045)";
  const hoverBorder = isSuccess
    ? "color-mix(in srgb, var(--sp-green) 42%, transparent)"
    : isAccent
      ? `color-mix(in srgb, ${accent} 52%, rgba(255,255,255,0.12))`
      : isGhost
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.12)";
  const hoverShadow = isSuccess
    ? "0 10px 22px color-mix(in srgb, var(--sp-green) 12%, transparent)"
    : isAccent
      ? `0 0 0 1px color-mix(in srgb, ${accent} 10%, transparent), 0 12px 24px color-mix(in srgb, ${accent} 12%, transparent)`
      : "none";
  const compact = size === "compact";

  const sharedProps = {
    className: "calendar-detail-action",
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: (event: MouseEvent<HTMLElement>) => {
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
      cursor: resolvedDisabled ? "default" : "pointer",
      background: hovered ? hoverBackground : background,
      border: hovered ? `1px solid ${hoverBorder}` : border,
      color,
      opacity: resolvedDisabled ? 0.58 : 1,
      whiteSpace: "nowrap",
      textDecoration: "none",
      transform: hovered && !resolvedDisabled ? "translateY(-1px)" : "translateY(0)",
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

  if (href && !demoLinkDisabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
        data-calendar-focus-ring="true"
        {...sharedProps}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={resolvedDisabled}
      aria-label={demoLinkDisabled ? `${label} disabled in demo mode` : label}
      aria-busy={loading ? "true" : undefined}
      title={demoLinkDisabled ? "External links are disabled in demo mode" : label}
      data-calendar-focus-ring="true"
      {...sharedProps}
    >
      {content}
    </button>
  );
}
