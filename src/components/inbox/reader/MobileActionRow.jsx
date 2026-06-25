export default function MobileActionRow({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}) {
  const IconComponent = icon;
  const tint = danger ? "var(--sp-rose)" : active ? "#fff" : "rgba(205,214,244,0.8)";
  const background = danger ? "color-mix(in srgb, var(--sp-rose) 8%, transparent)" : active ? "rgba(255,255,255,0.08)" : "transparent";

  return (
    <button
      type="button"
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
        border: `1px solid ${danger ? "color-mix(in srgb, var(--sp-rose) 18%, transparent)" : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
        background,
        color: tint,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <IconComponent size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600 }}>
        {label}
      </span>
    </button>
  );
}
