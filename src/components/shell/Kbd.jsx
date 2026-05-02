export function Kbd({ children }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        fontSize: 10,
        fontFamily: "Fira Code, ui-monospace, monospace",
        fontWeight: 500,
        color: "rgba(205,214,244,0.55)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        letterSpacing: 0,
      }}
    >
      {children}
    </kbd>
  );
}
