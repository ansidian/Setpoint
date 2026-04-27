import { useState } from "react";
import { Zap, FileText, BellOff, ArrowUp, ArrowDown } from "lucide-react";
import { LANE } from "../../lib/redesign-helpers";

export function Kbd({ children }) {
  return (
    <kbd
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 18, height: 18, padding: "0 5px",
        fontSize: 10, fontFamily: "Fira Code, ui-monospace, monospace", fontWeight: 500,
        color: "rgba(205,214,244,0.55)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4, letterSpacing: 0,
      }}
    >
      {children}
    </kbd>
  );
}

export function Avatar({ name, email, color, size = 28 }) {
  const initials = (name || email || "?")
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 999,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: size < 28 ? 9 : 11, fontWeight: 600, letterSpacing: 0.3,
        background: `linear-gradient(135deg, ${color}30, ${color}10)`,
        color,
        border: `1px solid ${color}28`,
      }}
    >
      {initials}
    </div>
  );
}

export function Eyebrow({ children, style }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: 2.6, textTransform: "uppercase",
        color: "rgba(205,214,244,0.55)", ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StickyHeader({ children, borderColor }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px 8px",
        position: "sticky", top: 0, zIndex: 2,
        background: "linear-gradient(180deg, rgba(30,30,46,0.99), rgba(30,30,46,0.96))",
        borderBottom: `1px solid ${borderColor}`,
      }}
    >
      {children}
    </div>
  );
}

export function IconBtn({ children, onClick, title, tinted, accent = "#cba6da" }) {
  const [hover, setHover] = useState(false);
  const bg = tinted
    ? (hover ? `${accent}22` : `${accent}14`)
    : (hover ? "rgba(255,255,255,0.04)" : "transparent");
  const color = tinted
    ? accent
    : (hover ? "rgba(205,214,244,0.9)" : "rgba(205,214,244,0.55)");
  const border = tinted
    ? (hover ? `${accent}60` : `${accent}38`)
    : (hover ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)");
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 10px", borderRadius: 8,
        fontSize: 11, fontWeight: 500, fontFamily: "inherit",
        cursor: "pointer", transition: "background 150ms, border-color 150ms, color 150ms",
        background: bg,
        color,
        border: `1px solid ${border}`,
        letterSpacing: 0.2, whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export function LaneIcon({ laneKey }) {
  const color = LANE[laneKey].color;
  const Icon = laneKey === "action" ? Zap : laneKey === "fyi" ? FileText : BellOff;
  return <Icon size={11} color={color} />;
}

// Text-editable hour/minute field with click-through steppers + arrow-key
// support. While focused, `buffer` holds the user's partial string so typing
// "1" on the way to "15" doesn't fire onChange(1) mid-edit. When not focused,
// `buffer` is null and the displayed value is derived from props — no
// synchronizing effect required. Tab/Shift+Tab navigation is native since
// the element is a real <input>.
export function NumberField({
  value,
  onChange,
  min,
  max,
  pad = 0,
  ariaLabel,
  accent = "#f97316",
  autoFocus = false,
  inputRef = null,
}) {
  const formatted = pad ? String(value).padStart(pad, "0") : String(value);
  const [buffer, setBuffer] = useState(null);
  const focused = buffer !== null;
  const display = focused ? buffer : formatted;

  const commit = (raw) => {
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n)) {
      onChange(Math.max(min, Math.min(max, n)));
    }
    // else: invalid input — drop buffer so display snaps back to prop value.
    setBuffer(null);
  };

  const inc = () => onChange(value >= max ? min : value + 1);
  const dec = () => onChange(value <= min ? max : value - 1);

  const stepperBtn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 16, padding: 0,
    background: "transparent", border: "none", cursor: "pointer",
    color: "rgba(205,214,244,0.55)", borderRadius: 4,
    transition: "color 120ms",
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <button
        type="button"
        tabIndex={-1}
        onClick={inc}
        aria-label={`Increase ${ariaLabel}`}
        style={stepperBtn}
        onMouseEnter={(e) => { e.currentTarget.style.color = accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(205,214,244,0.55)"; }}
      >
        <ArrowUp size={10} />
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        value={display}
        onFocus={(e) => { setBuffer(formatted); e.target.select(); }}
        onBlur={() => commit(buffer ?? formatted)}
        onChange={(e) => setBuffer(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            inc();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            dec();
          }
        }}
        style={{
          width: 28, padding: "2px 0",
          background: focused ? "rgba(255,255,255,0.06)" : "transparent",
          border: focused
            ? `1px solid color-mix(in srgb, ${accent} 55%, transparent)`
            : "1px solid transparent",
          borderRadius: 4, outline: "none",
          textAlign: "center",
          fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums",
          color: "rgba(255,255,255,0.96)", fontFamily: "inherit",
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={dec}
        aria-label={`Decrease ${ariaLabel}`}
        style={stepperBtn}
        onMouseEnter={(e) => { e.currentTarget.style.color = accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(205,214,244,0.55)"; }}
      >
        <ArrowDown size={10} />
      </button>
    </div>
  );
}

export function QuickAction({
  icon: Icon, label, onClick, primary, danger, hint,
  accent = "#cba6da", buttonRef, title,
  holdProgress = 0, holdColor,
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", overflow: "hidden",
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 11px", borderRadius: 8,
        fontSize: 11, fontWeight: 600, fontFamily: "inherit",
        cursor: "pointer", transition: "background 120ms, border-color 120ms, color 120ms",
        background: primary ? `linear-gradient(135deg, ${accent}38, rgba(137,220,235,0.18))`
                 : hover ? "rgba(255,255,255,0.05)"
                 : "rgba(255,255,255,0.02)",
        border: primary ? `1px solid ${accent}66`
              : `1px solid ${danger ? "rgba(243,139,168,0.22)" : "rgba(255,255,255,0.08)"}`,
        color: primary ? accent : danger ? "#f38ba8" : "rgba(205,214,244,0.7)",
        whiteSpace: "nowrap",
      }}
    >
      {holdProgress > 0 && holdColor && (
        <span
          aria-hidden
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: "100%",
            background: `linear-gradient(90deg, ${holdColor}38, ${holdColor}1f)`,
            pointerEvents: "none",
            transform: `scaleX(${holdProgress})`,
            transformOrigin: "left center",
            transition: "transform 40ms linear",
          }}
        />
      )}
      {Icon && <Icon size={11} style={{ position: "relative" }} />}
      {label && <span style={{ position: "relative" }}>{label}</span>}
      {hint && (
        <span style={{ position: "relative", fontSize: 9, opacity: 0.6, marginLeft: 2, fontFamily: "Fira Code, monospace" }}>
          {hint}
        </span>
      )}
    </button>
  );
}
