export const urgencyStyles = {
  high: { bg: "rgba(243,139,168,0.06)", border: "#f38ba8", text: "#f38ba8", dot: "#f38ba8" },
  medium: { bg: "rgba(249,226,175,0.06)", border: "#f9e2af", text: "#f9e2af", dot: "#f9e2af" },
  low: { bg: "rgba(108,112,134,0.06)", border: "#6c7086", text: "#a6adc8", dot: "#6c7086" },
};

export const typeLabels = {
  transfer: { label: "Card Payment", color: "#b4befe", icon: "\u{1F4B3}" },
  bill: { label: "Recurring Bill", color: "#a6e3a1", icon: "\u{1F4C4}" },
  expense: { label: "One-time Expense", color: "#fab387", icon: "\u{1F6D2}" },
  income: { label: "Income", color: "#89dceb", icon: "\u{1F4B0}" },
};

const TZ = "America/Los_Angeles";

export interface PacificDateTimeComponents {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface TimeAgoOptions {
  compact?: boolean;
}

// Get today's date string (YYYY-MM-DD) in Pacific time
export function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// Convert any date string to YYYY-MM-DD in Pacific time
// Handles "2026-03-29T06:59:59Z" → "2026-03-28" (the Pacific date, not UTC)
// and plain "2026-03-28" → "2026-03-28" (pass-through)
export function toPacificDate(dateStr: string): string;
export function toPacificDate(dateStr: null): null;
export function toPacificDate(dateStr: undefined): undefined;
export function toPacificDate(dateStr: string | null | undefined): string | null | undefined {
  if (!dateStr) return dateStr;
  // Only treat as ISO timestamp if it matches "YYYY-MM-DDTHH" pattern
  if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(dateStr));
  }
  // Plain date "2026-03-28" or human-readable string — return as-is
  return dateStr.slice(0, 10);
}

// Canonical fixed timezone for the dashboard (alias kept for inbox importers).
export const DASHBOARD_TZ = TZ;

// Read {year, month, day, hour, minute} of an epoch-ms value in Pacific time.
// Month is 0-indexed to match JS Date conventions. Hour normalizes a rare "24"
// result some locales emit at midnight with hour12:false. Pure date math — lives
// in lib so both src/lib and src/components share one DST-aware Pacific helper.
export function laComponents(epochMs: number): PacificDateTimeComponents {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric",
    // h23 forces 00-23 output (instead of 1-24 in some Safari builds).
    hourCycle: "h23",
  });
  const out: Partial<Record<"year" | "month" | "day" | "hour" | "minute", number>> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type === "year" || p.type === "month" || p.type === "day" || p.type === "hour" || p.type === "minute") {
      out[p.type] = Number(p.value);
    }
  }
  return {
    year: out.year!,
    month: out.month! - 1,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
  };
}

// Inverse of laComponents: epoch ms whose Pacific representation is the given
// components. Two-pass drift correction handles DST boundaries where a single
// pass would be off by 60 minutes.
export function epochFromLa(year: number, month: number, day: number, hour: number, minute: number): number {
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

export function parseDueDate(dateStr?: string | null): Date {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return new Date(NaN);
  if (!/T/.test(dateStr)) return new Date(dateStr + "T12:00:00");
  return new Date(dateStr);
}

export function formatFullDate(dateStr?: string | null): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr || "";
  const hasTime = /T\d{2}:\d{2}/.test(dateStr) && !/T00:00:00/.test(dateStr) && !/T12:00:00/.test(dateStr);
  if (hasTime) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
    });
  }
  // Date-only: use toPacificDate to avoid UTC shift, then format from the Pacific date
  const pacificStr = toPacificDate(dateStr);
  const d = new Date(pacificStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: TZ,
  });
}

export function formatRelativeDate(dateStr?: string | null): string | null | undefined {
  if (!dateStr) return dateStr;
  // If not a parseable date (e.g. "Tomorrow EOD"), return as-is
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
  const todayStr = todayPacific();
  const dueStr = toPacificDate(dateStr);
  // Compare as date strings to avoid timezone drift
  const todayMs = new Date(todayStr + "T12:00:00").getTime();
  const dueMs = new Date(dueStr + "T12:00:00").getTime();
  const diff = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `Overdue (${Math.abs(diff)}d)`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const due = new Date(dueStr + "T12:00:00");
  if (diff < 6) return due.toLocaleDateString("en-US", { weekday: "long", timeZone: TZ });
  return due.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: TZ });
}

export function timeAgo(
  input: string | number | Date | null | undefined,
  { compact = false }: TimeAgoOptions = {},
): string | null {
  if (!input) return null;
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime();
  const diff = Date.now() - ts;
  if (compact) {
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatShortTime(isoString?: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
  });
}

export const greetingPools = [
  { name: "Late Night", max: 5, greetings: [
    "Burning the midnight oil.", "The world sleeps, but not you.", "Night owl mode activated.",
    "Stars are out, and so are you.", "Late nights build empires.", "Silence is productive.",
    "The quiet hours suit you.", "Another late one — respect.", "Peak focus time.",
    "Nothing good happens before 5 AM — except this.",
  ]},
  { name: "Morning", max: 12, greetings: [
    "Good morning.", "Rise and shine.", "Fresh start today.", "Morning sunshine.",
    "Let's make today count.", "Coffee first, then the world.", "New day, new priorities.",
    "Up and at it.", "The early hours are yours.", "Ready to seize the day.",
  ]},
  { name: "Afternoon", max: 15, greetings: [
    "Good afternoon.", "Midday check-in.", "Halfway through the day.", "Afternoon reset.",
    "How's the day shaping up?", "Keeping the momentum.", "Cruising through the afternoon.",
    "Lunchtime debrief.", "The day's in full swing.", "Steady as she goes.",
  ]},
  { name: "Evening", max: 21, greetings: [
    "Good evening.", "Winding down.", "Evening debrief time.", "Day's almost done.",
    "Home stretch.", "Wrapping things up.", "Evening vibes.", "Golden hour briefing.",
    "Sunset check-in.", "Almost there.",
  ]},
  { name: "Night", max: 24, greetings: [
    "Nearing the finish line.", "Night mode engaged.", "Quiet hours ahead.",
    "One last look before bed.", "Closing out the day.", "Nightcap briefing.",
    "The day is yours to review.", "Rest is on the horizon.", "Final thoughts for today.",
    "Lights dimming soon.",
  ]},
] as const;

export function getGreeting(scheduleLabel?: string | null): { label: string; greeting: string } {
  const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()), 10);
  const pool = greetingPools.find(p => hour < p.max) || greetingPools[greetingPools.length - 1]!;
  const greeting = pool.greetings[Math.floor(Math.random() * pool.greetings.length)]!;
  const label = scheduleLabel ? `${scheduleLabel} Briefing` : `${pool.name} Briefing`;
  return { label, greeting };
}
