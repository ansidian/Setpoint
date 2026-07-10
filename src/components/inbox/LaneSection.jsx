import { memo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { StickyHeader, LaneIcon } from "./primitives";

// One swimlane lane section: sticky header (icon, label, count, optional
// noise-unread pill, chevron) plus the expanded row body. Memoized as a render
// boundary so a lane with referentially-stable props can skip re-rendering when
// other lanes change. `renderRows` is passed in so the row markup stays owned by
// InboxList — callers must pass a stable renderRows (see InboxList.jsx) or this
// memo boundary is defeated.
function LaneSection({ laneKey, emails, collapsed, noiseUnreadCount, onToggle, renderRows }) {
  return (
    <div>
      <StickyHeader borderColor="rgba(255,255,255,0.03)">
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggle(laneKey)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(laneKey); }}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            cursor: "pointer", background: "transparent", border: "none",
            fontFamily: "inherit", color: "inherit", padding: 0,
          }}
        >
          <span style={{ flexShrink: 0, display: "inline-flex" }}>
            <LaneIcon laneKey={laneKey} />
          </span>
          <span
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase", color: laneKey === "noise" ? "var(--color-text-faint)" : LANE[laneKey].color,
              minWidth: 0, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {LANE[laneKey].label}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
              background: LANE[laneKey].soft, color: laneKey === "noise" ? "var(--color-text-faint)" : `${LANE[laneKey].color}cc`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {emails.length}
          </span>
          {laneKey === "noise" && noiseUnreadCount > 0 && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 650,
                padding: "2px 6px",
                borderRadius: 999,
                background: "rgba(205,214,244,0.07)",
                border: "1px solid rgba(205,214,244,0.12)",
                color: "rgba(205,214,244,0.58)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {noiseUnreadCount} unread
            </span>
          )}
          <span style={{ flex: 1 }} />
          {collapsed ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
        </div>
      </StickyHeader>
      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {renderRows(emails)}
        </div>
      )}
    </div>
  );
}

export default memo(LaneSection);
