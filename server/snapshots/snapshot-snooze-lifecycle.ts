/**
 * Snooze defer/resurface plumbing plus read-state settlement for the active
 * snapshot: hiding a pending-triage row while it is snoozed, re-attaching a
 * woken snooze (coordination with snooze-waker.ts), and settling
 * arrival-grace rows that the owner read before triage ran. Extracted from
 * snapshot-service.ts (EAD-324); snapshot-service re-exports every public
 * symbol here, so external callers are unchanged.
 */

import db from "../db/connection.ts";
import {
  ARRIVAL_GRACE_READ_SOURCE,
  ARRIVAL_GRACE_SOURCE,
  ARRIVAL_GRACE_UNTRIAGED_READ_LANE,
} from "./arrival-grace.ts";
import {
  DEFAULT_TIMEZONE,
  normalizeSnapshotItem,
  snapshotDate,
  snapshotString,
  type SnapshotItemRow,
} from "./snapshot-lifecycle.ts";
import { resurfacedTriageLane } from "./snapshot-state-machine.ts";
import { completeEmailTriageJobsForEmail } from "./snapshot-triage-attachment.ts";
import { getOrCreateActiveSnapshot } from "./snapshot-service.ts";
import { getEmailTriageClassifyReadArrivalsForUser } from "../platform/config-service.ts";
import type { SnapshotItem, SnapshotTriageLane } from "../../shared/types/snapshots.ts";
import type { SnapshotEmailSource, SnapshotWriteDb } from "./snapshot-types.ts";

interface SnoozedPendingMetadata extends Record<string, unknown> {
  snoozedPending?: {
    previousTriageSource?: string;
    snoozedAt?: string;
  };
}

interface ResurfaceOptions {
  dbClient?: SnapshotWriteDb;
  now?: Date;
  timeZone?: string;
  resurfacedAt?: number;
  pendingTriage?: boolean;
}

async function upsertResurfacedTriage(
  dbClient: SnapshotWriteDb,
  userId: string,
  snapshot: SnapshotEmailSource,
  nowIso: string,
  {
  pendingTriage = false,
  }: { pendingTriage?: boolean } = {},
): Promise<{ triageId: number; accountId: string; emailId: string; lane: SnapshotTriageLane } | null> {
  const accountId = snapshotString(snapshot?.account_id, snapshot?.accountId, snapshot?._accountKey);
  const emailId = snapshotString(snapshot?.uid, snapshot?.email_id, snapshot?.id);
  if (!accountId || !emailId) return null;

  const lane = resurfacedTriageLane(snapshot);
  const triageStatus = pendingTriage ? "pending" : "complete";
  const triageSource = pendingTriage ? "snooze_resurface_pending" : "snooze_resurface";
  const lastTriagedAt = pendingTriage ? null : nowIso;
  await dbClient.execute({
    sql: `INSERT INTO ea_email_triage
            (user_id, account_id, email_id, thread_id, lane, category, urgency,
             escalation_badge, summary, action, deadline_at, triage_status,
             triage_source, last_triaged_at, provider_state, handled_at, dismissed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, 'available', NULL, NULL)
          ON CONFLICT(user_id, account_id, email_id) DO UPDATE SET
            lane = excluded.lane,
            category = excluded.category,
            urgency = excluded.urgency,
            escalation_badge = excluded.escalation_badge,
            summary = excluded.summary,
            action = excluded.action,
            deadline_at = excluded.deadline_at,
            triage_status = excluded.triage_status,
            triage_source = excluded.triage_source,
            last_triaged_at = excluded.last_triaged_at,
            provider_state = 'available',
            handled_at = NULL,
            dismissed_at = NULL,
            updated_at = datetime('now')`,
    args: [
      userId,
      accountId,
      emailId,
      snapshot?.thread_id || snapshot?.threadId || null,
      lane,
      snapshot?.category || "uncategorized",
      snapshot?.urgency || "normal",
      snapshot?.escalation_badge || snapshot?.urgentFlag?.label || null,
      snapshotString(snapshot?.summary, snapshot?.preview, snapshot?.body_preview),
      snapshotString(snapshot?.action),
      snapshot?.deadline_at || null,
      triageStatus,
      triageSource,
      lastTriagedAt,
    ],
  });

  const result = await dbClient.execute({
    sql: `SELECT id
          FROM ea_email_triage
          WHERE user_id = ? AND account_id = ? AND email_id = ?
          LIMIT 1`,
    args: [userId, accountId, emailId],
  });
  return {
    triageId: Number(result.rows[0]?.id),
    accountId,
    emailId,
    lane,
  };
}

export async function attachResurfacedSnoozeToActiveSnapshot(userId: string, snapshot: SnapshotEmailSource, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  resurfacedAt = now.getTime(),
  pendingTriage = false,
}: ResurfaceOptions = {}): Promise<SnapshotItem | null> {
  const nowIso = now.toISOString();
  const triage = await upsertResurfacedTriage(dbClient, userId, snapshot, nowIso, {
    pendingTriage,
  });
  if (!triage?.triageId) return null;

  const activeSnapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  await dbClient.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
             escalation_badge_at_snapshot, subject_at_snapshot, from_name_at_snapshot,
             from_address_at_snapshot, email_date_at_snapshot, account_label_at_snapshot,
             account_email_at_snapshot, account_color_at_snapshot, account_icon_at_snapshot,
             sort_order, is_carryover, source, source_at, resurfaced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0,
                  'resurfaced_snooze', ?, ?)
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
            dismissed_from_today_at = NULL,
            handled_at = NULL,
            provider_removed_at = NULL,
            source = excluded.source,
            source_at = excluded.source_at,
            resurfaced_at = excluded.resurfaced_at,
            updated_at = datetime('now')`,
    args: [
      activeSnapshot!.id,
      triage.triageId,
      userId,
      triage.accountId,
      triage.emailId,
      triage.lane,
      snapshotString(snapshot?.summary, snapshot?.preview, snapshot?.body_preview),
      snapshotString(snapshot?.action),
      snapshot?.urgency || "normal",
      snapshot?.deadline_at || null,
      snapshot?.category || "uncategorized",
      snapshot?.escalation_badge || snapshot?.urgentFlag?.label || null,
      snapshotString(snapshot?.subject),
      snapshotString(snapshot?.from_name, snapshot?.from),
      snapshotString(snapshot?.from_address, snapshot?.from_email, snapshot?.fromEmail),
      snapshotDate(snapshot),
      snapshotString(snapshot?.account_label),
      snapshotString(snapshot?.account_email),
      snapshot?.account_color || "#818cf8",
      snapshot?.account_icon || "Mail",
      nowIso,
      resurfacedAt,
    ],
  });

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
          WHERE i.snapshot_id = ?
            AND i.triage_id = ?
          LIMIT 1`,
    args: [activeSnapshot!.id, triage.triageId],
  });
  return result.rows[0]
    ? normalizeSnapshotItem(result.rows[0] as unknown as SnapshotItemRow)
    : null;
}

export async function deferPendingTriageForSnooze(
  userId: string,
  accountId: string,
  emailId: string,
  untilTs: string | number | Date,
  {
  dbClient = db,
  now = new Date(),
  }: { dbClient?: SnapshotWriteDb; now?: Date } = {},
): Promise<{ updated: number; jobsUpdated: number; itemsHidden: number }> {
  const scheduledFor = new Date(untilTs).toISOString();
  const hiddenAt = now.toISOString();
  const current = await dbClient.execute({
    sql: `SELECT triage_source, decision_metadata_json
          FROM ea_email_triage
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND triage_status = 'pending'
          LIMIT 1`,
    args: [userId, accountId, emailId],
  });
  const previousSource = current.rows[0]?.triage_source == null
    ? null
    : String(current.rows[0].triage_source);
  let metadata: SnoozedPendingMetadata = {};
  try {
    metadata = current.rows[0]?.decision_metadata_json
      ? JSON.parse(String(current.rows[0].decision_metadata_json)) as SnoozedPendingMetadata
      : {};
  } catch {
    metadata = {};
  }
  if (previousSource) {
    metadata = {
      ...metadata,
      snoozedPending: {
        ...(metadata.snoozedPending || {}),
        previousTriageSource: previousSource,
        snoozedAt: hiddenAt,
      },
    };
  }
  const triageResult = await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET triage_source = 'user_snoozed_pending',
              decision_metadata_json = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND triage_status = 'pending'`,
    args: [JSON.stringify(metadata), userId, accountId, emailId],
  });
  const jobsResult = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              scheduled_for = ?,
              completed_at = NULL,
              last_error = 'Deferred pending triage while snoozed',
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND job_type = 'email_triage'
            AND status IN ('queued', 'running')`,
    args: [scheduledFor, userId, accountId, emailId],
  });
  const itemResult = await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET dismissed_from_today_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND dismissed_from_today_at IS NULL
            AND provider_removed_at IS NULL
            AND snapshot_id IN (
              SELECT id FROM ea_briefing_snapshots
              WHERE user_id = ? AND status = 'active'
            )`,
    args: [hiddenAt, userId, accountId, emailId, userId],
  });

  return {
    updated: Number(triageResult.rowsAffected || 0),
    jobsUpdated: Number(jobsResult.rowsAffected || 0),
    itemsHidden: Number(itemResult.rowsAffected || 0),
  };
}

export async function settleReadArrivalGraceRows(userId: string, {
  dbClient = db,
  now = new Date(),
  emailIds = null,
}: { dbClient?: SnapshotWriteDb; now?: Date; emailIds?: string[] | null } = {}): Promise<{ settled: number; emailIds: string[] }> {
  if (await getEmailTriageClassifyReadArrivalsForUser(userId, { dbClient })) {
    return { settled: 0, emailIds: [] };
  }
  const ids = Array.isArray(emailIds) ? [...new Set(emailIds.filter(Boolean))] : null;
  const emailFilter = ids?.length
    ? `AND t.email_id IN (${ids.map(() => "?").join(", ")})`
    : "";
  const result = await dbClient.execute({
    sql: `SELECT t.id,
                 t.account_id,
                 t.email_id
          FROM ea_email_triage t
          JOIN ea_email_index idx
            ON idx.user_id = t.user_id
           AND idx.account_id = t.account_id
           AND idx.uid = t.email_id
           AND idx.read = 1
          WHERE t.user_id = ?
            AND t.triage_status = 'pending'
            AND t.triage_source = ?
            ${emailFilter}
          ORDER BY t.id ASC`,
    args: [userId, ARRIVAL_GRACE_SOURCE, ...(ids || [])],
  });
  const rows = result.rows;
  if (!rows.length) return { settled: 0, emailIds: [] };

  const settledAt = now.toISOString();
  for (const row of rows) {
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_status = 'skipped',
                triage_source = ?,
                lane = 'fyi',
                category = 'uncategorized',
                urgency = 'low',
                escalation_badge = NULL,
                summary = 'Read during arrival grace.',
                action = 'No triage needed.',
                confidence = NULL,
                model_usage_json = '{}',
                estimated_cost_usd = NULL,
                latency_ms = NULL,
                bill_candidate_json = NULL,
                last_triaged_at = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [ARRIVAL_GRACE_READ_SOURCE, settledAt, Number(row.id)],
    });
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshot_items
            SET lane_at_snapshot = ?,
                summary_at_snapshot = 'Read during arrival grace.',
                action_at_snapshot = 'No triage needed.',
                urgency_at_snapshot = 'low',
                category_at_snapshot = 'uncategorized',
                escalation_badge_at_snapshot = NULL,
                is_carryover = 0,
                source = ?,
                source_at = ?,
                updated_at = datetime('now')
            WHERE user_id = ?
              AND account_id = ?
              AND email_id = ?
              AND snapshot_id IN (
                SELECT id
                FROM ea_briefing_snapshots
                WHERE user_id = ? AND status = 'active'
              )
              AND provider_removed_at IS NULL`,
      args: [
        ARRIVAL_GRACE_UNTRIAGED_READ_LANE,
        ARRIVAL_GRACE_READ_SOURCE,
        settledAt,
        userId,
        String(row.account_id),
        String(row.email_id),
        userId,
      ],
    });
    await completeEmailTriageJobsForEmail(userId, String(row.account_id), String(row.email_id), {
      dbClient,
      now,
      lastError: "Skipped arrival-grace triage; message was read",
    });
  }

  return {
    settled: rows.length,
    emailIds: rows.map((row) => String(row.email_id)),
  };
}
