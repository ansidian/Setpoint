import { useRef, useState } from "react";
import type { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import type { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Zap, FileText, BellOff, ArrowUp, ArrowDown, History, Check, MailOpen, Clock, Pin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import Tooltip from "../shared/Tooltip";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 18, height: 18, padding: "0 5px",
        fontSize: 10, fontFamily: "Fira Code, ui-monospace, monospace", fontWeight: 500,
        color: "var(--color-text-faint)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4, letterSpacing: 0,
      }}
    >
      {children}
    </kbd>
  );
}

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  color: string;
  size?: number;
}

export function Avatar({ name, email, color, size = 28 }: AvatarProps) {
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

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: 2.6, textTransform: "uppercase",
        color: "var(--color-text-faint)", ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StickyHeader({ children, borderColor }: { children: ReactNode; borderColor: string }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px 8px",
        position: "sticky", top: 0, zIndex: 2,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-page) 99%, transparent), color-mix(in srgb, var(--sp-page) 96%, transparent))",
        borderBottom: `1px solid ${borderColor}`,
      }}
    >
      {children}
    </div>
  );
}

interface IconBtnProps {
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  tinted?: boolean;
  accent?: string;
}

export function IconBtn({ children, onClick, title, tinted = false, accent = "#cba6da" }: IconBtnProps) {
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

export function LaneIcon({ laneKey }: { laneKey: string }) {
  const color = LANE[laneKey]?.color ?? "#6c7086";
  const Icon = laneKey === "pinned"
    ? Pin
    : laneKey === "queued"
    ? Clock
    : laneKey === "needs_attention" || laneKey === "action"
    ? Zap
    : laneKey === "carryover"
      ? History
      : laneKey === "catch_up"
        ? MailOpen
        : laneKey === "fyi"
          ? FileText
          : laneKey === "handled"
            ? Check
            : BellOff;
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
  accent = "var(--sp-orange)",
  autoFocus = false,
  inputRef = null,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  pad?: number;
  ariaLabel: string;
  accent?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const formatted = pad ? String(value).padStart(pad, "0") : String(value);
  const [buffer, setBuffer] = useState<string | null>(null);
  const focused = buffer !== null;
  const display = focused ? buffer : formatted;

  const commit = (raw: string) => {
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n)) {
      onChange(Math.max(min, Math.min(max, n)));
    }
    // else: invalid input — drop buffer so display snaps back to prop value.
    setBuffer(null);
  };

  const inc = () => onChange(value >= max ? min : value + 1);
  const dec = () => onChange(value <= min ? max : value - 1);

  const stepperBtn: CSSProperties = {
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
  icon: Icon, label, onClick, primary, danger,
  accent = "#cba6da", buttonRef, ariaLabel, tooltip,
  keyHint, touch = false, disabled = false,
}: {
  icon?: LucideIcon;
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  primary?: boolean;
  danger?: boolean;
  accent?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  ariaLabel?: string;
  tooltip?: string;
  keyHint?: ReactNode;
  touch?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const tooltipActionsRef = useRef<TooltipPrimitive.Root.Actions | null>(null);
  const iconOnly = !label;
  const accessibleLabel = ariaLabel || tooltip || label;
  const control = (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={(event) => {
        tooltipActionsRef.current?.unmount();
        onClick?.(event);
      }}
      aria-label={iconOnly ? accessibleLabel : ariaLabel}
      onMouseEnter={() => { if (!disabled) setHover(true); }}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", overflow: "hidden",
        flexShrink: 0,
        display: "inline-flex", alignItems: "center", gap: 6,
        justifyContent: "center",
        width: iconOnly ? 36 : undefined,
        height: touch ? "var(--sp-touch-min)" : 36,
        padding: iconOnly ? 0 : "0 11px",
        borderRadius: 8,
        fontSize: 11, fontWeight: 600, fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer", transition: "background 150ms, border-color 150ms, color 150ms, transform 150ms",
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.55 : 1,
        background: primary ? `linear-gradient(135deg, ${accent}38, color-mix(in srgb, var(--sp-cyan) 18%, transparent))`
                 : hover ? "rgba(255,255,255,0.05)"
                 : "rgba(255,255,255,0.02)",
        border: primary ? `1px solid ${accent}66`
              : `1px solid ${danger ? "color-mix(in srgb, var(--sp-rose) 22%, transparent)" : "rgba(255,255,255,0.08)"}`,
        color: primary ? accent : danger ? "var(--sp-rose)" : "rgba(205,214,244,0.7)",
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon size={11} style={{ position: "relative" }} />}
      {label && <span style={{ position: "relative" }}>{label}</span>}
      {keyHint && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            minWidth: 12,
            height: 12,
            padding: "0 3px",
            borderRadius: 3,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            lineHeight: 1,
            fontFamily: "Fira Code, ui-monospace, monospace",
            color: "rgba(205,214,244,0.58)",
            background: "color-mix(in srgb, var(--sp-deep) 75%, transparent)",
            border: "1px solid rgba(255,255,255,0.08)",
            pointerEvents: "none",
          }}
        >
          {keyHint}
        </span>
      )}
    </button>
  );
  return tooltip ? (
    <Tooltip actionsRef={tooltipActionsRef} text={tooltip} side="bottom" sideOffset={8}>
      {control}
    </Tooltip>
  ) : control;
}
