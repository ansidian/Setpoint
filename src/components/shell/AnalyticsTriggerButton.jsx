import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { Kbd } from "./Kbd.jsx";

export function AnalyticsTriggerButton({ active = false, onOpenAnalytics, onPrepareAnalytics }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const engaged = active || hover || focused;
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      aria-label="Open analytics"
      aria-pressed={active}
      onClick={onOpenAnalytics}
      onMouseEnter={() => {
        setHover(true);
        onPrepareAnalytics?.();
      }}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onFocus={() => {
        setFocused(true);
        onPrepareAnalytics?.();
      }}
      onBlur={() => {
        setFocused(false);
        setPressed(false);
      }}
      onPointerDown={() => {
        setPressed(true);
        onPrepareAnalytics?.({ delay: 0 });
      }}
      onPointerUp={() => setPressed(false)}
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
        background: active
          ? "rgba(203,166,218,0.13)"
          : engaged
            ? "rgba(255,255,255,0.05)"
            : "transparent",
        color: active
          ? "#cba6da"
          : engaged
            ? "rgba(205,214,244,0.9)"
            : "rgba(205,214,244,0.6)",
        border: `1px solid ${
          active
            ? "rgba(203,166,218,0.28)"
            : engaged
              ? "rgba(255,255,255,0.14)"
              : "rgba(255,255,255,0.06)"
        }`,
        boxShadow: focused ? "0 0 0 2px rgba(203,166,218,0.22)" : "none",
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms, box-shadow 150ms",
      }}
    >
      <BarChart3 size={11} />
      <span>Analytics</span>
      <Kbd>A</Kbd>
    </button>
  );
}
