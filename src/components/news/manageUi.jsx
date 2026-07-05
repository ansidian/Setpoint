import { useState } from "react";

export function ManageButton({ onClick, disabled, children, ariaLabel, title }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        padding: "5px 9px",
        borderRadius: 7,
        border: "1px solid rgba(255,255,255,0.08)",
        background: hover && !disabled ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.02)",
        color: "var(--sp-text)",
        fontSize: 11.5,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 150ms, opacity 150ms",
      }}
    >
      {children}
    </button>
  );
}
