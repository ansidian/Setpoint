/**
 * Plumbing between the triage worker and the snapshot row state machine:
 * arrival-grace queueing/attachment, triage-job completion, and restoration
 * of pending-triage eligibility on undo. Extracted from snapshot-service.js
 * (EAD-323); snapshot-service re-exports every public symbol here, so
 * external callers are unchanged.
 */

import db from "../db/connection.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { parseFrom } from "../email/email-index.js";
import {
  ARRIVAL_GRACE_QUEUED_LANE,
  ARRIVAL_GRACE_SOURCE,
  arrivalGraceDeadline,
} from "./arrival-grace.js";
import { DEFAULT_TIMEZONE, snapshotString } from "./snapshot-lifecycle.js";
import { getOrCreateActiveSnapshot } from "./snapshot-service.js";

function snapshotSenderFromEmail(email = {}) {
  const parsed = parseFrom(email);
  return {
    fromName: snapshotString(email.from_name, parsed.fromName),
    fromAddress: snapshotString(email.from_address, parsed.fromAddress),
  };
}

export async function requeueEmailTriageForEmail(userId, accountId, emailId, {
  dbClient = db,
} = {}) {
  const idempotencyKey = `email_triage:${userId}:${accountId}:${emailId}`;
  await dbClient.execute({
    sql: `INSERT INTO ea_triage_jobs
            (user_id, account_id, email_id, job_type, status, idempotency_key,
             priority, payload_json, scheduled_for, completed_at, locked_at, last_error)
          VALUES (?, ?, ?, 'email_triage', 'queued', ?, 2, '{}', NULL, NULL, NULL, '')
          ON CONFLICT(idempotency_key) DO UPDATE SET
            status = 'queued',
            priority = 2,
            scheduled_for = NULL,
            completed_at = NULL,
            locked_at = NULL,
            last_error = '',
            updated_at = datetime('now')`,
    args: [userId, accountId, emailId, idempotencyKey],
  });
}

export async function requeueArrivalGraceTriageForEmail(userId, accountId, emailId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const scheduledFor = arrivalGraceDeadline(now);
  const idempotencyKey = `email_triage:${userId}:${accountId}:${emailId}`;
  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET triage_status = 'pending',
              triage_source = ?,
              dismissed_at = NULL,
              last_triaged_at = NULL,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?`,
    args: [ARRIVAL_GRACE_SOURCE, userId, accountId, emailId],
  });
  await dbClient.execute({
    sql: `INSERT INTO ea_triage_jobs
            (user_id, account_id, email_id, job_type, status, idempotency_key,
             priority, payload_json, scheduled_for, completed_at, locked_at, last_error)
          VALUES (?, ?, ?, 'email_triage', 'queued', ?, 2, ?, ?, NULL, NULL, '')
          ON CONFLICT(idempotency_key) DO UPDATE SET
            status = 'queued',
            priority = 2,
            payload_json = excluded.payload_json,
            scheduled_for = excluded.scheduled_for,
            completed_at = NULL,
            locked_at = NULL,
            last_error = '',
            updated_at = datetime('now')`,
    args: [
      userId,
      accountId,
      emailId,
      idempotencyKey,
      JSON.stringify({
        uid: emailId,
        arrivalGrace: true,
        queuedAt: now.toISOString(),
        graceDeadline: scheduledFor,
      }),
      scheduledFor,
    ],
  });
  return scheduledFor;
}

export async function attachArrivalGraceEmailToActiveSnapshot(userId, accountId, email, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  // P2-23: callers attaching a batch of new emails can resolve the active
  // snapshot once and pass it here, so each email skips the 3-query
  // getOrCreateActiveSnapshot. The active snapshot is invariant across a batch.
  snapshot: providedSnapshot = null,
} = {}) {
  const emailId = email?.uid || email?.email_id || email?.id;
  if (!userId || !accountId || !emailId) return null;
  const sender = snapshotSenderFromEmail(email);
  const triage = await dbClient.execute({
    sql: `SELECT t.id,
                 j.scheduled_for
          FROM ea_email_triage t
          JOIN ea_triage_jobs j
            ON j.user_id = t.user_id
           AND j.account_id = t.account_id
           AND j.email_id = t.email_id
           AND j.job_type = 'email_triage'
          WHERE t.user_id = ?
            AND t.account_id = ?
            AND t.email_id = ?
            AND t.triage_status = 'pending'
            AND t.triage_source = ?
            AND j.status IN ('queued', 'running')
          ORDER BY j.id DESC
          LIMIT 1`,
    args: [userId, accountId, emailId, ARRIVAL_GRACE_SOURCE],
  });
  const triageRow = triage.rows[0];
  if (!triageRow?.id) return null;

  const scheduledFor = triageRow.scheduled_for || arrivalGraceDeadline(now);
  const snapshot = providedSnapshot || await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  const write = await dbClient.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
             escalation_badge_at_snapshot, subject_at_snapshot,
             from_name_at_snapshot, from_address_at_snapshot, email_date_at_snapshot,
             account_label_at_snapshot, account_email_at_snapshot,
             account_color_at_snapshot, account_icon_at_snapshot, sort_order,
             is_carryover, source, source_at)
          SELECT ?, ?, ?, ?, ?, ?, 'Queued for triage.',
                 'Waiting briefly before triage.', 'normal', NULL,
                 'uncategorized', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?
          WHERE EXISTS (
            SELECT 1
            FROM ea_email_triage t
            JOIN ea_triage_jobs j
              ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.id = ?
              AND t.triage_status = 'pending'
              AND t.triage_source = 'arrival_grace'
              AND j.status IN ('queued', 'running')
          )
          ON CONFLICT(snapshot_id, triage_id) DO UPDATE SET
            lane_at_snapshot = excluded.lane_at_snapshot,
            summary_at_snapshot = excluded.summary_at_snapshot,
            action_at_snapshot = excluded.action_at_snapshot,
            urgency_at_snapshot = excluded.urgency_at_snapshot,
            deadline_at_snapshot = excluded.deadline_at_snapshot,
            category_at_snapshot = excluded.category_at_snapshot,
            escalation_badge_at_snapshot = excluded.escalation_badge_at_snapshot,
            subject_at_snapshot = excluded.subject_at_snapshot,
            from_name_at_snapshot = excluded.from_name_at_snapshot,
            from_address_at_snapshot = excluded.from_address_at_snapshot,
            email_date_at_snapshot = excluded.email_date_at_snapshot,
            account_label_at_snapshot = excluded.account_label_at_snapshot,
            account_email_at_snapshot = excluded.account_email_at_snapshot,
            account_color_at_snapshot = excluded.account_color_at_snapshot,
            account_icon_at_snapshot = excluded.account_icon_at_snapshot,
            is_carryover = 0,
            handled_at = NULL,
            provider_removed_at = NULL,
            source = excluded.source,
            source_at = excluded.source_at,
            updated_at = datetime('now')
          WHERE EXISTS (
            SELECT 1
            FROM ea_email_triage t
            JOIN ea_triage_jobs j
              ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            WHERE t.id = excluded.triage_id
              AND t.triage_status = 'pending'
              AND t.triage_source = 'arrival_grace'
              AND j.status IN ('queued', 'running')
          )`,
    args: [
      snapshot.id,
      Number(triageRow.id),
      userId,
      accountId,
      emailId,
      ARRIVAL_GRACE_QUEUED_LANE,
      email.subject || "",
      sender.fromName,
      sender.fromAddress,
      email.email_date || email.date || null,
      email.account_label || "",
      email.account_email || "",
      email.account_color || "#818cf8",
      email.account_icon || "Mail",
      ARRIVAL_GRACE_SOURCE,
      scheduledFor,
      Number(triageRow.id),
    ],
  });
  if (Number(write.rowsAffected || 0) === 0) return null;

  publishCurrentDashboardEvent(userId, {
    source: "email_triage",
    reason: "email_triage_queued",
    state: "current",
    occurredAt: now.toISOString(),
    details: {
      triggerType: "email_queued",
      eventKey: `email_triage:${accountId}:${emailId}:email_triage_queued`,
      emailId,
      lane: ARRIVAL_GRACE_QUEUED_LANE,
      triageSource: ARRIVAL_GRACE_SOURCE,
      reason: "email_triage_queued",
    },
  });
  return { snapshotId: snapshot.id, triageId: Number(triageRow.id), scheduledFor };
}

export async function completeEmailTriageJobsForEmail(userId, accountId, emailId, {
  dbClient = db,
  now = new Date(),
  lastError = "",
} = {}) {
  const result = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'complete',
              completed_at = ?,
              locked_at = NULL,
              scheduled_for = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND job_type = 'email_triage'
            AND status IN ('queued', 'running')`,
    args: [now.toISOString(), lastError, userId, accountId, emailId],
  });
  return { updated: Number(result.rowsAffected || 0) };
}

export async function restorePendingTriageEligibilityForEmail(userId, accountId, emailId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const current = await dbClient.execute({
    sql: `SELECT triage_source, decision_metadata_json
          FROM ea_email_triage
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
          LIMIT 1`,
    args: [userId, accountId, emailId],
  });
  let metadata = {};
  try {
    metadata = current.rows[0]?.decision_metadata_json
      ? JSON.parse(current.rows[0].decision_metadata_json)
      : {};
  } catch {
    metadata = {};
  }
  const shouldRestartArrivalGrace = current.rows[0]?.triage_source === "user_snoozed_pending"
    && metadata?.snoozedPending?.previousTriageSource === ARRIVAL_GRACE_SOURCE;
  const triageResult = await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET dismissed_at = NULL,
              triage_status = 'pending',
              triage_source = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND last_triaged_at IS NULL
            AND triage_status != 'complete'`,
    args: [
      shouldRestartArrivalGrace ? ARRIVAL_GRACE_SOURCE : "undo_restored_pending",
      userId,
      accountId,
      emailId,
    ],
  });
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
  if (Number(triageResult.rowsAffected || 0) > 0) {
    if (shouldRestartArrivalGrace) {
      await requeueArrivalGraceTriageForEmail(userId, accountId, emailId, { dbClient, now });
    } else {
      await requeueEmailTriageForEmail(userId, accountId, emailId, { dbClient });
    }
  }

  return {
    updated: Number(triageResult.rowsAffected || 0),
    itemsRestored: Number(itemResult.rowsAffected || 0),
  };
}
