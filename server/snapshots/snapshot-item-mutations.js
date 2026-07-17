/**
 * User-action handlers on active snapshot items: lane move, dismiss-for-today,
 * restore, mark-handled, and reopen, plus the pending-triage dismissal
 * plumbing the dismiss path settles through. Every mutation records a
 * feedback row so triage can learn from owner corrections. Extracted from
 * snapshot-service.js (EAD-325); snapshot-service re-exports every public
 * symbol here, so external callers are unchanged.
 */

import db from "../db/connection.ts";
import { normalizeSnapshotItem } from "./snapshot-lifecycle.js";
import {
  TRIAGE_LANES,
  getSnapshotReopenLane,
  isPendingSnapshotTriage,
} from "./snapshot-state-machine.js";
import {
  completeEmailTriageJobsForEmail,
  restorePendingTriageEligibilityForEmail,
} from "./snapshot-triage-attachment.js";

export function makeHttpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Builds the feedback INSERT as a libsql {sql, args} statement so it can be
// either executed standalone or grouped into a db.batch([...]) with the paired
// snapshot-item / triage writes (see moveSnapshotItemLane et al. below).
function feedbackInsertQuery(item, feedbackType, fromValue, toValue) {
  return {
    sql: `INSERT INTO ea_triage_feedback
            (user_id, triage_id, snapshot_item_id, account_id, email_id,
             feedback_type, from_value, to_value)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      item.user_id,
      item.triage_id,
      item.id,
      item.account_id,
      item.email_id,
      feedbackType,
      fromValue,
      toValue,
    ],
  };
}

export async function insertFeedback(dbClient, item, feedbackType, fromValue, toValue) {
  await dbClient.execute(feedbackInsertQuery(item, feedbackType, fromValue, toValue));
}

async function loadActiveSnapshotItem(dbClient, userId, itemId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json,
                 t.triage_status,
                 t.triage_source
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
            AND i.dismissed_from_today_at IS NULL
            AND i.provider_removed_at IS NULL
            AND i.handled_at IS NULL
          LIMIT 1`,
    args: [itemId, userId],
  });
  return result.rows[0] || null;
}

async function loadActiveHandledSnapshotItem(dbClient, userId, itemId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
            AND i.dismissed_from_today_at IS NULL
            AND i.provider_removed_at IS NULL
            AND i.handled_at IS NOT NULL
          LIMIT 1`,
    args: [itemId, userId],
  });
  return result.rows[0] || null;
}

async function loadSnapshotItemById(dbClient, userId, itemId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
          LIMIT 1`,
    args: [itemId, userId],
  });
  return result.rows[0] || null;
}

export async function markPendingTriageDismissedForEmail(userId, accountId, emailId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const dismissedAt = now.toISOString();
  const result = await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET dismissed_at = ?,
              triage_status = 'skipped',
              triage_source = 'user_dismissed_pending',
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND triage_status = 'pending'`,
    args: [dismissedAt, userId, accountId, emailId],
  });

  const jobs = await completeEmailTriageJobsForEmail(userId, accountId, emailId, {
    dbClient,
    now,
    lastError: "Skipped pending triage; user dismissed row",
  });

  return {
    updated: Number(result.rowsAffected || 0),
    jobsUpdated: jobs.updated,
  };
}

export async function markPendingTriageDismissed(userId, emailId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await dbClient.execute({
    sql: `SELECT account_id
          FROM ea_email_triage
          WHERE user_id = ?
            AND email_id = ?
            AND triage_status = 'pending'`,
    args: [userId, emailId],
  });

  let updated = 0;
  let jobsUpdated = 0;
  for (const row of rows.rows) {
    const result = await markPendingTriageDismissedForEmail(userId, row.account_id, emailId, {
      dbClient,
      now,
    });
    updated += result.updated;
    jobsUpdated += result.jobsUpdated;
  }
  return { updated, jobsUpdated };
}

export async function moveSnapshotItemLane(userId, itemId, lane, {
  dbClient = db,
} = {}) {
  if (!TRIAGE_LANES.has(lane)) {
    throw makeHttpError("Invalid snapshot lane", 400);
  }

  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }
  if (item.lane_at_snapshot === lane) {
    return normalizeSnapshotItem(item);
  }

  // Paired writes commit atomically: a mid-write failure must not diverge the
  // snapshot item's lane from the canonical triage lane (P3-44).
  await dbClient.batch([
    {
      sql: `UPDATE ea_briefing_snapshot_items
            SET lane_at_snapshot = ?,
                is_carryover = 0,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [lane, itemId, userId],
    },
    {
      sql: `UPDATE ea_email_triage
            SET lane = ?,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [lane, item.triage_id, userId],
    },
    feedbackInsertQuery(item, "lane_move", item.lane_at_snapshot, lane),
  ]);

  const updated = await loadActiveSnapshotItem(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function dismissSnapshotItemForToday(userId, itemId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }

  const dismissedAt = now.toISOString();
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET dismissed_from_today_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [dismissedAt, itemId, userId],
  });
  if (isPendingSnapshotTriage(item)) {
    await markPendingTriageDismissedForEmail(userId, item.account_id, item.email_id, {
      dbClient,
      now,
    });
  }
  await insertFeedback(dbClient, item, "dismiss_today", "visible", "dismissed");

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function restoreSnapshotItemForToday(userId, itemId, {
  dbClient = db,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 t.triage_status,
                 t.last_triaged_at
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
            AND i.provider_removed_at IS NULL
          LIMIT 1`,
    args: [itemId, userId],
  });
  const item = result.rows[0];
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }

  if (item.triage_status !== "complete" && !item.last_triaged_at) {
    await restorePendingTriageEligibilityForEmail(userId, item.account_id, item.email_id, { dbClient });
  } else {
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshot_items
            SET dismissed_from_today_at = NULL,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [itemId, userId],
    });
  }

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function markSnapshotItemHandled(userId, itemId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }

  const handledAt = now.toISOString();
  // Paired writes commit atomically so handled state cannot diverge between the
  // snapshot item and the canonical triage row on a mid-write failure (P3-44).
  await dbClient.batch([
    {
      sql: `UPDATE ea_briefing_snapshot_items
            SET handled_at = ?,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [handledAt, itemId, userId],
    },
    {
      sql: `UPDATE ea_email_triage
            SET handled_at = ?,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [handledAt, item.triage_id, userId],
    },
    feedbackInsertQuery(item, "mark_handled", "unhandled", "handled"),
  ]);

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function reopenSnapshotItem(userId, itemId, {
  dbClient = db,
} = {}) {
  const item = await loadActiveHandledSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active handled snapshot item not found", 404);
  }
  const restoredLane = getSnapshotReopenLane(item.lane_at_snapshot);

  // Paired writes commit atomically so reopen cannot leave the snapshot item
  // and canonical triage row in conflicting handled/lane states (P3-44).
  await dbClient.batch([
    {
      sql: `UPDATE ea_briefing_snapshot_items
            SET handled_at = NULL,
                lane_at_snapshot = ?,
                is_carryover = 0,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [restoredLane, itemId, userId],
    },
    {
      sql: `UPDATE ea_email_triage
            SET handled_at = NULL,
                lane = ?,
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [restoredLane, item.triage_id, userId],
    },
    feedbackInsertQuery(item, "reopen", "handled", restoredLane),
  ]);

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}
