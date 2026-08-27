import type { CSSProperties } from "react";
import { LANE } from "../../lib/shell-helpers";
import { PRIMARY_INBOX_LANES } from "./inboxCountsModel";

type LaneCounts = Record<string, number | undefined>;

const ALL_LANES = [
  "queued",
  "carryover",
  "needs_attention",
  "catch_up",
  "fyi",
  "handled",
  "untriaged_read",
  "noise",
] as const;

function totalLaneCount(counts: LaneCounts): number {
  return ALL_LANES.reduce((total, key) => total + (counts[key] || 0), 0);
}

function LaneFilterChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        flexShrink: 0,
        minHeight: 26,
        padding: typeof count === "number" ? "3px 7px 3px 9px" : "3px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? `color-mix(in srgb, ${color} 38%, transparent)` : `color-mix(in srgb, ${color} 20%, transparent)`}`,
        background: active
          ? `color-mix(in srgb, ${color} 16%, transparent)`
          : `color-mix(in srgb, ${color} 7%, transparent)`,
        color: active ? "#fff" : "rgba(205,214,244,0.76)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10,
        fontWeight: 650,
        whiteSpace: "nowrap",
      }}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          aria-hidden="true"
          style={{
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: `color-mix(in srgb, ${color} ${active ? 24 : 13}%, transparent)`,
            color,
            fontSize: 8.5,
            fontWeight: 750,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function InboxLaneFilterBar({
  accent,
  activeLane,
  counts,
  onChange,
}: {
  accent: string;
  activeLane: string;
  counts: LaneCounts;
  onChange: (lane: string) => void;
}) {
  const allCount = totalLaneCount(counts);
  if (allCount < 1) return null;

  return (
    <div
      role="toolbar"
      aria-label="Triage lanes"
      data-testid="inbox-lane-filter-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        overflowX: "auto",
        scrollbarWidth: "none",
        flexShrink: 0,
      } as CSSProperties}
    >
      <LaneFilterChip
        label="All"
        color={accent}
        active={activeLane === "__all"}
        onClick={() => onChange("__all")}
      />
      {PRIMARY_INBOX_LANES.map((key) => {
        const count = counts[key] || 0;
        if (count < 1) return null;
        const metadata = LANE[key] ?? LANE.fyi!;
        return (
          <LaneFilterChip
            key={key}
            label={metadata.label}
            count={count}
            color={metadata.color}
            active={activeLane === key}
            onClick={() => onChange(key)}
          />
        );
      })}
    </div>
  );
}
