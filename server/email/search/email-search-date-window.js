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

export function resolveEmailSearchDateWindow(query, plannedWindow, { now = Date.now() } = {}) {
  const inferred = inferEmailSearchDateWindow(query, { now });
  if (inferred) return inferred;
  if (plannedWindow?.after || plannedWindow?.before) {
    return {
      after: plannedWindow.after || null,
      before: plannedWindow.before || null,
    };
  }
  return null;
}
