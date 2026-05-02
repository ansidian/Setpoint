import { useState } from "react";
import { Sparkles } from "lucide-react";

function ConfirmGenerateButton({ accent, onClick }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        border: "none",
        background: accent,
        color: "#0b0b13",
        fontFamily: "inherit",
        fontWeight: 600,
        fontSize: 11,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        boxShadow: lifted ? `0 6px 18px ${accent}59` : "none",
        filter: lifted ? "brightness(1.06)" : "none",
        transition: "transform 150ms, box-shadow 150ms, filter 150ms",
      }}
    >
      Generate
    </button>
  );
}

function ConfirmCancelButton({ onClick }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      aria-label="Cancel full generation"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${hover ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`,
        background: hover ? "rgba(255,255,255,0.06)" : "transparent",
        color: hover ? "rgba(205,214,244,0.9)" : "rgba(205,214,244,0.7)",
        fontFamily: "inherit",
        fontSize: 11,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      Cancel
    </button>
  );
}

export function ConfirmGenerateToast({ accent, confirming, onFullGenerate, onCancel }) {
  if (!confirming) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 14px",
        borderRadius: 10,
        background: "#16161e",
        border: `1px solid ${accent}40`,
        boxShadow: `0 0 40px ${accent}30`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 60,
        fontSize: 12,
      }}
    >
      <Sparkles size={13} color={accent} />
      Generate a fresh briefing?
      <ConfirmGenerateButton accent={accent} onClick={onFullGenerate} />
      <ConfirmCancelButton onClick={onCancel} />
    </div>
  );
}
