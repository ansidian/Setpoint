const TZ = "America/Los_Angeles";

export interface PacificDateTimeComponents {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
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
