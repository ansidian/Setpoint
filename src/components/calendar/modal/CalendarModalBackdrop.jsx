export default function CalendarModalBackdrop() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: [
          "radial-gradient(circle at top, rgba(203,166,218,0.10), transparent 28%)",
          "radial-gradient(circle at 100% 0%, rgba(137,180,250,0.07), transparent 22%)",
          "rgba(4,6,10,0.72)",
        ].join(", "),
        animation: "calendarBackdropIn 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        pointerEvents: "none",
        willChange: "opacity",
      }}
    />
  );
}
