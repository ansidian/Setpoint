import { useState } from "react";
import { Search } from "lucide-react";
import { Kbd } from "./Kbd.jsx";

export function PaletteTriggerButton({ onOpenPalette }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      aria-label="Open command palette"
      onClick={onOpenPalette}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      title="Command palette (⌘K)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        fontSize: 11,
        fontFamily: "inherit",
        letterSpacing: 0.2,
        fontWeight: 500,
        background: hover ? "rgba(255,255,255,0.05)" : "transparent",
        color: hover ? "rgba(205,214,244,0.9)" : "rgba(205,214,244,0.6)",
        border: `1px solid ${hover ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <Search size={11} />
      <span>Jump to anything</span>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}
