import { useState } from "react";
import { Check } from "lucide-react";

// A deliberately quiet "Mark done" affordance shared by the Coming-up rows and the
// needs-you band's upcoming cards. Unlike the urgent band button (filled, bordered),
// this is text-only: no box, so nothing competes with or clips against the row's own
// hover state. It reveals on the parent's hover (`revealed`) or its own focus, and
// only shifts colour (muted -> green) on direct hover/focus. Reduced motion is
// honoured by the global transition reset in index.css.
export default function MarkDoneAction({ onComplete, revealed = false, itemTitle = "", style }) {
  const [active, setActive] = useState(false);
  const visible = revealed || active;
  return (
    <button
      type="button"
      aria-label={itemTitle ? `Mark ${itemTitle} done` : "Mark done"}
      onClick={(e) => { e.stopPropagation(); onComplete?.(); }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: "transparent", border: "none", padding: 0, margin: 0,
        color: active ? "var(--sp-green)" : "rgba(205,214,244,0.5)",
        fontSize: 10.5, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap",
        cursor: "pointer", outline: "none",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 130ms ease, color 130ms ease",
        ...style,
      }}
    >
      <Check size={11} strokeWidth={2.4} />Mark done
    </button>
  );
}
