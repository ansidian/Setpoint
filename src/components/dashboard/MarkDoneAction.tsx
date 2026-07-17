import { useState } from "react";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";

interface MarkDoneActionProps {
  onComplete?: () => void;
  revealed?: boolean;
  itemTitle?: string;
  compact?: boolean;
  alwaysVisible?: boolean;
  style?: CSSProperties;
}

// A deliberately quiet "Mark done" affordance shared by the Coming-up rows and the
// needs-you band's upcoming cards. Unlike the urgent band button (filled, bordered),
// this is text-only: no box, so nothing competes with or clips against the row's own
// hover state. It reveals on the parent's hover (`revealed`) or its own focus, and
// only shifts colour (muted -> green) on direct hover/focus. Reduced motion is
// honoured by the global transition reset in index.css.
// `compact` renders an icon-only 20x20 check button (used beside the Coming-up
// chip, where a text label would crowd the slot); the default is the text-only
// "Mark done" used by the needs-you band's upcoming-card footer.
export default function MarkDoneAction({ onComplete, revealed = false, itemTitle = "", compact = false, alwaysVisible = false, style }: MarkDoneActionProps) {
  const [active, setActive] = useState(false);
  const visible = revealed || active || alwaysVisible;
  return (
    <button
      type="button"
      className="sp-focus-ring"
      aria-label={itemTitle ? `Mark ${itemTitle} done` : "Mark done"}
      onClick={(e) => { e.stopPropagation(); onComplete?.(); }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "inline-flex", alignItems: "center",
        background: compact && active ? "color-mix(in srgb, var(--sp-green) 16%, transparent)" : "transparent",
        border: "none", margin: 0,
        color: active ? "var(--sp-green)" : "rgba(205,214,244,0.5)",
        fontFamily: "inherit", whiteSpace: "nowrap",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 130ms ease, color 130ms ease, background 130ms ease",
        ...(compact
          ? { justifyContent: "center", width: 20, height: 20, borderRadius: 6, padding: 0 }
          : { gap: 4, padding: 0, fontSize: 10.5, fontWeight: 600 }),
        ...style,
      }}
    >
      <Check size={compact ? 13 : 11} strokeWidth={2.4} />{compact ? null : "Mark done"}
    </button>
  );
}
