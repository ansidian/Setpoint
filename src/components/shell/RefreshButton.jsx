import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Kbd } from "./Kbd.jsx";

export function RefreshButton({
  isMobile = false,
  refreshing,
  onQuickRefresh,
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const busy = refreshing;
  const lifted = hover && !pressed && !busy;

  return (
    <button
      type="button"
      aria-label="Sync now"
      onPointerDown={() => {
        setPressed(true);
      }}
      onPointerUp={() => {
        setPressed(false);
      }}
      onPointerLeave={() => {
        setPressed(false);
        setHover(false);
      }}
      onMouseEnter={() => setHover(true)}
      onClick={() => {
        onQuickRefresh?.();
      }}
      disabled={busy}
      style={{
        position: "relative",
        overflow: "hidden",
        padding: isMobile ? "7px 9px" : "5px 10px",
        borderRadius: 8,
        border: `1px solid ${hover && !busy ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: hover && !busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        color: hover && !busy ? "#cdd6f4" : "rgba(205,214,244,0.85)",
        fontFamily: "inherit",
        fontSize: isMobile ? 10.5 : 11,
        fontWeight: 500,
        letterSpacing: 0.2,
        cursor: refreshing ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        opacity: busy ? 0.6 : 1,
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <RefreshCw
        size={isMobile ? 10 : 11}
        style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }}
      />
      <span style={{ position: "relative" }}>
        {refreshing ? "Syncing…" : "Sync now"}
      </span>
      {!isMobile && <Kbd>R</Kbd>}
    </button>
  );
}
