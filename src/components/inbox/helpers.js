// laComponents/epochFromLa/DASHBOARD_TZ moved to lib/dashboard-helpers (P3's pure
// Pacific date-math consolidation). Import them so defaultSnoozeTs (P2) can use
// them locally; they are re-exported below for backward-compatible importers.
import { DASHBOARD_TZ, laComponents, epochFromLa } from "../../lib/dashboard-helpers";

export {
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
  isCatchUpEmail,
  makeSynthAccount,
  mergeReadState,
  pendingSecurityGraceLabel,
  readOverrideForUid,
} from "./inboxWorkItems.js";

export function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.max(0, (Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 7) return `${Math.round(days)}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Natural phrase variant — picks "5m ago" / "3h ago" / "5d ago" for recent
// timestamps and "on Apr 7" for anything older than a week. Avoids the
// "Triaged Apr 7 ago" grammar bug that comes from naively appending " ago".
export function timeSince(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.max(0, (Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  return `on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function timeClock(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// 9:00 AM the next day in DASHBOARD_TZ (Pacific), not the host's local time.
// The snooze picker anchors all its previews to DASHBOARD_TZ, so the default
// must too — otherwise a non-Pacific session snoozes to 9am wall-clock in the
// wrong zone. laComponents/epochFromLa are defined below; day+1 overflow is
// normalized by Date.UTC inside epochFromLa.
export function defaultSnoozeTs() {
  const c = laComponents(Date.now());
  return epochFromLa(c.year, c.month, c.day + 1, 9, 0);
}

// Build snooze presets from a caller-provided nowMs. The caller (SnoozePicker)
// re-renders this every minute so the fixed-duration preview labels stay
// accurate while the picker is open — no stale times after the user leaves
// the picker up for a while.
export function buildSnoozePresets(nowMs) {
  return [
    { key: "1h", label: "1 hour", at: nowMs + 3600_000 },
    { key: "6h", label: "6 hours", at: nowMs + 6 * 3600_000 },
    { key: "24h", label: "24 hours", at: nowMs + 24 * 3600_000 },
    { key: "3d", label: "3 days", at: nowMs + 3 * 24 * 3600_000 },
    { key: "1w", label: "1 week", at: nowMs + 7 * 24 * 3600_000 },
  ];
}

// DASHBOARD_TZ / laComponents / epochFromLa now live in src/lib/dashboard-helpers.ts
// (pure Pacific date math belongs in lib, not a component helper). Re-exported
// here for backward compatibility with existing inbox/calendar/todoist importers.
export { DASHBOARD_TZ, laComponents, epochFromLa };

// Place `panelW × panelH` relative to `anchorRect` with two-axis flip fallback.
// Vertical prefers below-anchor, flips to above if it'd overflow, clamps if
// neither fits. Horizontal prefers left-align with anchor, flips to right-
// align if overflowing, clamps as a last resort. This keeps the picker on
// screen whether the anchor is near the top, bottom, or right viewport edges.
export function computePlacement(anchorRect, panelW, panelH) {
  const margin = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = anchorRect.bottom + 6;
  if (top + panelH > vh - margin) {
    const above = anchorRect.top - panelH - 6;
    top = above >= margin ? above : Math.max(margin, vh - panelH - margin);
  }

  let left = anchorRect.left;
  if (left + panelW > vw - margin) {
    const rightAligned = anchorRect.right - panelW;
    left = rightAligned >= margin ? rightAligned : Math.max(margin, vw - panelW - margin);
  }

  return { top, left };
}
