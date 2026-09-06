// Helpers shared across the dashboard shell, hero, timeline, rails, and inbox.
// Kept small and pure so they can be unit-tested without a React tree.

import { epochFromLa } from "./dashboard-helpers";

export interface TimelineEvent {
  startMs?: number | null;
  endMs?: number | null;
  id?: unknown;
  iCalUID?: unknown;
  htmlLink?: unknown;
  openUrl?: unknown;
  title?: unknown;
  [key: string]: unknown;
}

export interface TimelineDeadline {
  due_date?: string | null;
  due_time?: unknown;
  [key: string]: unknown;
}

export interface TimelineBill {
  next_date?: string | null;
  [key: string]: unknown;
}

export type TimelineItem =
  | { kind: "event"; startMs: number; endMs: number | null | undefined; data: TimelineEvent; sortKey: number }
  | { kind: "deadline"; dueAtMs: number; data: TimelineDeadline; sortKey: number }
  | { kind: "bill"; dueAtMs: number; data: TimelineBill; sortKey: number };

interface LaneMetadata {
  key: string;
  label: string;
  color: string;
  soft: string;
  border: string;
  icon: string;
}

export const URGENCY_COLORS = {
  high: "#f38ba8",
  medium: "#f9e2af",
  low: "#cba6da",
};

export function urgencyForDays(days: number | null | undefined, accent = "#cba6da"): { key: "low" | "medium" | "high"; color: string } {
  if (days == null) return { key: "low", color: accent };
  if (days <= 0) return { key: "high", color: URGENCY_COLORS.high };
  if (days <= 2) return { key: "medium", color: URGENCY_COLORS.medium };
  return { key: "low", color: accent };
}

export function daysLabel(d: number | null | undefined): string {
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
export function overdueLabel(dueAtMs: number, now = Date.now()): string | null {
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

export function pacificClock(date = new Date()): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit",
  });
}

export function formatEventTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit",
  }).toLowerCase();
}

export function formatEventDuration(startMs: number | null | undefined, endMs: number | null | undefined): string {
  if (!endMs || !startMs) return "";
  const mins = Math.round((endMs - startMs) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Classify an event relative to now: past | live | future
export function eventState(ev: TimelineEvent | null | undefined, now = Date.now()): "past" | "live" | "future" {
  if (!ev) return "future";
  const end = ev.endMs ?? (ev.startMs ? ev.startMs + 30 * 60000 : now);
  const start = ev.startMs ?? now;
  if (end < now) return "past";
  if (start <= now && end > now) return "live";
  return "future";
}

export function getEventSelectionId(ev: TimelineEvent | null | undefined): string | null {
  if (!ev) return null;
  return String(
    ev.id
      || ev.iCalUID
      || ev.htmlLink
      || ev.openUrl
      || `${ev.startMs || 0}-${ev.endMs || 0}-${ev.title || "event"}`,
  );
}

// Module-level singleton so dayBucket (called once per timeline/hero item on
// every 30s tick) does not allocate a fresh Intl.DateTimeFormat per call.
const PACIFIC_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
});

// Bucket an instant-in-ms into a day offset relative to today (Pacific tz).
export function dayBucket(ms: number, now = Date.now()): number {
  const fmt = PACIFIC_YMD_FORMATTER;
  const todayYMD = fmt.format(new Date(now));
  const itemYMD = fmt.format(new Date(ms));
  const today = new Date(`${todayYMD}T12:00:00`).getTime();
  const item = new Date(`${itemYMD}T12:00:00`).getTime();
  return Math.round((item - today) / 86400000);
}

export function dayBucketLabel(offset: number, now = Date.now()): string {
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
export function dueDateToMs(dateStr: string | null | undefined, dueTime?: unknown): number | null {
  if (!dateStr) return null;
  // Anchor the wall-clock instant in Pacific time via the DST-aware epochFromLa,
  // instead of a fixed +7h UTC offset (which was an hour early all winter/PST).
  // (P3-15 fixed the same fixed-offset bug with a local pacificOffsetHours; resolved
  // onto the shared epochFromLa already used by buildTimeline below.)
  const dm = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const year = Number(dm[1]!);
  const month = Number(dm[2]!) - 1;
  const day = Number(dm[3]!);

  const t = String(dueTime || "").toLowerCase().trim();
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    return epochFromLa(year, month, day, 23, 59); // 11:59p PT fallback
  }
  let h = parseInt(match[1]!, 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (match[3] === "pm" && h < 12) h += 12;
  if (match[3] === "am" && h === 12) h = 0;
  return epochFromLa(year, month, day, h, m);
}

// Short 12h time for a chip tooltip: "2:00 PM" -> "2pm", "2:30 PM" -> "2:30pm".
// Null when there's no parseable time (bills carry no time).
function formatChipTime(dueTime: unknown): string | null {
  const m = String(dueTime || "").trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  const mer = m[3]!.toLowerCase();
  return mm === 0 ? `${h}${mer}` : `${h}:${String(mm).padStart(2, "0")}${mer}`;
}

// Date for a chip tooltip: "2026-06-21" -> "6/21/26" (short) or
// "Sunday, June 21" (long, matching the dashboard timeline's date labels).
function formatChipDate(dateStr: unknown, dateStyle: "short" | "long"): string | null {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  if (dateStyle === "long") {
    const year = Number(m[1]!);
    const month = Number(m[2]!) - 1;
    const day = Number(m[3]!);
    const date = new Date(Date.UTC(year, month, day, 12));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return date.toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "long", month: "long", day: "numeric",
    });
  }
  return `${Number(m[2]!)}/${Number(m[3]!)}/${m[1]!.slice(2)}`;
}

/**
 * Absolute date+time label for a relative-time chip's hover tooltip, or null for
 * no tooltip. A due-today item gets NO tooltip — its chip already reads "Due
 * today (· time)" / "Today", so repeating it adds nothing. Any other day reveals
 * the otherwise-hidden absolute date. The default short style renders
 * "6/21/26, 2pm"; the long style renders "Sunday, June 21, 2pm". Time is
 * omitted when absent. Null when due-today or no date is given.
 */
export function formatChipDateTime(
  dateStr: unknown,
  dueTime: unknown,
  isToday: boolean,
  dateStyle: "short" | "long" = "short",
): string | null {
  if (isToday) return null;
  const date = formatChipDate(dateStr, dateStyle);
  const time = formatChipTime(dueTime);
  if (!date) return time || null;
  return time ? `${date}, ${time}` : date;
}

// Build a unified chronological stream: events + deadlines + bills.
export function buildTimeline({
  events = [],
  deadlines = [],
  bills = [],
}: {
  events?: TimelineEvent[];
  deadlines?: TimelineDeadline[];
  bills?: TimelineBill[];
}): TimelineItem[] {
  const items: TimelineItem[] = [];
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
    const bm = String(b.next_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!bm) continue;
    // ~3pm Pacific, DST-aware (the old fixed 22:00Z was 2pm PST half the year).
    const ms = epochFromLa(Number(bm[1]!), Number(bm[2]!) - 1, Number(bm[3]!), 15, 0);
    items.push({ kind: "bill", dueAtMs: ms, data: b, sortKey: ms });
  }
  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

// Tri-color lane metadata for the inbox
export const LANE: Record<string, LaneMetadata> = {
  pinned: { key: "pinned", label: "Pinned", color: "#b4befe", soft: "rgba(180,190,254,0.10)", border: "rgba(180,190,254,0.22)", icon: "Pin" },
  queued: { key: "queued", label: "Queued", color: "#89b4fa", soft: "rgba(137,180,250,0.10)", border: "rgba(137,180,250,0.22)", icon: "Clock" },
  needs_attention: { key: "needs_attention", label: "Needs Attention", color: "#f38ba8", soft: "rgba(243,139,168,0.12)", border: "rgba(243,139,168,0.22)", icon: "Zap" },
  carryover: { key: "carryover", label: "Carryover", color: "#f9e2af", soft: "rgba(249,226,175,0.10)", border: "rgba(249,226,175,0.22)", icon: "History" },
  catch_up: { key: "catch_up", label: "Catch-up", color: "#cba6da", soft: "rgba(203,166,218,0.10)", border: "rgba(203,166,218,0.22)", icon: "MailOpen" },
  fyi:    { key: "fyi",    label: "FYI", color: "#89dceb", soft: "rgba(137,220,235,0.10)", border: "rgba(137,220,235,0.20)", icon: "FileText" },
  handled: { key: "handled", label: "Handled", color: "#a6e3a1", soft: "rgba(166,227,161,0.09)", border: "rgba(166,227,161,0.18)", icon: "Check" },
  untriaged_read: { key: "untriaged_read", label: "Untriaged Read", color: "#a6adc8", soft: "rgba(166,173,200,0.08)", border: "rgba(166,173,200,0.16)", icon: "MailOpen" },
  noise:  { key: "noise",  label: "Noise", color: "#6c7086", soft: "rgba(108,112,134,0.10)", border: "rgba(255,255,255,0.05)", icon: "BellOff" },
};
LANE.action = LANE.needs_attention!;
