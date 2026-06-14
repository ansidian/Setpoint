import db from "../db/connection.js";
import { loadUserConfig } from "../platform/config-service.js";
import { fetchAllEmails } from "../email/email-fetch.js";
import { indexEmails } from "../email/email-index.js";
import { enqueueEmailTriageForEmails } from "../email/gmail-sync.js";
import { getEmailTriageModeForUser } from "../triage/triage-mode.js";
import { getElapsedMs, logTiming } from "../timing.js";
import {
  DEFAULT_TIMEZONE,
  activeSnapshotWindow,
  normalizeCount,
  normalizeSnapshot,
  normalizeSnapshotItem,
} from "./snapshot-lifecycle.js";
import {
  PROVIDER_REMOVED_STATES,
  SNAPSHOT_DISPLAY_LANES,
} from "./snapshot-state-machine.js";
import { completeEmailTriageJobsForEmail } from "./snapshot-triage-attachment.js";
import { insertFeedback, makeHttpError } from "./snapshot-item-mutations.js";

export { activeSnapshotWindow } from "./snapshot-lifecycle.js";
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

async function findActiveSnapshot(dbClient, userId, window) {
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

async function findContainingActiveSnapshot(dbClient, userId, now) {
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

async function freezeExpiredActiveSnapshots(dbClient, userId, window, now) {
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

async function freezeActiveSnapshotsAtBoundary(dbClient, userId, now) {
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

async function loadPreviousFrozenSnapshot(dbClient, userId, window) {
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

async function copyCarryoverItems(dbClient, userId, snapshot, window) {
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
             is_carryover, source, source_at, resurfaced_at)
          SELECT ?, i.triage_id, i.user_id, i.account_id, i.email_id,
                 CASE WHEN i.lane_at_snapshot = 'queued' THEN 'queued' ELSE 'needs_attention' END,
                 i.summary_at_snapshot, i.action_at_snapshot,
                 i.urgency_at_snapshot, i.deadline_at_snapshot, i.category_at_snapshot,
                 i.escalation_badge_at_snapshot, i.subject_at_snapshot,
                 i.from_name_at_snapshot, i.from_address_at_snapshot, i.email_date_at_snapshot,
                 i.account_label_at_snapshot, i.account_email_at_snapshot,
                 i.account_color_at_snapshot, i.account_icon_at_snapshot, i.sort_order,
                 1, i.source, i.source_at, i.resurfaced_at
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
            AND (
              (i.lane_at_snapshot = 'needs_attention' AND t.lane = 'needs_attention')
              OR (i.lane_at_snapshot = 'queued'
                  AND t.triage_status = 'pending'
                  AND t.triage_source = 'arrival_grace')
            )
            AND t.handled_at IS NULL
            AND t.dismissed_at IS NULL
            AND t.provider_state = 'available'`,
    args: [snapshot.id, previous.id, userId],
  });
}

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

async function loadSnapshotItems(dbClient, snapshotId) {
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
  return result.rows.map(normalizeSnapshotItem);
}

async function loadActiveCatchUpItems(dbClient, userId, snapshot) {
  if (!snapshot?.id || !snapshot.start_at) return [];
  const previous = await loadPreviousFrozenSnapshot(dbClient, userId, {
    start_at: snapshot.start_at,
  });
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
  return result.rows.map(normalizeSnapshotItem);
}

async function loadActiveSnapshotItemsForEmail(dbClient, userId, accountId, emailId) {
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

async function loadProcessingState(dbClient, userId) {
  const result = await dbClient.execute({
    sql: `SELECT job_type, status, COUNT(*) AS count
          FROM ea_triage_jobs
          WHERE user_id = ?
            AND job_type IN ('email_triage', 'gmail_history_sync')
            AND status IN ('queued', 'running')
          GROUP BY job_type, status`,
    args: [userId],
  });
  const countsByType = {
    email_triage: { pending: 0, queued: 0, running: 0, total: 0, active: false },
    gmail_history_sync: { pending: 0, queued: 0, running: 0, total: 0, active: false },
  };
  for (const row of result.rows) {
    const type = countsByType[row.job_type];
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
  const mode = await getEmailTriageModeForUser(userId, { dbClient });
  const emailTriage = countsByType.email_triage;
  return {
    queued: emailTriage.queued,
    running: emailTriage.running,
    total: emailTriage.total,
    active: emailTriage.active || countsByType.gmail_history_sync.active,
    ...mode,
    email_triage: countsByType.email_triage,
    gmail_history_sync: countsByType.gmail_history_sync,
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

function parseSortOrder(value) {
  const sortOrder = Number(value);
  return Number.isFinite(sortOrder) ? sortOrder : Number.MAX_SAFE_INTEGER;
}

function parseCreatedAt(value) {
  const createdAt = Date.parse(value || "");
  return Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER;
}

async function loadAccountFilterOrder(dbClient, userId) {
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
    if (String(err?.message || "").includes("no such table: ea_accounts")) {
      return new Map();
    }
    throw err;
  }

  return new Map(result.rows.map((row, index) => [row.id, {
    index,
    sort_order: parseSortOrder(row.sort_order),
    created_at: parseCreatedAt(row.created_at),
  }]));
}

function compareAccountFilters(accountOrder, a, b) {
  const aOrder = accountOrder.get(a.account_id);
  const bOrder = accountOrder.get(b.account_id);
  if (aOrder && bOrder) {
    if (aOrder.sort_order !== bOrder.sort_order) return aOrder.sort_order - bOrder.sort_order;
    if (aOrder.created_at !== bOrder.created_at) return aOrder.created_at - bOrder.created_at;
    return aOrder.index - bOrder.index;
  }
  if (aOrder) return -1;
  if (bOrder) return 1;

  return a.label.localeCompare(b.label) || a.account_id.localeCompare(b.account_id);
}

function buildFilters(items, accountOrder = null) {
  const accountMap = new Map();
  const categoryMap = new Map();

  for (const item of items) {
    const existingAccount = accountMap.get(item.account_id);
    if (existingAccount) {
      existingAccount.count += 1;
    } else {
      accountMap.set(item.account_id, {
        account_id: item.account_id,
        label: item.account_label,
        email: item.account_email,
        color: item.account_color,
        icon: item.account_icon,
        count: 1,
      });
    }

    const category = item.category || "uncategorized";
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
  }

  return {
    accounts: [...accountMap.values()].sort((a, b) => (
      accountOrder
        ? compareAccountFilters(accountOrder, a, b)
        : b.count - a.count || a.label.localeCompare(b.label)
    )),
    categories: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

function buildLanes(items) {
  const lanes = {
    queued: [],
    needs_attention: [],
    fyi: [],
    handled: [],
    untriaged_read: [],
    noise: [],
  };
  const carryover = [];

  for (const item of items) {
    if (item.handled_at) {
      lanes.handled.push(item);
      continue;
    }
    if (item.is_carryover) {
      carryover.push(item);
      continue;
    }
    if (item.lane === "catch_up") {
      if (!lanes.catch_up) lanes.catch_up = [];
      lanes.catch_up.push(item);
      continue;
    }
    if (lanes[item.lane]) lanes[item.lane].push(item);
  }

  return { lanes, carryover };
}

function emptyProcessingState() {
  return {
    queued: 0,
    running: 0,
    total: 0,
    active: false,
    email_triage_mode: "auto",
    effective_email_triage_mode: "no_model",
    email_triage: {
      pending: 0,
      queued: 0,
      running: 0,
      total: 0,
      active: false,
    },
    gmail_history_sync: {
      pending: 0,
      queued: 0,
      running: 0,
      total: 0,
      active: false,
    },
  };
}

function buildSnapshotView(snapshot, items, processing = emptyProcessingState(), accountOrder = null) {
  const { lanes, carryover } = buildLanes(items);
  const laneCounts = {
    queued: lanes.queued.length,
    needs_attention: lanes.needs_attention.length,
    fyi: lanes.fyi.length,
    handled: lanes.handled.length,
    untriaged_read: lanes.untriaged_read.length,
    noise: lanes.noise.length,
    carryover: carryover.length,
  };
  if (lanes.catch_up?.length > 0) laneCounts.catch_up = lanes.catch_up.length;
  return {
    snapshot,
    readOnly: snapshot?.status !== "active",
    lanes,
    carryover,
    laneCounts,
    processing,
    filters: buildFilters(items, accountOrder),
  };
}

async function loadSnapshotById(dbClient, userId, snapshotId) {
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

async function loadSnapshotHistoryRows(dbClient, userId) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
          ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                   start_at DESC,
                   id DESC`,
    args: [userId],
  });
  return result.rows.map(normalizeSnapshot);
}

async function loadSnapshotHistoryCounts(dbClient, snapshotIds) {
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

  const counts = new Map();
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
    if (SNAPSHOT_DISPLAY_LANES.has(row.lane_at_snapshot)) {
      snapshotCounts[row.lane_at_snapshot] += normalizeCount(row.count);
    }
  }
  return counts;
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
  const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  const items = snapshot ? await loadSnapshotItems(dbClient, snapshot.id) : [];
  const catchUpItems = snapshot ? await loadActiveCatchUpItems(dbClient, userId, snapshot) : [];
  const accountOrder = await loadAccountFilterOrder(dbClient, userId);
  const processing = await loadProcessingState(dbClient, userId);
  return buildSnapshotView(snapshot, [...items, ...catchUpItems], processing, accountOrder);
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
    let processed = 0;
    let paused = false;
    for (let i = 0; i < 25; i++) {
      const result = await processNextEmailTriageJobFn({ dbClient, now });
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
