export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const PACIFIC_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PACIFIC_TIME_FORMATTER_24 = new Intl.DateTimeFormat("en-GB", {
  timeZone: PACIFIC_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function pacificYMD(ms) {
  return PACIFIC_YMD_FORMATTER.format(new Date(ms));
}

export function pacificTime24(ms) {
  return PACIFIC_TIME_FORMATTER_24.format(new Date(ms));
}

export function ymdFromParts(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseYmd(value) {
  if (!value || typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

export function addDaysYmd(value, delta) {
  const parsed = parseYmd(value);
  if (!parsed) return value;
  const date = new Date(Date.UTC(parsed.year, parsed.month, parsed.day, 12));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenYmd(start, end) {
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (!a || !b) return 0;
  const startMs = Date.UTC(a.year, a.month, a.day);
  const endMs = Date.UTC(b.year, b.month, b.day);
  return Math.round((endMs - startMs) / 86400000);
}

export function monthKeyFromParts(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function getMonthData(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

export function getVisibleGridRange(year, month) {
  const { firstDay, daysInMonth } = getMonthData(year, month);
  const startDate = new Date(Date.UTC(year, month, 1, 12));
  startDate.setUTCDate(startDate.getUTCDate() - firstDay);
  const rowCount = Math.max(1, Math.ceil((firstDay + daysInMonth) / 7));
  const totalCells = rowCount * 7;
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + totalCells - 1);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    rowCount,
  };
}

// Range spanning the 6-week grids of [month - radius, month + radius], inclusive.
// The infinite-scroll grid mounts the active month ± 2, and bills render in every
// mounted month from one shared date-keyed map — so their data has to be fetched
// for that whole window at once. A single-month fetch (radius 0) leaves the outer
// mounted months blank, which is why chips vanished when scrolled out and back.
export function getMultiMonthGridRange(year, month, radius = 0) {
  // JS Date normalizes month under/overflow, so month ± radius crosses year
  // boundaries correctly even with the year held fixed.
  const { start } = getVisibleGridRange(year, month - radius);
  const { end } = getVisibleGridRange(year, month + radius);
  return { start, end };
}

export function sameYmdMonth(value, year, month) {
  const parsed = parseYmd(value);
  return !!parsed && parsed.year === year && parsed.month === month;
}

// {year, month (0-indexed), day} of "now" in Pacific — the calendar's today seed.
export function pacificTodayParts(now = new Date()) {
  return parseYmd(pacificYMD(now.getTime()));
}
