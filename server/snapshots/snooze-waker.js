import cron from "node-cron";
import db from "../db/connection.js";
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
// Resurfaced rows live this long after wake before cleanup. Gives the client a
// window to surface them in the live/untriaged lane; after this they're gone
// and the email is just a normal unread in Gmail.
const RESURFACED_TTL_MS = 48 * 60 * 60 * 1000;

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

  const resurfacedAt = now.getTime();
  const result = await dbClient.execute({
    sql: "SELECT email_id, email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND status = 'snoozed' AND until_ts <= ?",
    args: [userId, resurfacedAt],
  });

  if (result.rows.length === 0) return { woke: 0 };

  console.log(`[EA Snooze] Waking ${result.rows.length} snooze(s)`);
  const { accounts } = await loadUserConfigFn(userId);

  for (const row of result.rows) {
    const uid = row.email_id;
    let snap = null;
    if (row.email_snapshot) {
      try { snap = JSON.parse(row.email_snapshot); } catch { /* ignore */ }
    }
    try {
      const acc = accounts.find((a) => a.id === snap?.account_id || a.email === snap?.account_email);
      if (acc?.type === "gmail") {
        await wakeAtGmailFn(acc, uid);
      }
    } catch (err) {
      console.error(`[EA Snooze] Gmail wake-modify failed for uid=${uid}:`, err.message);
      // Continue to the status flip so we don't retry forever on a bad row.
      // The email is still in Gmail under the EA/Snoozed label — user can
      // clear it manually if it got stuck.
    }
    try {
      await dbClient.execute({
        sql: "UPDATE ea_snoozed_emails SET status = 'resurfaced', resurfaced_at = ? WHERE user_id = ? AND email_id = ?",
        args: [resurfacedAt, userId, uid],
      });
      if (snap) {
        const accountId = snap.account_id || snap.accountId || snap._accountKey;
        let pendingTriage = false;
        let pendingArrivalGrace = false;
        if (accountId) {
          const triage = await dbClient.execute({
            sql: `SELECT triage_status,
                         triage_source,
                         decision_metadata_json
                  FROM ea_email_triage
                  WHERE user_id = ?
                    AND account_id = ?
                    AND email_id = ?
                  LIMIT 1`,
            args: [userId, accountId, uid],
          });
          const triageRow = triage.rows[0];
          pendingTriage = triageRow?.triage_status === "pending";
          let metadata = {};
          try {
            metadata = triageRow?.decision_metadata_json
              ? JSON.parse(triageRow.decision_metadata_json)
              : {};
          } catch {
            metadata = {};
          }
          pendingArrivalGrace = pendingTriage
            && (
              triageRow?.triage_source === ARRIVAL_GRACE_SOURCE
              || metadata?.snoozedPending?.previousTriageSource === ARRIVAL_GRACE_SOURCE
            );
        }
        if (pendingArrivalGrace && accountId) {
          await requeueArrivalGraceTriageForEmailFn(userId, accountId, uid, { dbClient, now });
          await attachArrivalGraceEmailToActiveSnapshotFn(userId, accountId, {
            ...snap,
            uid,
            email_id: uid,
          }, { dbClient, now });
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
    } catch (err) {
      console.error(`[EA Snooze] Status update failed for uid=${uid}:`, err.message);
    }
  }

  return { woke: result.rows.length };
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

export function startSnoozeWaker() {
  cron.schedule(CRON_EXPR, () => {
    wakeDueSnoozes()
      .catch((err) => console.error("[EA Snooze] Worker tick failed:", err.message))
      .finally(() => { cleanupResurfaced(); });
  });
  console.log("[EA Snooze] Waker started (every 5 minutes)");
}
