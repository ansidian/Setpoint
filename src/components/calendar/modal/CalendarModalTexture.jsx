export default function CalendarModalTexture() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 0.8px, transparent 0.8px)",
        backgroundSize: "22px 22px",
        opacity: 0.18,
        maskImage: "linear-gradient(180deg, rgba(0,0,0,0.34), rgba(0,0,0,0) 38%)",
      }}
    />
  );
}
