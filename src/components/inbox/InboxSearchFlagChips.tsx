import { useState } from "react";
import { getSearchFlag, toggleReadStateFlag } from "./InboxSearchFlagChipsModel";

export default function InboxSearchFlagChips({
  query,
  onChange,
  accent = "#cba6da",
  compact = false,
}: {
  query: string;
  onChange?: (query: string) => void;
  accent?: string;
  compact?: boolean;
}) {
  const activeFlag = getSearchFlag(query);
  const [hovered, setHovered] = useState(false);
  const active = activeFlag === "unread";

  return (
    <div
      data-testid="inbox-search-flag-chips"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label="Toggle unread search flag"
        title={active ? "Showing unread indexed mail" : "Show unread indexed mail"}
        onClick={() => onChange?.(toggleReadStateFlag(query))}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
        style={{
          height: compact ? "var(--sp-touch-min)" : 30,
          padding: compact ? 0 : "0 10px",
          borderRadius: compact ? 8 : 999,
          border: compact ? "none" : `1px solid ${active ? `${accent}55` : hovered ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.08)"}`,
          background: compact ? "transparent" : active ? `${accent}1f` : hovered ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.03)",
          color: "inherit",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: compact ? 10 : 10.5,
          fontWeight: 650,
          lineHeight: 1,
          whiteSpace: "nowrap",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "background 160ms, border-color 160ms, color 160ms, transform 160ms",
        }}
      >
        <span
          style={{
            height: compact ? 30 : "100%",
            padding: compact ? "0 9px" : 0,
            borderRadius: compact ? 8 : 999,
            border: compact ? `1px solid ${active ? `${accent}55` : hovered ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.08)"}` : "none",
            background: compact ? active ? `${accent}1f` : hovered ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.03)" : "transparent",
            color: active ? "#fff" : "rgba(205,214,244,0.68)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Unread
        </span>
      </button>
    </div>
  );
}
