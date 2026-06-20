export default function CalendarModalTexture() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: "radial-gradient(var(--sp-dot) 0.5px, transparent 0.5px)",
        backgroundSize: "10px 10px",
        opacity: 0.18,
        maskImage: "linear-gradient(180deg, rgba(0,0,0,0.34), rgba(0,0,0,0) 38%)",
      }}
    />
  );
}
