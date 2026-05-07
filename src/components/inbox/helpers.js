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

export function defaultSnoozeTs() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return t.getTime();
}

// Build snooze presets from a caller-provided nowMs. The caller (SnoozePicker)
// re-renders this every minute so the "+6h" / "+24h" preview labels stay
// accurate while the picker is open — no stale times after the user leaves
// the picker up for a while.
export function buildSnoozePresets(nowMs) {
  return [
    { key: "6h", label: "6 hours", at: nowMs + 6 * 3600_000 },
    { key: "24h", label: "24 hours", at: nowMs + 24 * 3600_000 },
  ];
}

// Canonical timezone for the dashboard — matches the default weather location
// (El Monte, CA). Anchoring the snooze picker to a fixed TZ avoids drift if
// the page is rendered from a non-local environment (cloud dev, proxy, etc.).
export const DASHBOARD_TZ = "America/Los_Angeles";

// Read {year, month, day, hour, minute} of an epoch-ms value in DASHBOARD_TZ.
// Month is 0-indexed to match JS Date conventions. Hour normalizes a rare
// "24" result some locales emit at midnight with hour12:false.
export function laComponents(epochMs) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TZ,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric",
    // h23 forces 00-23 output (instead of 1-24 in some Safari builds). Sidesteps
    // the rare "24" edge case — but we keep the == 24 guard below as a fallback.
    hourCycle: "h23",
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month - 1,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
  };
}

// Inverse of laComponents: epoch ms whose DASHBOARD_TZ representation is the
// given components. Two-pass drift correction handles DST boundaries where a
// single pass would be off by 60 minutes.
export function epochFromLa(year, month, day, hour, minute) {
  const target = Date.UTC(year, month, day, hour, minute, 0);
  let epoch = target;
  for (let pass = 0; pass < 2; pass++) {
    const actual = laComponents(epoch);
    const actualUtc = Date.UTC(actual.year, actual.month, actual.day, actual.hour, actual.minute);
    const drift = target - actualUtc;
    if (drift === 0) break;
    epoch += drift;
  }
  return epoch;
}

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
