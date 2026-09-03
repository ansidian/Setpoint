export function MobileStatusPill({ color, label, subtle = false }: { color: string; label: string; subtle?: boolean }) {
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
