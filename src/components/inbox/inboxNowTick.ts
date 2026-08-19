// Pure scheduling rule for the inbox `nowTick`.
//
// `nowTick` has two consumers, both of which only change at specific future
// moments — so instead of a blanket 30s interval we schedule a single timeout
// to the soonest one and idle otherwise:
//   1. the snooze sweep (`snoozeUntil > nowTick`) in visibleEmails /
//      mobileChipCounts / noiseUnreadCount — flips when a snooze boundary passes.
//   2. verification-code row markers, which disappear at `active_until`.
//
// Returns the ms delay until the soonest still-future boundary across all
// consumers, capped at `maxDelayMs`, or `null` when nothing is pending (idle — no
// tick is scheduled so an inbox with no near-term snooze or code transition never
// re-filters/re-renders).

export const NOW_TICK_MAX_DELAY_MS = 30_000;

export function computeNextTickDelay(
  snoozedMap: ReadonlyMap<string, number> | null | undefined,
  rows: InboxEmailLike[] | null | undefined,
  now: number = Date.now(),
  maxDelayMs: number = NOW_TICK_MAX_DELAY_MS,
): number | null {
  let soonest = Infinity;

  if (snoozedMap) {
    for (const until of snoozedMap.values()) {
      if (until > now && until < soonest) soonest = until;
    }
  }

  for (const row of rows || []) {
    const verificationCodeActiveUntil = Date.parse(row?.verification_code?.active_until || "");
    if (Number.isFinite(verificationCodeActiveUntil)
      && verificationCodeActiveUntil > now
      && verificationCodeActiveUntil < soonest) {
      soonest = verificationCodeActiveUntil;
    }
  }

  if (soonest === Infinity) return null;
  return Math.min(Math.max(soonest - now, 0), maxDelayMs);
}
import type { InboxEmailLike } from "./inboxTypes";
