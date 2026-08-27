import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CircleHelp } from "lucide-react";
import type { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { LANE } from "../../lib/shell-helpers";
import Tooltip from "../shared/Tooltip";
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

const SPECIAL_LANES = [
  { label: "Queued", description: "New mail waiting briefly for automatic triage." },
  { label: "Carryover", description: "Unfinished Needs Attention mail from the previous snapshot." },
  { label: "Catch-up", description: "Unread FYI mail from the previous snapshot, shown here read-only." },
  { label: "Handled", description: "Mail you marked done; reopen it to restore its prior lane." },
  { label: "Untriaged Read", description: "Mail read before triage, so automatic classification was skipped." },
] as const;
const SPECIAL_LANE_DESCRIPTION = SPECIAL_LANES
  .map((lane) => `${lane.label}: ${lane.description}`)
  .join(" ");

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

function LaneGlossaryTooltip() {
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const tooltipActionsRef = useRef<TooltipPrimitive.Root.Actions | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setDisabled(document.documentElement.dataset.activeTab !== "inbox");
    });
    const dismiss = (event: Event) => {
      const nextTab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      setDisabled(nextTab !== "inbox");
      tooltipActionsRef.current?.unmount();
      setOpen(false);
    };
    window.addEventListener("ea-dashboard-tab-change", dismiss);
    return () => {
      active = false;
      window.removeEventListener("ea-dashboard-tab-change", dismiss);
    };
  }, []);

  return (
    <Tooltip
      actionsRef={tooltipActionsRef}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
      style={{ flexShrink: 0 }}
      side="bottom"
      sideOffset={8}
      delay={250}
      closeDelay={120}
      disableHoverablePopup={false}
      contentStyle={{
        "--foreground": "#16161e",
        "--background": "#cdd6f4",
        width: 320,
        maxWidth: "min(320px, calc(100vw - 24px))",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 10,
        padding: 12,
        border: "1px solid rgba(205,214,244,0.12)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        color: "#cdd6f4",
      } as CSSProperties}
      text={(
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2 }}>Special lanes</div>
          <div style={{ display: "grid", gap: 8 }}>
            {SPECIAL_LANES.map((lane) => (
              <div key={lane.label} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff" }}>{lane.label}</span>
                <span style={{ fontSize: 10.5, lineHeight: 1.45, color: "rgba(205,214,244,0.72)" }}>
                  {lane.description}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    >
      <button
        type="button"
        aria-label="About inbox lanes"
        aria-description={SPECIAL_LANE_DESCRIPTION}
        className="sp-focus-ring transition-[transform,background-color,border-color,color] duration-150 hover:-translate-y-px hover:border-white/15 hover:bg-white/[0.07] hover:text-[rgba(205,214,244,0.88)] active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 999,
          border: "1px solid rgba(205,214,244,0.10)",
          background: "rgba(205,214,244,0.04)",
          color: "rgba(205,214,244,0.56)",
          cursor: "help",
        }}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
    </Tooltip>
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
        gap: 8,
        padding: "7px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
      } as CSSProperties}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          overflowX: "auto",
          scrollbarWidth: "none",
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
      <span style={{ flex: 1 }} />
      <LaneGlossaryTooltip />
    </div>
  );
}
