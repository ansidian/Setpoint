import db from "../db/connection.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import { fetchAllEmails } from "../email/email-fetch.js";
import { indexEmails } from "../email/email-index.js";
import { enqueueEmailTriageForEmails } from "../email/gmail-sync.js";
import { loadPinnedEntries } from "../email/pinned-emails.js";
import { getElapsedMs, logTiming } from "../timing.ts";
import {
  DEFAULT_TIMEZONE,
  activeSnapshotWindow,
} from "./snapshot-lifecycle.js";
import { PROVIDER_REMOVED_STATES } from "./snapshot-state-machine.js";
import { completeEmailTriageJobsForEmail } from "./snapshot-triage-attachment.js";
import { insertFeedback, makeHttpError } from "./snapshot-item-mutations.js";
import { buildSnapshotView, emptyProcessingState } from "./snapshotViewModel.js";
import {
  copyCarryoverItems,
  findActiveSnapshot,
  findContainingActiveSnapshot,
  freezeActiveSnapshotsAtBoundary,
  freezeExpiredActiveSnapshots,
  loadAccountFilterOrder,
  loadActiveCatchUpItems,
  loadActiveSnapshotItemsForEmail,
  loadCarryoverAgedOutCount,
  loadPreviousFrozenSnapshot,
  loadProcessingState,
  loadSnapshotById,
  loadSnapshotHistoryCounts,
  loadSnapshotHistoryRows,
  loadSnapshotItems,
} from "./snapshotStore.js";

export { activeSnapshotWindow } from "./snapshot-lifecycle.js";
export { CARRYOVER_MAX_DEPTH } from "./snapshotStore.js";
export {
  attachArrivalGraceEmailToActiveSnapshot,
  completeEmailTriageJobsForEmail,
  requeueArrivalGraceTriageForEmail,
  requeueEmailTriageForEmail,
  restorePendingTriageEligibilityForEmail,
} from "./snapshot-triage-attachment.js";
export {
  attachResurfacedSnoozeToActiveSnapshot,
  deferPendingTriageForSnooze,
  settleReadArrivalGraceRows,
} from "./snapshot-snooze-lifecycle.js";
export {
  dismissSnapshotItemForToday,
  markPendingTriageDismissed,
  markPendingTriageDismissedForEmail,
  markSnapshotItemHandled,
  moveSnapshotItemLane,
  reopenSnapshotItem,
  restoreSnapshotItemForToday,
} from "./snapshot-item-mutations.js";

const ACTIVE_SNAPSHOT_SYNC_IN_FLIGHT = new Map();

export async function getOrCreateActiveSnapshot(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const window = activeSnapshotWindow({ now, timeZone });
  await freezeExpiredActiveSnapshots(dbClient, userId, window, now);

  const containing = await findContainingActiveSnapshot(dbClient, userId, now);
  if (containing) return containing;

  const existing = await findActiveSnapshot(dbClient, userId, window);
  if (existing) return existing;

  await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_briefing_snapshots
            (user_id, start_at, end_at, timezone, status)
          VALUES (?, ?, ?, ?, 'active')`,
    args: [userId, window.start_at, window.end_at, window.timezone],
  });

  const created = await findActiveSnapshot(dbClient, userId, window);
  if (created) await copyCarryoverItems(dbClient, userId, created, window);
  return created;
}

export async function advanceSnapshotBoundary(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  scheduleLabel = null,
} = {}) {
  const nowIso = now.toISOString();
  const dailyWindow = activeSnapshotWindow({ now, timeZone });
  const window = {
    start_at: nowIso,
    end_at: dailyWindow.end_at,
    timezone: timeZone,
  };

  // Freeze BOTH the window currently containing `now` (start_at < now < end_at)
  // AND any already-expired active window (end_at <= now). Without freezing the
  // expired case, a daily window that rolled past its local-midnight end with no
  // intervening read stays 'active' while this advance inserts another active
  // row — leaving two concurrent 'active' snapshots that direct active-targeting
  // queries (deferPendingTriageForSnooze, markProviderRemovedFromActiveSnapshots,
  // settleReadArrivalGraceRows) mutate across both (P1-11). freezeExpired-
  // ActiveSnapshots preserves the expired row's real end_at, so it is used here
  // instead of widening freezeActiveSnapshotsAtBoundary (which rewrites end_at).
  await freezeExpiredActiveSnapshots(dbClient, userId, { start_at: nowIso }, now);
  await freezeActiveSnapshotsAtBoundary(dbClient, userId, now);

  const existing = await findActiveSnapshot(dbClient, userId, window);
  if (!existing) {
    await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status, schedule_label)
            VALUES (?, ?, ?, ?, 'active', ?)`,
      args: [userId, window.start_at, window.end_at, window.timezone, scheduleLabel],
    });
  } else if (scheduleLabel) {
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshots
            SET schedule_label = ?,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [scheduleLabel, existing.id, userId],
    });
  }

  const snapshot = await findActiveSnapshot(dbClient, userId, window);
  if (snapshot) await copyCarryoverItems(dbClient, userId, snapshot, window);
  return {
    snapshot,
    schedule_label: scheduleLabel,
  };
}

async function defaultProcessNextEmailTriageJob(options) {
  const { processNextEmailTriageJob } = await import("../triage/triage-worker.js");
  return processNextEmailTriageJob(options);
}

async function timeSnapshotSyncSource(source, work, extra = {}) {
  const startedAt = performance.now();
  try {
    const result = await work();
    logTiming({
      event: "snapshot-sync-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "ok",
      ...(typeof extra === "function" ? extra(result) : extra),
    });
    return result;
  } catch (err) {
    logTiming({
      event: "snapshot-sync-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err?.message || String(err),
      ...(typeof extra === "function" ? extra(null, err) : extra),
    }, console.error);
    throw err;
  }
}

export async function getSnapshotHistory(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  const snapshots = await loadSnapshotHistoryRows(dbClient, userId);
  const countsBySnapshot = await loadSnapshotHistoryCounts(dbClient, snapshots.map((snapshot) => snapshot.id));

  return {
    snapshots: snapshots.map((snapshot) => {
      const laneCounts = countsBySnapshot.get(snapshot.id) || {
        queued: 0,
        needs_attention: 0,
        fyi: 0,
        handled: 0,
        untriaged_read: 0,
        noise: 0,
        carryover: 0,
      };
      return {
        ...snapshot,
        readOnly: snapshot.status !== "active",
        laneCounts,
        item_count: Object.values(laneCounts).reduce((sum, count) => sum + count, 0),
      };
    }),
  };
}

export async function getSnapshotViewById(userId, snapshotId, {
  dbClient = db,
} = {}) {
  const snapshot = await loadSnapshotById(dbClient, userId, snapshotId);
  if (!snapshot) {
    throw makeHttpError("Snapshot not found", 404);
  }
  const items = await loadSnapshotItems(dbClient, snapshot.id);
  const processing = snapshot.status === "active"
    ? await loadProcessingState(dbClient, userId)
    : emptyProcessingState();
  return buildSnapshotView(snapshot, items, processing);
}

export async function getActiveSnapshotView(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  // getOrCreateActiveSnapshot must stay first — it may INSERT the snapshot and
  // copy carryover items, and the readers below consume its id. Once it
  // resolves, the six reads are mutually independent pure SELECTs, so run them
  // concurrently instead of as six serial Turso round-trips (P1-7).
  const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  // The previous frozen snapshot is needed by BOTH the catch-up and aged-out
  // reads. Resolve it once and share the single in-flight promise so the
  // identical SELECT is not issued twice within one view build (it still runs
  // concurrently with the other reads below, so this does not add latency).
  const previousFrozen = snapshot?.start_at
    ? loadPreviousFrozenSnapshot(dbClient, userId, { start_at: snapshot.start_at })
    : Promise.resolve(null);
  const [items, catchUpItems, accountOrder, processing, carryoverAgedOut, pinned] = await Promise.all([
    snapshot ? loadSnapshotItems(dbClient, snapshot.id) : [],
    snapshot ? loadActiveCatchUpItems(dbClient, userId, snapshot, { previousFrozen }) : [],
    loadAccountFilterOrder(dbClient, userId),
    loadProcessingState(dbClient, userId),
    snapshot ? loadCarryoverAgedOutCount(dbClient, userId, snapshot, { previousFrozen }) : 0,
    loadPinnedEntries(userId, { dbClient }),
  ]);
  return { ...buildSnapshotView(snapshot, [...items, ...catchUpItems], processing, accountOrder, carryoverAgedOut), pinned };
}

async function runActiveSnapshotSync(userId, {
  dbClient = db,
  loadUserConfigFn = loadUserConfig,
  fetchAllEmailsFn = fetchAllEmails,
  indexEmailsFn = indexEmails,
  enqueueEmailTriageForEmailsFn = enqueueEmailTriageForEmails,
  processNextEmailTriageJobFn = defaultProcessNextEmailTriageJob,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const { accounts, settings } = await timeSnapshotSyncSource("config", () => loadUserConfigFn(userId), (result) => ({
    accounts: result?.accounts?.length || 0,
  }));
  const hoursBack = Number(settings?.email_lookback_hours) || 16;
  const emails = await timeSnapshotSyncSource("emailFetch", () => fetchAllEmailsFn(accounts, hoursBack), (result) => ({
    accounts: accounts.length,
    emails: result?.length || 0,
    hoursBack,
  }));

  if (emails.length) {
    await timeSnapshotSyncSource("indexAndEnqueue", async () => {
      await timeSnapshotSyncSource("emailIndex", () => indexEmailsFn(userId, emails, { dbClient }), {
        emails: emails.length,
      });
      await timeSnapshotSyncSource("triageEnqueue", () => enqueueEmailTriageForEmailsFn(userId, emails, { dbClient }), {
        emails: emails.length,
      });
    }, {
      emails: emails.length,
    });
  }

  await timeSnapshotSyncSource("triageLoop", async () => {
    // P1-7: resolve mode/rules/interests/model-client once for the whole drain.
    // Only build the batch context when the real worker is in use; injected test
    // doubles ignore `batch` and must not trigger the triage-worker import.
    let batch = null;
    if (processNextEmailTriageJobFn === defaultProcessNextEmailTriageJob) {
      const { createTriageBatchContext } = await import("../triage/triage-worker.js");
      batch = createTriageBatchContext({ dbClient });
    }
    let processed = 0;
    let paused = false;
    for (let i = 0; i < 25; i++) {
      const result = await processNextEmailTriageJobFn({ dbClient, now, batch });
      if (result?.paused) {
        paused = true;
        break;
      }
      if (!result?.processed) break;
      processed++;
    }
    return { processed, paused };
  }, (result) => ({
    processed: result?.processed || 0,
    paused: !!result?.paused,
    limit: 25,
  }));

  return timeSnapshotSyncSource("snapshotView", () => getActiveSnapshotView(userId, { dbClient, now, timeZone }), (result) => ({
    items: Object.values(result?.laneCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0),
    processingActive: !!result?.processing?.active,
  }));
}

export async function syncActiveSnapshot(userId, options = {}) {
  const key = String(userId || "");
  const existing = ACTIVE_SNAPSHOT_SYNC_IN_FLIGHT.get(key);
  if (existing) {
    logTiming({
      event: "snapshot-sync-source",
      source: "singleFlight",
      status: "joined",
    });
    return existing;
  }

  const promise = runActiveSnapshotSync(userId, options)
    .finally(() => {
      if (ACTIVE_SNAPSHOT_SYNC_IN_FLIGHT.get(key) === promise) {
        ACTIVE_SNAPSHOT_SYNC_IN_FLIGHT.delete(key);
      }
    });
  ACTIVE_SNAPSHOT_SYNC_IN_FLIGHT.set(key, promise);
  return promise;
}

export async function markProviderRemovedFromActiveSnapshots(
  userId,
  accountId,
  emailId,
  providerState,
  {
    dbClient = db,
    now = new Date(),
  } = {},
) {
  if (!PROVIDER_REMOVED_STATES.has(providerState)) {
    throw makeHttpError("Invalid provider removal state", 400);
  }

  const items = await loadActiveSnapshotItemsForEmail(dbClient, userId, accountId, emailId);
  const removedAt = now.toISOString();

  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET provider_state = ?,
              triage_status = CASE WHEN triage_status = 'pending' THEN 'skipped' ELSE triage_status END,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?`,
    args: [providerState, userId, accountId, emailId],
  });
  await completeEmailTriageJobsForEmail(userId, accountId, emailId, {
    dbClient,
    now,
    lastError: `Skipped pending triage; provider state ${providerState}`,
  });

  if (items.length) {
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshot_items
            SET provider_removed_at = ?,
                updated_at = datetime('now')
            WHERE user_id = ?
              AND account_id = ?
              AND email_id = ?
              AND snapshot_id IN (
                SELECT id FROM ea_briefing_snapshots
                WHERE user_id = ? AND status = 'active'
              )
              AND provider_removed_at IS NULL`,
      args: [removedAt, userId, accountId, emailId, userId],
    });

    for (const item of items) {
      await insertFeedback(
        dbClient,
        item,
        "provider_removed",
        item.provider_state || "available",
        providerState,
      );
    }
  }

  return { updated: items.length };
}
