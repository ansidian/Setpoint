import db from "../db/connection.ts";
import { refreshCalendarCurrentData } from "../dashboard/current-service.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import {
  refreshCalendarSearchMirror,
  stopCalendarSearchMirrorSyncWorker,
} from "./calendar-search-mirror.ts";
import {
  acceptCalendarPushNotification,
  reconcileCalendarPushWatches,
  requestCalendarPushSync,
  type CalendarPushHeaders,
} from "./calendar-push-channels.ts";

const RECOVERY_INTERVAL_MS = 15 * 60_000;
const DRAIN_INTERVAL_MS = 60_000;
const WATCH_CHECK_INTERVAL_MS = 60 * 60_000;
const WATCH_RETRY_INTERVAL_MS = 5 * 60_000;
const drains = new Map<string, Promise<number>>();
let runningUserId: string | null = null;
let interval: NodeJS.Timeout | null = null;
let wakeTimer: NodeJS.Timeout | null = null;
let watchCheck: Promise<unknown> | null = null;
let nextWatchCheckAt = 0;
let tick: Promise<void> | null = null;

function wakeDrain(userId: string) {
  if (runningUserId !== userId || wakeTimer) return;
  // Coalesce notification bursts without delaying Google's acknowledgement.
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    if (runningUserId !== userId) return;
    drainCalendarPushSync(userId).catch(() => {
      console.error("[Calendar Push] Could not drain queued calendar updates");
    });
  }, 250);
  wakeTimer.unref?.();
}

export async function receiveCalendarPushNotification(headers: CalendarPushHeaders) {
  const result = await acceptCalendarPushNotification(headers);
  if (result.accepted && result.userId) {
    if (result.reconcile) requestCalendarPushReconciliation(result.userId);
    if (result.queued) wakeDrain(result.userId);
  }
  return result;
}

async function drainPending(userId: string): Promise<number> {
  let processed = 0;
  // Bound one turn under sustained edits. Any remaining revision is durable and
  // the next wake/minute tick continues it, including after a process restart.
  for (let batch = 0; batch < 3; batch += 1) {
    const result = await db.execute({
      sql: `SELECT requested_revision, failure_count FROM ea_calendar_push_sync
            WHERE user_id = ? AND requested_revision > completed_revision
              AND next_attempt_at <= ?`,
      args: [userId, Date.now()],
    });
    const pending = result.rows[0];
    if (!pending) return processed;
    const revision = Number(pending.requested_revision);
    try {
      await refreshCalendarSearchMirror(userId);
      await refreshCalendarCurrentData(userId);
      await db.execute({
        sql: `UPDATE ea_calendar_push_sync
              SET completed_revision = MAX(completed_revision, ?), last_success_at = ?,
                  last_error = NULL, failure_count = 0
              WHERE user_id = ?`,
        args: [revision, Date.now(), userId],
      });
      publishCurrentDashboardEvent(userId, {
        source: "calendar", reason: "calendar_push_synced", state: "current",
      });
      processed += 1;
    } catch {
      const failures = Number(pending.failure_count) + 1;
      const retryMs = Math.min(RECOVERY_INTERVAL_MS, DRAIN_INTERVAL_MS * 2 ** Math.min(failures - 1, 4));
      await db.execute({
        sql: `UPDATE ea_calendar_push_sync
              SET last_error = ?, failure_count = failure_count + 1,
                  next_attempt_at = CASE WHEN requested_revision > ? THEN next_attempt_at ELSE ? END
              WHERE user_id = ? AND completed_revision < ?`,
        args: ["Calendar synchronization failed. Automatic checks will retry.", revision,
          Date.now() + retryMs, userId, revision],
      });
      publishCurrentDashboardEvent(userId, {
        source: "calendar", reason: "calendar_sync_failed", state: "degraded",
      });
      return processed;
    }
  }
  wakeDrain(userId);
  return processed;
}

export function drainCalendarPushSync(userId: string): Promise<number> {
  const active = drains.get(userId);
  if (active) return active;
  const promise = drainPending(userId).finally(() => {
    if (drains.get(userId) === promise) drains.delete(userId);
  });
  drains.set(userId, promise);
  return promise;
}

function checkWatches(userId: string) {
  if (watchCheck || process.env.NODE_ENV !== "production") return;
  nextWatchCheckAt = Date.now() + WATCH_CHECK_INTERVAL_MS;
  watchCheck = reconcileCalendarPushWatches(userId)
    .then((result) => {
      if (result.failed) nextWatchCheckAt = Date.now() + WATCH_RETRY_INTERVAL_MS;
      // A recovered renewal failure is observable even when no event changed.
      publishCurrentDashboardEvent(userId, {
        source: "calendar_watch", reason: "calendar_watch_checked",
        state: result.failed ? "degraded" : "current",
      });
      wakeDrain(userId);
    })
    .catch(() => {
      nextWatchCheckAt = Date.now() + WATCH_RETRY_INTERVAL_MS;
      console.error("[Calendar Push] Watch check failed; automatic retry is scheduled");
    })
    .finally(() => { watchCheck = null; });
}

export function requestCalendarPushReconciliation(userId: string) {
  if (runningUserId !== userId) return;
  nextWatchCheckAt = 0;
  checkWatches(userId);
  // Account enable/disable/reconnect also changes the set of displayed events.
  requestCalendarPushSync(userId).then(() => wakeDrain(userId)).catch(() => {
    console.error("[Calendar Push] Could not queue calendar account changes");
  });
}

async function enqueueRecoveryIfDue(userId: string) {
  const result = await db.execute({
    sql: `SELECT requested_revision, completed_revision, last_success_at
          FROM ea_calendar_push_sync WHERE user_id = ?`,
    args: [userId],
  });
  const state = result.rows[0];
  if (state && Number(state.requested_revision) > Number(state.completed_revision)) return;
  if (state?.last_success_at && Date.now() - Number(state.last_success_at) < RECOVERY_INTERVAL_MS) return;
  const accounts = await db.execute({
    sql: "SELECT id FROM ea_accounts WHERE user_id = ? AND type = 'gmail' AND calendar_enabled = 1 LIMIT 1",
    args: [userId],
  });
  if (accounts.rows.length) await requestCalendarPushSync(userId);
}

function runTick(userId: string) {
  if (tick || runningUserId !== userId) return;
  if (Date.now() >= nextWatchCheckAt) checkWatches(userId);
  tick = enqueueRecoveryIfDue(userId)
    .then(() => runningUserId === userId ? drainCalendarPushSync(userId) : 0)
    .then(() => {})
    .catch(() => { console.error("[Calendar Push] Recovery check failed; the next minute will retry"); })
    .finally(() => { tick = null; });
}

export function startCalendarPushWorker({ userId = process.env.EA_USER_ID }: { userId?: string } = {}) {
  if (!userId || interval) return { started: false };
  runningUserId = userId;
  nextWatchCheckAt = 0;
  runTick(userId);
  interval = setInterval(() => runTick(userId), DRAIN_INTERVAL_MS);
  interval.unref?.();
  return { started: true };
}

export async function stopCalendarPushWorker() {
  runningUserId = null;
  if (interval) clearInterval(interval);
  if (wakeTimer) clearTimeout(wakeTimer);
  interval = null;
  wakeTimer = null;
  await Promise.allSettled([tick, watchCheck, ...drains.values()]);
  stopCalendarSearchMirrorSyncWorker();
}
