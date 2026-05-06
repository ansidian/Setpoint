export default function MobileActionRow({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}) {
  const IconComponent = icon;
  const tint = danger ? "#f38ba8" : active ? "#fff" : "rgba(205,214,244,0.8)";
  const background = danger ? "rgba(243,139,168,0.08)" : active ? "rgba(255,255,255,0.08)" : "transparent";

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
        borderRadius: 10,
        border: `1px solid ${danger ? "rgba(243,139,168,0.18)" : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
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
