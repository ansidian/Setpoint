const CARET_BORDER = "1px solid color-mix(in srgb, var(--sp-accent) 22%, transparent)";

// Diamond pointing from the panel edge back at its anchor cell. Rendered only when
// the placement resolver picked an anchored side (no caret while user-dragged).
export default function CalendarFloatingDetailCaret({ caretSide, caretTop }) {
  if (!caretSide) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="calendar-floating-detail-caret"
      style={{
        position: "absolute",
        top: caretTop,
        [caretSide]: -6,
        width: 12,
        height: 12,
        transform: "rotate(45deg)",
        background: "var(--sp-panel)",
        borderLeft: caretSide === "left" ? CARET_BORDER : 0,
        borderBottom: caretSide === "left" ? CARET_BORDER : 0,
        borderRight: caretSide === "right" ? CARET_BORDER : 0,
        borderTop: caretSide === "right" ? CARET_BORDER : 0,
        boxShadow: "0 0 10px color-mix(in srgb, var(--sp-accent) 10%, transparent)",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
