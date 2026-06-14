// Pure scheduling rule for the inbox `nowTick`.
//
// `nowTick` has two consumers, both of which only change at specific future
// moments — so instead of a blanket 30s interval we schedule a single timeout
// to the soonest one and idle otherwise:
//   1. the snooze sweep (`snoozeUntil > nowTick`) in visibleEmails /
//      mobileChipCounts / noiseUnreadCount — flips when a snooze boundary passes.
//   2. the pending-security-grace countdown label EmailRow derives in render from
//      `_pendingSecurityGraceAt + nowTick` — flips at the grace label buckets
//      (see pendingSecurityGraceLabel: classifyAt-120s, classifyAt-60s, classifyAt).
//
// Returns the ms delay until the soonest still-future boundary across BOTH
// consumers, capped at `maxDelayMs`, or `null` when nothing is pending (idle — no
// tick is scheduled so an inbox with no near-term snooze or grace transition never
// re-filters/re-renders).

export const NOW_TICK_MAX_DELAY_MS = 30_000;

// Offsets (ms before classifyAt) where pendingSecurityGraceLabel changes bucket.
const GRACE_BUCKET_OFFSETS = [120_000, 60_000, 0];

export function computeNextTickDelay(
  snoozedMap,
  rows,
  now = Date.now(),
  maxDelayMs = NOW_TICK_MAX_DELAY_MS,
) {
  let soonest = Infinity;

  if (snoozedMap) {
    for (const until of snoozedMap.values()) {
      if (until > now && until < soonest) soonest = until;
    }
  }

  for (const row of rows || []) {
    const classifyAt = row?._pendingSecurityGraceAt;
    if (!Number.isFinite(classifyAt)) continue;
    for (const offset of GRACE_BUCKET_OFFSETS) {
      const mark = classifyAt - offset;
      if (mark > now && mark < soonest) soonest = mark;
    }
  }

  if (soonest === Infinity) return null;
  return Math.min(Math.max(soonest - now, 0), maxDelayMs);
}
