import type { MouseEventHandler } from "react";
import type { LucideIcon } from "lucide-react";

export default function MobileActionRow({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
  accent = null,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  active?: boolean;
  danger?: boolean;
  accent?: string | null;
  disabled?: boolean;
}) {
  const IconComponent = icon;
  const accentActive = !danger && active && accent;
  const tint = danger ? "var(--sp-rose)" : accentActive ? accent : active ? "#fff" : "rgba(205,214,244,0.8)";
  const background = danger ? "color-mix(in srgb, var(--sp-rose) 8%, transparent)" : accentActive ? `color-mix(in srgb, ${accent} 8%, transparent)` : active ? "rgba(255,255,255,0.08)" : "transparent";

  return (
    <button
      className="inbox-mobile-action-row"
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minWidth: 0,
        padding: "11px 12px",
        minHeight: "var(--sp-touch-min)",
        borderRadius: 10,
        border: `1px solid ${danger ? "color-mix(in srgb, var(--sp-rose) 18%, transparent)" : accentActive ? `color-mix(in srgb, ${accent} 18%, transparent)` : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
        background,
        color: tint,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontFamily: "inherit",
        textAlign: "left",
        transition: "transform 160ms ease, background 160ms ease, border-color 160ms ease, color 160ms ease, opacity 160ms ease",
      }}
    >
      <IconComponent size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600 }}>
        {label}
      </span>
    </button>
  );
}
