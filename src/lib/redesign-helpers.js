// Helpers shared across the redesigned shell, hero, timeline, rails, and inbox.
// Kept small and pure so they can be unit-tested without a React tree.

import { greetingPools } from "./dashboard-helpers";

export const URGENCY_COLORS = {
  high: "#f38ba8",
  medium: "#f9e2af",
  low: "#cba6da",
};

export function urgencyForDays(days, accent = "#cba6da") {
  if (days == null) return { key: "low", color: accent };
  if (days <= 0) return { key: "high", color: URGENCY_COLORS.high };
  if (days <= 2) return { key: "medium", color: URGENCY_COLORS.medium };
  return { key: "low", color: accent };
}

export function daysLabel(d) {
  if (d == null || Number.isNaN(d)) return "—";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  return `${d}d`;
}

// Granular overdue label for an item with a due timestamp. Returns null if not
// overdue. Unit breakpoints: <60min → "Nmin", <24h → "Nh", <30d → "Nd",
// otherwise "Nmo". "mo" disambiguates months from minutes.
export function overdueLabel(dueAtMs, now = Date.now()) {
  if (!Number.isFinite(dueAtMs)) return null;
  const ms = now - dueAtMs;
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min overdue`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h overdue`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d overdue`;
  const mo = Math.floor(d / 30);
  return `${mo}mo overdue`;
}

export function phaseIndex(date = new Date()) {
  const hour = parseInt(date.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", hour12: false,
  }), 10);
  if (hour < 5)  return 0; // late night
  if (hour < 12) return 1; // morning
  if (hour < 17) return 2; // afternoon
  if (hour < 21) return 3; // evening
  return 4;                // night
}

const BRIEFING_PHASE_PHRASES = [
  "Since last night's briefing",
  "Since this morning's briefing",
  "Since this afternoon's briefing",
  "Since this evening's briefing",
  "Since tonight's briefing",
];

export function briefingPhaseLabel(ts) {
  if (ts == null) return "Since last briefing";
  return BRIEFING_PHASE_PHRASES[phaseIndex(new Date(ts))];
}

function stableIndex(date, len) {
  const day = date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const key = `${day}-${phaseIndex(date)}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % len;
}

const PHASE_LABELS = ["Late night", "Good morning", "Good afternoon", "Good evening", "Tonight"];

// eslint-disable-next-line no-unused-vars
export function greetingFor(date = new Date(), name = "") {
  const idx = phaseIndex(date);
  const pool = greetingPools[idx] ?? greetingPools[0];
  const text = pool.greetings[stableIndex(date, pool.greetings.length)];
  return { label: PHASE_LABELS[idx], text };
}

export function pacificClock(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit",
  });
}

export function pacificDate(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric",
  });
}

export function formatEventTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit",
  }).toLowerCase();
}

export function formatEventDuration(startMs, endMs) {
  if (!endMs || !startMs) return "";
  const mins = Math.round((endMs - startMs) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDuration(durationMin) {
  if (durationMin < 60) return `${durationMin} min`;
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

// Classify an event relative to now: past | live | future
export function eventState(ev, now = Date.now()) {
  if (!ev) return "future";
  const end = ev.endMs ?? (ev.startMs ? ev.startMs + 30 * 60000 : now);
  const start = ev.startMs ?? now;
  if (end < now) return "past";
  if (start <= now && end > now) return "live";
  return "future";
}

export function getEventSelectionId(ev) {
  if (!ev) return null;
  return String(
    ev.id
      || ev.iCalUID
      || ev.htmlLink
      || ev.openUrl
      || `${ev.startMs || 0}-${ev.endMs || 0}-${ev.title || "event"}`,
  );
}

// Bucket an instant-in-ms into a day offset relative to today (Pacific tz).
export function dayBucket(ms, now = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const todayYMD = fmt.format(new Date(now));
  const itemYMD = fmt.format(new Date(ms));
  const today = new Date(`${todayYMD}T12:00:00`).getTime();
  const item = new Date(`${itemYMD}T12:00:00`).getTime();
  return Math.round((item - today) / 86400000);
}

export function dayBucketLabel(offset, now = Date.now()) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  if (offset < 0) return `${Math.abs(offset)}d ago`;
  if (offset < 7) return `In ${offset} days`;
  const ms = now + offset * 86400000;
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric",
  });
}

// Parse a due_time string like "7pm", "11:59pm", "5pm", "EOD" and combine with
// a YYYY-MM-DD date to produce an absolute epoch ms. Falls back to 11:59pm PT.
export function dueDateToMs(dateStr, dueTime) {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T07:00:00Z`); // midnight PT ≈ 07:00Z (ignoring DST precision)
  if (Number.isNaN(base.getTime())) return null;

  const t = String(dueTime || "").toLowerCase().trim();
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    base.setUTCHours(7 + 23, 59, 0, 0); // 11:59p PT fallback
    return base.getTime();
  }
  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (match[3] === "pm" && h < 12) h += 12;
  if (match[3] === "am" && h === 12) h = 0;
  base.setUTCHours(7 + h, m, 0, 0);
  return base.getTime();
}

// Build a unified chronological stream: events + deadlines + bills.
export function buildTimeline({ events = [], deadlines = [], bills = [] }) {
  const items = [];
  for (const ev of events) {
    if (!ev.startMs) continue;
    items.push({ kind: "event", startMs: ev.startMs, endMs: ev.endMs, data: ev, sortKey: ev.startMs });
  }
  for (const d of deadlines) {
    const ms = dueDateToMs(d.due_date, d.due_time);
    if (ms == null) continue;
    items.push({ kind: "deadline", dueAtMs: ms, data: d, sortKey: ms });
  }
  for (const b of bills) {
    if (!b.next_date) continue;
    const ms = new Date(`${b.next_date}T22:00:00Z`).getTime(); // ~3pm PT
    items.push({ kind: "bill", dueAtMs: ms, data: b, sortKey: ms });
  }
  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

// Tri-color lane metadata for the inbox
export const LANE = {
  action: { key: "action", label: "Needs you", color: "#f38ba8", soft: "rgba(243,139,168,0.12)", border: "rgba(243,139,168,0.22)", icon: "Zap" },
  fyi:    { key: "fyi",    label: "For your info", color: "#89dceb", soft: "rgba(137,220,235,0.10)", border: "rgba(137,220,235,0.20)", icon: "FileText" },
  noise:  { key: "noise",  label: "Noise",        color: "#6c7086", soft: "rgba(108,112,134,0.10)", border: "rgba(255,255,255,0.05)", icon: "BellOff" },
};

// Derive a lane from an email's existing fields (briefing already triages into
// important[] vs noise[], and urgency lives on each email).
export function deriveLane(email) {
  if (!email) return "fyi";
  if (email.lane) return email.lane;
  if (email._lane) return email._lane;
  if (email.urgency === "high" || email.urgentFlag) return "action";
  if (email.noise) return "noise";
  return "fyi";
}

export function hexOpacity(hex, alpha) {
  // Append a 2-digit alpha suffix to a #RRGGBB color.
  const clamped = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${hex}${clamped.toString(16).padStart(2, "0")}`;
}
