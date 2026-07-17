// Decides whether a READER (the ~2s dashboard poll, calendar bill reads) should
// kick an IMMEDIATE bills-mirror refresh on seeing state === 'needs_sync'.
//
// A write (sendBill / markBillPaid / createQuickTxn) sets a future
// pending_refresh_at — the deliberate ~60s settle window — so the Actual server
// can propagate the write before the local mirror re-downloads. If a reader
// rescheduled with the default delayMs:0, scheduleBillsMirrorRefresh's
// ON CONFLICT MIN(new, existing) would pull that pending time back to now and
// fire immediately, defeating the settle and re-downloading a stale mirror (the
// just-sent bill missing for up to the 6h maintenance TTL). So: only schedule
// when there is no still-future pending refresh already armed (P1-5).
export function shouldScheduleImmediateBillsRefresh(syncHealth: BillsMirrorHealth | null | undefined, now: Date = new Date()): boolean {
  if (syncHealth?.state !== "needs_sync") return false;
  const pendingAt = syncHealth?.pendingRefreshAt
    ? new Date(syncHealth.pendingRefreshAt).getTime()
    : null;
  if (pendingAt !== null && Number.isFinite(pendingAt) && pendingAt > new Date(now).getTime()) {
    return false;
  }
  return true;
}
import type { BillsMirrorHealth } from "../../shared/types/bills.ts";
