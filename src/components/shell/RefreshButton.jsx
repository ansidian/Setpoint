import { useState } from "react";
import { RefreshCw } from "lucide-react";

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
        padding: isMobile ? "7px 10px" : "5px 10px",
        minHeight: isMobile ? 40 : undefined,
        touchAction: "manipulation",
        borderRadius: 8,
        border: "1px solid transparent",
        background: "var(--sp-accent)",
        color: "var(--sp-mantle)",
        filter: lifted ? "brightness(1.06)" : "none",
        fontFamily: "inherit",
        fontSize: isMobile ? 10.5 : 11,
        fontWeight: 500,
        letterSpacing: 0.2,
        cursor: refreshing ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
        flexShrink: 0,
        opacity: busy ? 0.6 : 1,
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms, filter 150ms",
      }}
    >
      <RefreshCw
        size={isMobile ? 10 : 11}
        color="var(--sp-mantle)"
        style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }}
      />
      <span style={{ position: "relative", whiteSpace: "nowrap" }}>
        {refreshing ? "Syncing…" : "Sync now"}
      </span>
      {!isMobile && (
        <span style={{ color: "var(--sp-mantle)", opacity: 0.85, fontFamily: "var(--font-mono)", fontSize: 10 }}>R</span>
      )}
    </button>
  );
}
