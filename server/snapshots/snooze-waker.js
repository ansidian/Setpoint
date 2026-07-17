import cron from "node-cron";
import db from "../db/connection.ts";
import { loadUserConfig } from "../platform/config-service.js";
import { wakeAtGmail } from "../email/gmail.js";
import {
  attachArrivalGraceEmailToActiveSnapshot,
  attachResurfacedSnoozeToActiveSnapshot,
  requeueArrivalGraceTriageForEmail,
  requeueEmailTriageForEmail,
} from "./snapshot-service.js";
import { ARRIVAL_GRACE_SOURCE } from "./arrival-grace.js";

const CRON_EXPR = "*/5 * * * *"; // every 5 minutes
// P2-20: bound how many Gmail wake-modify round-trips run at once when a cluster
// of snoozes comes due at the same boundary (e.g. "until tomorrow 9am").
const SNOOZE_WAKE_CONCURRENCY = 5;
const SNOOZE_TRIAGE_LOOKUP_CHUNK_SIZE = 500;

function snoozeTriageKey(accountId, emailId) {
  return `${accountId}:${emailId}`;
}

// P2-20: load every due snooze's triage row in one (chunked) query keyed by
// (account_id, email_id), replacing the per-row SELECT inside the wake loop.
async function loadTriageRowsForDueSnoozes(dbClient, userId, items) {
  const uids = [...new Set(items.filter((item) => item.accountId).map((item) => item.uid))];
  const byKey = new Map();
  for (let i = 0; i < uids.length; i += SNOOZE_TRIAGE_LOOKUP_CHUNK_SIZE) {
    const chunk = uids.slice(i, i + SNOOZE_TRIAGE_LOOKUP_CHUNK_SIZE);
    const res = await dbClient.execute({
      sql: `SELECT account_id, email_id, triage_status, triage_source,
                   last_triaged_at, decision_metadata_json
            FROM ea_email_triage
            WHERE user_id = ? AND email_id IN (${chunk.map(() => "?").join(",")})`,
      args: [userId, ...chunk],
    });
    for (const row of res.rows) {
      byKey.set(snoozeTriageKey(row.account_id, row.email_id), row);
    }
  }
  return byKey;
}

async function runWithBoundedConcurrency(items, limit, worker) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(worker));
  }
}
// Resurfaced rows live this long after wake before cleanup. Gives the client a
// window to surface them in the live/untriaged lane; after this they're gone
// and the email is just a normal unread in Gmail.
const RESURFACED_TTL_MS = 48 * 60 * 60 * 1000;

// Module-level re-entrancy guard so overlapping cron ticks can't double-process
// the same due snoozes (double Gmail wake-modify + racing snapshot inserts).
// Mirrors email-backfill-worker.js's workerRunning latch.
let wakeInFlight = false;

export async function wakeDueSnoozes({
  userId = process.env.EA_USER_ID,
  dbClient = db,
  now = new Date(),
  loadUserConfigFn = loadUserConfig,
  wakeAtGmailFn = wakeAtGmail,
  attachResurfacedSnoozeToActiveSnapshotFn = attachResurfacedSnoozeToActiveSnapshot,
  attachArrivalGraceEmailToActiveSnapshotFn = attachArrivalGraceEmailToActiveSnapshot,
  requeueArrivalGraceTriageForEmailFn = requeueArrivalGraceTriageForEmail,
  requeueEmailTriageForEmailFn = requeueEmailTriageForEmail,
} = {}) {
  if (!userId) return;

  // P3-59: a previous tick is still resurfacing; bail so we don't fire a second
  // Gmail wake-modify and race the snapshot inserts against the same due rows.
  if (wakeInFlight) return { woke: 0, skipped: "in_flight" };
  wakeInFlight = true;
  try {
    return await runWakeDueSnoozes({
      userId,
      dbClient,
      now,
      loadUserConfigFn,
      wakeAtGmailFn,
      attachResurfacedSnoozeToActiveSnapshotFn,
      attachArrivalGraceEmailToActiveSnapshotFn,
      requeueArrivalGraceTriageForEmailFn,
      requeueEmailTriageForEmailFn,
    });
  } finally {
    wakeInFlight = false;
  }
}

async function runWakeDueSnoozes({
  userId,
  dbClient,
  now,
  loadUserConfigFn,
  wakeAtGmailFn,
  attachResurfacedSnoozeToActiveSnapshotFn,
  attachArrivalGraceEmailToActiveSnapshotFn,
  requeueArrivalGraceTriageForEmailFn,
  requeueEmailTriageForEmailFn,
}) {
  const resurfacedAt = now.getTime();
  const result = await dbClient.execute({
    sql: "SELECT email_id, email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND status = 'snoozed' AND until_ts <= ?",
    args: [userId, resurfacedAt],
  });

  if (result.rows.length === 0) return { woke: 0 };

  console.log(`[EA Snooze] Waking ${result.rows.length} snooze(s)`);
  const { accounts } = await loadUserConfigFn(userId);

  // Parse each due row once and resolve its account up front.
  const items = result.rows.map((row) => {
    const uid = row.email_id;
    let snap = null;
    if (row.email_snapshot) {
      try { snap = JSON.parse(row.email_snapshot); } catch { /* ignore */ }
    }
    const accountId = snap ? (snap.account_id || snap.accountId || snap._accountKey) : null;
    const acc = accounts.find((a) => a.id === snap?.account_id || a.email === snap?.account_email);
    return { uid, snap, accountId, acc };
  });

  // P2-20: one batched triage lookup for the whole due set instead of a SELECT
  // per row inside the loop.
  const triageByKey = await loadTriageRowsForDueSnoozes(dbClient, userId, items);

  // P2-20: fan out the Gmail wake-modify calls (the dominant external I/O) with
  // bounded concurrency. A wake failure is logged and the row still proceeds to
  // its reattach + status flip, exactly as the serial path did.
  await runWithBoundedConcurrency(
    items.filter((item) => item.acc?.type === "gmail"),
    SNOOZE_WAKE_CONCURRENCY,
    async (item) => {
      try {
        await wakeAtGmailFn(item.acc, item.uid);
      } catch (err) {
        console.error(`[EA Snooze] Gmail wake-modify failed for uid=${item.uid}:`, err.message);
      }
    },
  );

  // Reattach + status flip stay SERIAL: each row's reattach resolves/mutates the
  // shared active snapshot (getOrCreateActiveSnapshot), so serializing avoids
  // racing snapshot inserts. The per-row try/catch keeps the status flip gated on
  // a successful reattach (a failure leaves the row 'snoozed' for the next tick).
  for (const { uid, snap, accountId } of items) {
    try {
      if (snap) {
        // P3-61: a triage row that already settled (status 'complete', stamped
        // last_triaged_at) carries the owner's real lane/summary/category. The
        // cron path must NOT re-derive those from the stale email_snapshot JSON
        // or it demotes a 'fyi'/'noise' item back toward needs_attention.
        const triageRow = accountId ? triageByKey.get(snoozeTriageKey(accountId, uid)) : null;
        const pendingTriage = triageRow?.triage_status === "pending";
        const completedTriage = triageRow?.triage_status === "complete"
          && Boolean(triageRow?.last_triaged_at);
        let metadata = {};
        try {
          metadata = triageRow?.decision_metadata_json
            ? JSON.parse(triageRow.decision_metadata_json)
            : {};
        } catch {
          metadata = {};
        }
        const pendingArrivalGrace = pendingTriage
          && (
            triageRow?.triage_source === ARRIVAL_GRACE_SOURCE
            || metadata?.snoozedPending?.previousTriageSource === ARRIVAL_GRACE_SOURCE
          );
        if (pendingArrivalGrace && accountId) {
          await requeueArrivalGraceTriageForEmailFn(userId, accountId, uid, { dbClient, now });
          await attachArrivalGraceEmailToActiveSnapshotFn(userId, accountId, {
            ...snap,
            uid,
            email_id: uid,
          }, { dbClient, now });
        } else if (completedTriage && accountId
          && await unhideCompletedSnoozeItem(dbClient, userId, accountId, uid)) {
          // P3-61: mirrored the manual-wake path — the live triaged item already
          // exists, so we cleared dismissed_from_today_at to un-hide it in place
          // rather than re-deriving lane/summary from the snapshot JSON. Nothing
          // else to do; the existing triage fields stay untouched.
        } else {
          await attachResurfacedSnoozeToActiveSnapshotFn(userId, snap, {
            dbClient,
            now,
            resurfacedAt,
            pendingTriage,
          });
          if (pendingTriage && accountId) {
            await requeueEmailTriageForEmailFn(userId, accountId, uid, { dbClient });
          }
        }
      }
      // Flip to 'resurfaced' only AFTER a successful reattach. If the reattach
      // throws, the row stays 'snoozed' so the next tick retries it — otherwise
      // the email would be silently dropped from the briefing.
      await dbClient.execute({
        sql: "UPDATE ea_snoozed_emails SET status = 'resurfaced', resurfaced_at = ? WHERE user_id = ? AND email_id = ?",
        args: [resurfacedAt, userId, uid],
      });
    } catch (err) {
      console.error(`[EA Snooze] Status update failed for uid=${uid}:`, err.message);
    }
  }

  return { woke: result.rows.length };
}

// P3-61: un-hide the live snapshot item for a completed-triage snooze, mirroring
// restorePendingTriageEligibilityForEmail's item update (manual-wake path). Clears
// dismissed_from_today_at on the active-snapshot row without touching any triage
// field, so a 'fyi'/'noise' item resurfaces in its real lane. Returns true when an
// existing live item was restored; false (no row) means none exists and the caller
// should fall back to attachResurfacedSnoozeToActiveSnapshot.
async function unhideCompletedSnoozeItem(dbClient, userId, accountId, emailId) {
  const itemResult = await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET dismissed_from_today_at = NULL,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND provider_removed_at IS NULL
            AND snapshot_id IN (
              SELECT id FROM ea_briefing_snapshots
              WHERE user_id = ? AND status = 'active'
            )`,
    args: [userId, accountId, emailId, userId],
  });
  return Number(itemResult.rowsAffected || 0) > 0;
}

async function cleanupResurfaced({
  userId = process.env.EA_USER_ID,
  dbClient = db,
} = {}) {
  if (!userId) return;
  const cutoff = Date.now() - RESURFACED_TTL_MS;
  try {
    const result = await dbClient.execute({
      sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND status = 'resurfaced' AND resurfaced_at < ?",
      args: [userId, cutoff],
    });
    if (result.rowsAffected > 0) {
      console.log(`[EA Snooze] Cleaned up ${result.rowsAffected} resurfaced row(s)`);
    }
  } catch (err) {
    console.error("[EA Snooze] Resurfaced cleanup failed:", err.message);
  }
}

let snoozeWakerJob = null;

export function startSnoozeWaker() {
  if (snoozeWakerJob) {
    snoozeWakerJob.stop();
    snoozeWakerJob = null;
  }
  snoozeWakerJob = cron.schedule(CRON_EXPR, () => {
    wakeDueSnoozes()
      .catch((err) => console.error("[EA Snooze] Worker tick failed:", err.message))
      .finally(() => { cleanupResurfaced(); });
  });
  console.log("[EA Snooze] Waker started (every 5 minutes)");
}

export function stopSnoozeWaker() {
  if (snoozeWakerJob) {
    snoozeWakerJob.stop();
    snoozeWakerJob = null;
  }
}
