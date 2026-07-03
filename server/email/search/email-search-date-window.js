const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

export function inferEmailSearchDateWindow(query, { now = Date.now() } = {}) {
  const text = clean(query);
  const nowMs = typeof now === "string" ? Date.parse(now) : Number(now);
  if (!Number.isFinite(nowMs)) return null;

  if (/\b(?:last|past)\s+(?:week|7\s+days?)\b/.test(text)) {
    return {
      after: isoFromMs(nowMs - 7 * DAY_MS),
      before: isoFromMs(nowMs),
    };
  }

  return null;
}

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pacificDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// A bare date in a planned window names a Pacific calendar day (the Alfred prompt
// anchors all dates to Pacific time), but email_date_utc stores UTC instants compared
// as strings — so both bounds must resolve to the UTC instant of the Pacific day edge,
// or `before` excludes every email sent on the named day (and evening Pacific mail
// lands on the next UTC day). The zone's offset is found by testing both possibilities
// (PDT -07 / PST -08) and keeping the instant that still falls on the named Pacific
// day — taking the max for the day's end and the min for its start keeps the DST
// fall-back double-hour on the right side.
function pacificDayEdgeUtc(bareDate, { end }) {
  const wall = end ? "23:59:59.999" : "00:00:00.000";
  const instants = ["-07:00", "-08:00"]
    .map((offset) => new Date(`${bareDate}T${wall}${offset}`))
    .filter((instant) => pacificDayFormatter.format(instant) === bareDate)
    .map((instant) => instant.getTime());
  if (!instants.length) return `${bareDate}T${wall}Z`;
  return new Date(end ? Math.max(...instants) : Math.min(...instants)).toISOString();
}

function normalizeWindowBound(value, { end }) {
  if (typeof value === "string" && BARE_DATE_RE.test(value)) return pacificDayEdgeUtc(value, { end });
  return value || null;
}

export function resolveEmailSearchDateWindow(query, plannedWindow, { now = Date.now() } = {}) {
  const inferred = inferEmailSearchDateWindow(query, { now });
  if (inferred) return inferred;
  if (plannedWindow?.after || plannedWindow?.before) {
    return {
      after: normalizeWindowBound(plannedWindow.after, { end: false }),
      before: normalizeWindowBound(plannedWindow.before, { end: true }),
    };
  }
  return null;
}
