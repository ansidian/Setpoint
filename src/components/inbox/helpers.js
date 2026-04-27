import { deriveLane } from "../../lib/redesign-helpers";

// Build a `synthAccount(source)` function bound to the briefing's emailAccounts.
// Matches a live/resurfaced/pin-snapshot entry's account_label to an existing
// briefing account so the sidebar groups them correctly, else synthesizes a
// minimal account record. Built once per flatEmails recompute so the inner
// lookup can be a Map get.
export function makeSynthAccount(emailAccounts) {
  const accountByName = new Map(emailAccounts.map((a) => [a.name, a]));
  return (source) => accountByName.get(source.account_label) || {
    name: source.account_label || "Live",
    color: source.account_color || "#89b4fa",
    icon: source.account_icon || "Mail",
    important: [],
    noise: [],
  };
}

export function readOverrideForUid(readOverrides, uid) {
  if (!uid || !readOverrides) return null;
  if (readOverrides instanceof Map) {
    return readOverrides.has(uid) ? readOverrides.get(uid) : null;
  }
  return Object.prototype.hasOwnProperty.call(readOverrides, uid)
    ? readOverrides[uid]
    : null;
}

export function mergeReadState(read, uid, readOverrides) {
  const override = readOverrideForUid(readOverrides, uid);
  return override == null ? !!read : !!override;
}

// Flatten briefing emailAccounts into email entries tagged with account
// reference and lane. Important is iterated before noise so a uid appearing
// in both wins the important lane (dedup is handled by the caller).
export function collectBriefingEmails(emailAccounts) {
  const out = [];
  for (const acc of emailAccounts) {
    const accountKey = acc.id || acc.name;
    for (const e of acc.important || []) {
      out.push({
        ...e,
        _accountKey: accountKey,
        _account: acc,
        _lane: deriveLane(e),
        _untriaged: false,
      });
    }
    for (const e of acc.noise || []) {
      out.push({
        ...e,
        _accountKey: accountKey,
        _account: acc,
        _lane: "noise",
        _untriaged: false,
      });
    }
  }
  return out;
}

// Build entries for live-polled emails (arrived after last briefing, not yet
// triaged by the latest briefing). Merges resurfaced metadata when a live uid is also
// present in resurfacedMap — Gmail's `newer_than:Nh` poll re-fetches
// recently-woken snoozes on its own; without this merge the live entry wins
// dedup and the Snoozed badge / wake-time sort would be lost.
export function collectLiveEmails(liveEmails, synthAccount, liveTrashedUids, liveReadOverrides, resurfacedMap) {
  const out = [];
  for (const e of liveEmails) {
    if (liveTrashedUids.has(e.uid)) continue;
    const acc = synthAccount(e);
    const resurfacedHit = resurfacedMap.get(e.uid);
    out.push({
      ...e,
      id: e.id || e.uid,
      preview: e.preview || e.body_preview || "",
      fromEmail: e.fromEmail || e.from_email,
      read: mergeReadState(e.read, e.uid, liveReadOverrides),
      _accountKey: acc.id || acc.name,
      _account: acc,
      _lane: null,
      _untriaged: true,
      _live: true,
      ...(resurfacedHit ? { _resurfaced: true, _resurfacedAt: resurfacedHit.resurfaced_at } : null),
    });
  }
  return out;
}

// Inject resurfaced snapshots (snooze woke up). Gmail's live-poll filter
// uses original internalDate so these wouldn't reach the inbox on their own.
// Caller dedups against previously-collected sources; this drops entries with
// no key or that the user has locally trashed.
export function collectResurfaced(resurfacedMap, synthAccount, liveReadOverrides, liveTrashedUids) {
  const out = [];
  for (const entry of resurfacedMap.values()) {
    const snap = entry.snapshot;
    const key = snap?.uid || snap?.id;
    if (!key) continue;
    if (liveTrashedUids.has(key)) continue;
    const acc = synthAccount(snap);
    out.push({
      ...snap,
      id: snap.id || snap.uid,
      preview: snap.preview || snap.body_preview || "",
      fromEmail: snap.fromEmail || snap.from_email,
      // entry.read is Gmail's current UNREAD state as of this poll (server-side
      // probe). A session override wins in both directions so mark-unread and
      // re-read actions stay visible before the next live poll lands.
      read: mergeReadState(entry.read, key, liveReadOverrides),
      _accountKey: acc.id || acc.name,
      _account: acc,
      _lane: null,
      _untriaged: true,
      _live: true,
      _resurfaced: true,
      _resurfacedAt: entry.resurfaced_at,
    });
  }
  return out;
}

// Inject pin snapshots for emails that have aged out of the briefing/live
// window so a pinned email keeps rendering. Caller dedups on uid — if the
// email is already in a fresher source (briefing/live), that version wins.
export function collectPinSnapshots(pinnedSnapshotMap, synthAccount) {
  const out = [];
  for (const snap of pinnedSnapshotMap.values()) {
    const key = snap.uid || snap.id;
    if (!key) continue;
    const acc = synthAccount(snap);
    out.push({
      ...snap,
      id: snap.id || snap.uid,
      preview: snap.preview || snap.body_preview || "",
      fromEmail: snap.fromEmail || snap.from_email,
      _accountKey: acc.id || acc.name,
      _account: acc,
      _lane: snap._lane || deriveLane(snap),
      _untriaged: false,
      _fromPinSnapshot: true,
    });
  }
  return out;
}

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
