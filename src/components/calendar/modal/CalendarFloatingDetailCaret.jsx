const CARET_BORDER = "1px solid rgba(203,166,218,0.22)";

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
        background: "#1b1b27",
        borderLeft: caretSide === "left" ? CARET_BORDER : 0,
        borderBottom: caretSide === "left" ? CARET_BORDER : 0,
        borderRight: caretSide === "right" ? CARET_BORDER : 0,
        borderTop: caretSide === "right" ? CARET_BORDER : 0,
        boxShadow: "0 0 10px rgba(203,166,218,0.10)",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
