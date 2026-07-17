// Persistence layer for the briefing snapshot: all ea_briefing_snapshots /
// ea_briefing_snapshot_items reads + lifecycle writes (find/freeze/carryover),
// item loads for the view, processing-state counts, and history rows/counts.
// The service (snapshot-service.ts) orchestrates these; the view model shapes them.
import {
  normalizeCount,
  normalizeSnapshot,
  normalizeSnapshotItem,
  type SnapshotItemRow,
} from "./snapshot-lifecycle.ts";
import { SNAPSHOT_DISPLAY_LANES } from "./snapshot-state-machine.ts";
import { getEmailTriageModeForUser } from "../triage/triage-mode.ts";
import type {
  SnapshotItem,
  SnapshotJobType,
  SnapshotLaneCounts,
  SnapshotProcessingState,
  SnapshotRecord,
  SnapshotWindow,
} from "../../shared/types/snapshots.ts";
import type { Client } from "@libsql/client";
import type { SnapshotReadDb } from "./snapshot-types.ts";
import { errorMessage } from "./snapshot-types.ts";
import type { SnapshotAccountOrder } from "./snapshotViewModel.ts";

// Max times an unhandled needs_attention/queued item re-copies into a new active
// snapshot before it ages out of carryover (per-item age expiry, NOT a capacity
// cap -- see ADR 0007 / exec-plan SS5.6). Boundaries fire ~twice daily, so 6 ~ 3
// days of re-surfacing.
export const CARRYOVER_MAX_DEPTH = 6;

export async function findActiveSnapshot(dbClient: SnapshotReadDb, userId: string, window: SnapshotWindow): Promise<SnapshotRecord | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND start_at = ?
            AND end_at = ?
            AND status = 'active'
          LIMIT 1`,
    args: [userId, window.start_at, window.end_at],
  });
  return normalizeSnapshot(result.rows[0]);
}

export async function findContainingActiveSnapshot(dbClient: SnapshotReadDb, userId: string, now: Date): Promise<SnapshotRecord | null> {
  const nowIso = now.toISOString();
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND status = 'active'
            AND start_at <= ?
            AND end_at > ?
          ORDER BY start_at DESC
          LIMIT 1`,
    args: [userId, nowIso, nowIso],
  });
  return normalizeSnapshot(result.rows[0]);
}

export async function freezeExpiredActiveSnapshots(
  dbClient: SnapshotReadDb,
  userId: string,
  window: Pick<SnapshotWindow, "start_at">,
  now: Date,
): Promise<void> {
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshots
          SET status = 'frozen',
              frozen_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND status = 'active'
            AND end_at <= ?`,
    args: [now.toISOString(), userId, window.start_at],
  });
}

export async function freezeActiveSnapshotsAtBoundary(dbClient: SnapshotReadDb, userId: string, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshots
          SET status = 'frozen',
              end_at = ?,
              frozen_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND status = 'active'
            AND start_at < ?
            AND end_at > ?`,
    args: [nowIso, nowIso, userId, nowIso, nowIso],
  });
}

export async function loadPreviousFrozenSnapshot(
  dbClient: SnapshotReadDb,
  userId: string,
  window: Pick<SnapshotWindow, "start_at">,
): Promise<SnapshotRecord | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND status = 'frozen'
            AND end_at <= ?
          ORDER BY end_at DESC
          LIMIT 1`,
    args: [userId, window.start_at],
  });
  return normalizeSnapshot(result.rows[0]);
}

export async function copyCarryoverItems(
  dbClient: SnapshotReadDb,
  userId: string,
  snapshot: SnapshotRecord,
  window: SnapshotWindow,
): Promise<void> {
  const previous = await loadPreviousFrozenSnapshot(dbClient, userId, window);
  if (!previous) return;

  await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
             escalation_badge_at_snapshot, subject_at_snapshot,
             from_name_at_snapshot, from_address_at_snapshot, email_date_at_snapshot,
             account_label_at_snapshot, account_email_at_snapshot,
             account_color_at_snapshot, account_icon_at_snapshot, sort_order,
             is_carryover, carryover_count, source, source_at, resurfaced_at)
          SELECT ?, i.triage_id, i.user_id, i.account_id, i.email_id,
                 CASE WHEN i.lane_at_snapshot = 'queued' THEN 'queued' ELSE 'needs_attention' END,
                 i.summary_at_snapshot, i.action_at_snapshot,
                 i.urgency_at_snapshot, i.deadline_at_snapshot, i.category_at_snapshot,
                 i.escalation_badge_at_snapshot, i.subject_at_snapshot,
                 i.from_name_at_snapshot, i.from_address_at_snapshot, i.email_date_at_snapshot,
                 i.account_label_at_snapshot, i.account_email_at_snapshot,
                 i.account_color_at_snapshot, i.account_icon_at_snapshot, i.sort_order,
                 1, COALESCE(i.carryover_count, 0) + 1, i.source, i.source_at, i.resurfaced_at
          FROM ea_briefing_snapshot_items i
          JOIN ea_email_triage t
            ON t.id = i.triage_id
           AND t.user_id = i.user_id
          WHERE i.snapshot_id = ?
            AND i.user_id = ?
            AND i.lane_at_snapshot IN ('needs_attention', 'queued')
            AND i.dismissed_from_today_at IS NULL
            AND i.handled_at IS NULL
            AND i.provider_removed_at IS NULL
            AND COALESCE(i.carryover_count, 0) < ?
            AND (
              (i.lane_at_snapshot = 'needs_attention' AND t.lane = 'needs_attention')
              OR (i.lane_at_snapshot = 'queued'
                  AND t.triage_status = 'pending'
                  AND t.triage_source = 'arrival_grace')
            )
            AND t.handled_at IS NULL
            AND t.dismissed_at IS NULL
            AND t.provider_state = 'available'`,
    args: [snapshot.id, previous.id, userId, CARRYOVER_MAX_DEPTH],
  });
}

export async function loadSnapshotItems(dbClient: SnapshotReadDb, snapshotId: number): Promise<SnapshotItem[]> {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 idx.from_name AS index_from_name,
                 idx.from_address AS index_from_address,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.snapshot_id = ?
            AND i.dismissed_from_today_at IS NULL
            AND i.provider_removed_at IS NULL
          ORDER BY CASE WHEN i.handled_at IS NOT NULL THEN 1 ELSE 0 END ASC,
                   i.is_carryover DESC,
                   CASE WHEN i.handled_at IS NOT NULL THEN i.handled_at END DESC,
                   i.sort_order ASC,
                   i.email_date_at_snapshot DESC,
                   i.id ASC`,
    args: [snapshotId],
  });
  return result.rows.map((row) => normalizeSnapshotItem(row as unknown as SnapshotItemRow));
}

export async function loadActiveCatchUpItems(
  dbClient: SnapshotReadDb,
  userId: string,
  snapshot: SnapshotRecord,
  { previousFrozen }: { previousFrozen?: Promise<SnapshotRecord | null> } = {},
): Promise<SnapshotItem[]> {
  if (!snapshot?.id || !snapshot.start_at) return [];
  const previous = previousFrozen !== undefined
    ? await previousFrozen
    : await loadPreviousFrozenSnapshot(dbClient, userId, { start_at: snapshot.start_at });
  if (!previous) return [];

  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 0 AS read,
                 idx.from_name AS index_from_name,
                 idx.from_address AS index_from_address,
                 'catch_up' AS source,
                 1 AS catch_up,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
           AND idx.read = 0
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.snapshot_id = ?
            AND i.user_id = ?
            AND i.lane_at_snapshot = 'fyi'
            AND i.dismissed_from_today_at IS NULL
            AND i.handled_at IS NULL
            AND i.provider_removed_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM ea_briefing_snapshot_items active_i
              WHERE active_i.snapshot_id = ?
                AND active_i.user_id = i.user_id
                AND active_i.account_id = i.account_id
                AND active_i.email_id = i.email_id
                AND active_i.dismissed_from_today_at IS NULL
                AND active_i.provider_removed_at IS NULL
            )
          ORDER BY i.sort_order ASC,
                   i.email_date_at_snapshot DESC,
                   i.id ASC`,
    args: [previous.id, userId, snapshot.id],
  });
  return result.rows.map((row) => normalizeSnapshotItem(row as unknown as SnapshotItemRow));
}

export async function loadCarryoverAgedOutCount(
  dbClient: SnapshotReadDb,
  userId: string,
  snapshot: SnapshotRecord,
  { previousFrozen }: { previousFrozen?: Promise<SnapshotRecord | null> } = {},
): Promise<number> {
  if (!snapshot?.id || !snapshot.start_at) return 0;
  const previous = previousFrozen !== undefined
    ? await previousFrozen
    : await loadPreviousFrozenSnapshot(dbClient, userId, { start_at: snapshot.start_at });
  if (!previous) return 0;

  // Items eligible to carry on every condition EXCEPT the depth bound -- i.e. the
  // ones copyCarryoverItems dropped solely because carryover_count >= maxDepth.
  const result = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count
          FROM ea_briefing_snapshot_items i
          JOIN ea_email_triage t
            ON t.id = i.triage_id
           AND t.user_id = i.user_id
          WHERE i.snapshot_id = ?
            AND i.user_id = ?
            AND i.lane_at_snapshot IN ('needs_attention', 'queued')
            AND i.dismissed_from_today_at IS NULL
            AND i.handled_at IS NULL
            AND i.provider_removed_at IS NULL
            AND COALESCE(i.carryover_count, 0) >= ?
            AND (
              (i.lane_at_snapshot = 'needs_attention' AND t.lane = 'needs_attention')
              OR (i.lane_at_snapshot = 'queued'
                  AND t.triage_status = 'pending'
                  AND t.triage_source = 'arrival_grace')
            )
            AND t.handled_at IS NULL
            AND t.dismissed_at IS NULL
            AND t.provider_state = 'available'`,
    args: [previous.id, userId, CARRYOVER_MAX_DEPTH],
  });
  return Number(result.rows[0]?.count || 0);
}

export async function loadActiveSnapshotItemsForEmail(
  dbClient: SnapshotReadDb,
  userId: string,
  accountId: string,
  emailId: string,
) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 t.provider_state,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          JOIN ea_email_triage t
            ON t.id = i.triage_id
           AND t.user_id = i.user_id
          WHERE i.user_id = ?
            AND i.account_id = ?
            AND i.email_id = ?
            AND i.provider_removed_at IS NULL`,
    args: [userId, accountId, emailId],
  });
  return result.rows;
}

export async function loadProcessingState(dbClient: SnapshotReadDb, userId: string): Promise<SnapshotProcessingState> {
  // The job-count GROUP BY (ea_triage_jobs) and the triage-mode read (ea_settings)
  // hit disjoint tables with no ordering dependency, so resolve them concurrently
  // instead of as two serial Turso round-trips on the every-/current snapshot-view
  // critical path (P1-7 pattern).
  const [result, mode] = await Promise.all([
    dbClient.execute({
      sql: `SELECT job_type, status, COUNT(*) AS count
            FROM ea_triage_jobs
            WHERE user_id = ?
              AND job_type IN ('email_triage', 'gmail_history_sync')
              AND status IN ('queued', 'running')
            GROUP BY job_type, status`,
      args: [userId],
    }),
    getEmailTriageModeForUser(userId, { dbClient: dbClient as Client }),
  ]);
  const countsByType: Record<SnapshotJobType, SnapshotProcessingState[SnapshotJobType]> = {
    email_triage: { pending: 0, queued: 0, running: 0, total: 0, active: false },
    gmail_history_sync: { pending: 0, queued: 0, running: 0, total: 0, active: false },
  };
  for (const row of result.rows) {
    const jobType = String(row.job_type);
    if (jobType !== "email_triage" && jobType !== "gmail_history_sync") continue;
    const type = countsByType[jobType];
    if (!type) continue;
    if (row.status === "queued") {
      type.pending = normalizeCount(row.count);
      type.queued = type.pending;
    }
    if (row.status === "running") type.running = normalizeCount(row.count);
  }
  for (const type of Object.values(countsByType)) {
    type.total = type.pending + type.running;
    type.active = type.total > 0;
  }
  const emailTriage = countsByType.email_triage;
  return {
    queued: emailTriage.queued,
    running: emailTriage.running,
    total: emailTriage.total,
    active: emailTriage.active || countsByType.gmail_history_sync.active,
    ...(mode as Pick<SnapshotProcessingState, "email_triage_mode" | "effective_email_triage_mode">),
    email_triage: countsByType.email_triage,
    gmail_history_sync: countsByType.gmail_history_sync,
  };
}

function parseSortOrder(value: unknown): number {
  const sortOrder = Number(value);
  return Number.isFinite(sortOrder) ? sortOrder : Number.MAX_SAFE_INTEGER;
}

function parseCreatedAt(value: unknown): number {
  const createdAt = Date.parse(String(value || ""));
  return Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER;
}

export async function loadAccountFilterOrder(dbClient: SnapshotReadDb, userId: string): Promise<SnapshotAccountOrder> {
  let result;
  try {
    result = await dbClient.execute({
      sql: `SELECT id, sort_order, created_at
            FROM ea_accounts
            WHERE user_id = ?
            ORDER BY sort_order ASC, created_at ASC, id ASC`,
      args: [userId],
    });
  } catch (err) {
    if (errorMessage(err).includes("no such table: ea_accounts")) {
      return new Map();
    }
    throw err;
  }

  return new Map(result.rows.map((row, index) => [String(row.id), {
    index,
    sort_order: parseSortOrder(row.sort_order),
    created_at: parseCreatedAt(row.created_at),
  }]));
}

export async function loadSnapshotById(dbClient: SnapshotReadDb, userId: string, snapshotId: number): Promise<SnapshotRecord | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND id = ?
          LIMIT 1`,
    args: [userId, snapshotId],
  });
  return normalizeSnapshot(result.rows[0]);
}

export async function loadSnapshotHistoryRows(dbClient: SnapshotReadDb, userId: string): Promise<SnapshotRecord[]> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
          ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                   start_at DESC,
                   id DESC`,
    args: [userId],
  });
  return result.rows.map(normalizeSnapshot).filter((row): row is SnapshotRecord => row !== null);
}

export async function loadSnapshotHistoryCounts(
  dbClient: SnapshotReadDb,
  snapshotIds: number[],
): Promise<Map<number, SnapshotLaneCounts>> {
  if (!snapshotIds.length) return new Map();
  const placeholders = snapshotIds.map(() => "?").join(", ");
  const result = await dbClient.execute({
    sql: `SELECT snapshot_id,
                 lane_at_snapshot,
                 is_carryover,
                 CASE WHEN handled_at IS NOT NULL THEN 1 ELSE 0 END AS is_handled,
                 COUNT(*) AS count
          FROM ea_briefing_snapshot_items
          WHERE snapshot_id IN (${placeholders})
            AND dismissed_from_today_at IS NULL
            AND provider_removed_at IS NULL
          GROUP BY snapshot_id, lane_at_snapshot, is_carryover, is_handled`,
    args: snapshotIds,
  });

  const counts = new Map<number, SnapshotLaneCounts>();
  for (const id of snapshotIds) {
    counts.set(Number(id), {
      queued: 0,
      needs_attention: 0,
      fyi: 0,
      handled: 0,
      untriaged_read: 0,
      noise: 0,
      carryover: 0,
    });
  }
  for (const row of result.rows) {
    const snapshotCounts = counts.get(Number(row.snapshot_id));
    if (!snapshotCounts) continue;
    if (Number(row.is_handled)) {
      snapshotCounts.handled += normalizeCount(row.count);
      continue;
    }
    if (Number(row.is_carryover)) {
      snapshotCounts.carryover += normalizeCount(row.count);
      continue;
    }
    const lane = String(row.lane_at_snapshot);
    if (SNAPSHOT_DISPLAY_LANES.has(lane)) {
      snapshotCounts[lane as keyof Omit<SnapshotLaneCounts, "catch_up" | "carryover">] += normalizeCount(row.count);
    }
  }
  return counts;
}
