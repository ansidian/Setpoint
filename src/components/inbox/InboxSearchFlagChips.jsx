import { useState } from "react";
import { getSearchFlag, toggleReadStateFlag } from "./InboxSearchFlagChipsModel.js";

export default function InboxSearchFlagChips({
  query,
  onChange,
  accent = "#cba6da",
  compact = false,
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
        style={{
          height: compact ? "var(--sp-touch-min)" : 30,
          padding: compact ? "0 12px" : "0 10px",
          borderRadius: 999,
          border: `1px solid ${active ? `${accent}55` : hovered ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.08)"}`,
          background: active ? `${accent}1f` : hovered ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.03)",
          color: active ? "#fff" : "rgba(205,214,244,0.68)",
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
        Unread
      </button>
    </div>
  );
}
