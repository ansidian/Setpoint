// src/components/news/newsPageModel.js
// Client-side view rules for the News tab. The server shapes the payload;
// this module owns only presentation splits that depend on visit state.

export function splitItemsBySeen(items, dividerAt) {
  if (!dividerAt) return { fresh: [], older: [...items] };
  const fresh = [];
  const older = [];
  for (const item of items) {
    if (item.publishedAt && item.publishedAt > dividerAt) fresh.push(item);
    else older.push(item);
  }
  return { fresh, older };
}

// The divider must not move while the owner is mid-scan: hold the first
// non-null server marker for the whole visit; background refetches keep it.
export function resolveDividerMarker(payloadLastSeenAt, heldMarker) {
  return heldMarker ?? payloadLastSeenAt ?? null;
}

// Link-aggregator feeds put boilerplate where an excerpt should be — hnrss's
// "Article URL: … Comments URL: …", reddit's "submitted by /u/… [link]
// [comments]"; both read as junk under a headline.
export function displayExcerpt(excerpt) {
  if (!excerpt) return "";
  if (/^\s*Article URL:/i.test(excerpt)) return "";
  if (/^\s*submitted by\s/i.test(excerpt)) return "";
  return excerpt;
}

const FAILING_THRESHOLD = 5;

export function describeSourceHealth(source) {
  const failures = source?.consecutiveFailures || 0;
  if (failures < FAILING_THRESHOLD) return { failing: false, label: null };
  const status = source?.lastStatus || "error";
  const prefix = /^\d+$/.test(status) ? `HTTP ${status}` : status;
  return { failing: true, label: `${prefix} · failing` };
}
