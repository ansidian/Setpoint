import type { CSSProperties } from "react";
import { Clock, Mail } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { LaneIcon } from "./primitives";

const PRIMARY_LANES = ["needs_attention", "fyi", "noise", "snoozed", "handled"] as const;
const SECONDARY_LANES = ["queued", "catch_up", "untriaged_read"] as const;

export default function InboxLaneFilterBar({ accent, activeLane, counts, onChange }: {
  accent: string;
  activeLane: string;
  counts: Record<string, number | undefined>;
  onChange: (lane: string) => void;
}) {
  const allCount = [...PRIMARY_LANES, ...SECONDARY_LANES]
    .filter((key) => key !== "snoozed")
    .reduce((total, key) => total + (counts[key] || 0), 0);
  const renderLane = (key: string) => {
    const metadata = LANE[key];
    const count = key === "__all" ? counts.__all ?? allCount : counts[key] || 0;
    const color = key === "snoozed" ? "#f4bb86" : metadata?.color || accent;
    const label = key === "__all" ? "All mail" : key === "snoozed" ? "Snoozed" : metadata?.label || key;
    return <button
      key={key}
      type="button"
      className="inbox-a-lane-link"
      aria-pressed={activeLane === key}
      onClick={() => onChange(key)}
      style={{ "--inbox-lane-color": color } as CSSProperties}
    >
      {key === "__all" ? <Mail size={15} /> : key === "snoozed" ? <Clock size={15} /> : <LaneIcon laneKey={key} />}
      <span>{label}</span>
      <span className="inbox-a-lane-count">{count}</span>
    </button>;
  };
  const secondary = SECONDARY_LANES.filter((key) => (counts[key] || 0) > 0 || activeLane === key);
  return (
    <div role="toolbar" aria-label="Triage lanes" data-testid="inbox-lane-filter-bar" className="inbox-a-lanes">
      {renderLane("__all")}
      {PRIMARY_LANES.map(renderLane)}
      {secondary.length > 0 && <div className="inbox-a-secondary-lanes">{secondary.map(renderLane)}</div>}
    </div>
  );
}
