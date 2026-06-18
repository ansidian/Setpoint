export function MobileStatusPill({ color, label, subtle = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 9px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color,
        background: subtle ? `${color}12` : `${color}18`,
        border: `1px solid ${color}${subtle ? "2c" : "38"}`,
      }}
    >
      {!subtle && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      )}
      {label}
    </span>
  );
}

export function InlineControlButton({ icon, label, active = false, onClick, buttonRef }) {
  const IconComponent = icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "7px 10px",
        minHeight: 44,
        minWidth: 44,
        borderRadius: 10,
        border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
        color: active ? "#fff" : "rgba(205,214,244,0.72)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      <IconComponent size={11} />
      {label}
    </button>
  );
}
