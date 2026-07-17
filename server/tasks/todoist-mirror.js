import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import {
  fetchTodoistSyncResources,
  TODOIST_MIRROR_RESOURCE_TYPES,
} from "./todoist-api.js";
import {
  deleteSourceReminders,
  recomputeUnsentRemindersForSource,
} from "../reminders/reminder-service.ts";
import { todoistReminderAnchorFromTask } from "./todoist-reminder-source.js";
import { getTodoistApiToken } from "./todoist-token.js";
import {
  normalizeId,
  fullSyncTombstoneStatements,
  completedOccurrenceReconcileStatement,
  itemStatement,
  projectStatement,
  labelStatement,
  stateSuccessStatement,
} from "./todoistMirrorStatements.js";
import { computeTodoistMirrorHealth } from "./todoistMirrorHealthModel.js";

function iso(now) {
  return now.toISOString();
}

function anchorsEqual(left, right) {
  return left?.anchorKind === right?.anchorKind && left?.anchorAt === right?.anchorAt;
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mirrorItemToTodoistTask(row) {
  const dueDateTime = row.due_datetime || row.due_date || null;
  return {
    id: String(row.item_id),
    content: row.content || "",
    description: row.description || "",
    project_id: normalizeId(row.project_id),
    checked: !!row.checked,
    is_deleted: !!row.is_deleted,
    due: dueDateTime
      ? {
          date: dueDateTime,
          timezone: row.due_timezone || null,
          is_recurring: !!row.due_is_recurring,
        }
      : null,
    priority: row.priority ?? null,
    labels: parseJsonArray(row.labels_json),
  };
}

async function loadTodoistToken(userId, dbClient) {
  return getTodoistApiToken(userId, { dbClient });
}

async function loadSyncState(userId, dbClient) {
  const result = await dbClient.execute({
    sql: "SELECT * FROM ea_todoist_sync_state WHERE user_id = ?",
    args: [userId],
  });
  return result.rows[0] || null;
}

async function loadExistingReminderRows(userId, items, dbClient) {
  const ids = [...new Set((items || []).map((item) => normalizeId(item.id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await dbClient.execute({
    sql: `SELECT item_id, checked, is_deleted, due_date, due_datetime, due_timezone
          FROM ea_todoist_items
          WHERE user_id = ? AND item_id IN (${placeholders})`,
    args: [userId, ...ids],
  });
  return new Map(result.rows.map((row) => [String(row.item_id), row]));
}

// P2-21: collect the reminder-reconcile mutations as statements (the reads still
// run here against dbClient) so applySyncResponse can fold them into the same
// batched transaction as the item upserts, restoring atomicity and replacing the
// per-item serial round-trips.
async function collectTodoistReminderReconcileStatements(userId, items, previousRows, dbClient) {
  const statements = [];
  for (const item of items || []) {
    const sourceItemId = normalizeId(item.id);
    if (!sourceItemId) continue;

    if (item.is_deleted) {
      const stmt = await deleteSourceReminders({
        userId,
        sourceType: "todoist_task",
        sourceItemId,
      }, { dbClient, collect: true });
      if (stmt) statements.push(stmt);
      continue;
    }

    if (item.checked) {
      const stmt = await deleteSourceReminders({
        userId,
        sourceType: "todoist_task",
        sourceItemId,
        unsentOnly: true,
      }, { dbClient, collect: true });
      if (stmt) statements.push(stmt);
      continue;
    }

    const nextAnchor = todoistReminderAnchorFromTask(item);
    if (!nextAnchor?.anchorAt) {
      const stmt = await deleteSourceReminders({
        userId,
        sourceType: "todoist_task",
        sourceItemId,
        unsentOnly: true,
      }, { dbClient, collect: true });
      if (stmt) statements.push(stmt);
      continue;
    }

    const previousRow = previousRows.get(sourceItemId);
    if (!previousRow) continue;
    const previousAnchor = todoistReminderAnchorFromTask(previousRow);
    if (anchorsEqual(previousAnchor, nextAnchor)) continue;

    const recomputeStatements = await recomputeUnsentRemindersForSource({
      userId,
      sourceType: "todoist_task",
      sourceItemId,
      anchorKind: nextAnchor.anchorKind,
      anchorAt: nextAnchor.anchorAt,
    }, { dbClient, collect: true });
    if (Array.isArray(recomputeStatements)) statements.push(...recomputeStatements);
  }
  return statements;
}

export async function recordTodoistSyncRequest(userId, {
  dbClient = db,
  reason = "manual",
  now = new Date(),
} = {}) {
  if (!userId) return { recorded: false };
  const timestamp = iso(now);
  await dbClient.execute({
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, status, sync_requested_at, sync_request_reason, updated_at)
          VALUES (?, 'idle', ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            sync_requested_at = excluded.sync_requested_at,
            sync_request_reason = excluded.sync_request_reason,
            updated_at = excluded.updated_at`,
    args: [userId, timestamp, reason, timestamp],
  });
  publishCurrentDashboardEvent(userId, {
    source: "todoist",
    reason,
    state: "needs_sync",
    occurredAt: timestamp,
  });
  return { recorded: true, syncRequestedAt: timestamp, reason };
}

export async function listTodoistMirrorActiveTasks(userId, {
  dbClient = db,
  start = null,
  end = null,
} = {}) {
  const rangeSql = start && end ? " AND due_date >= ? AND due_date <= ?" : "";
  const rangeArgs = start && end ? [start, end] : [];
  const result = await dbClient.execute({
    sql: `SELECT item_id, project_id, content, description, checked, is_deleted,
                 due_date, due_datetime, due_timezone, due_is_recurring, priority, labels_json
          FROM ea_todoist_items
          WHERE user_id = ?
            AND checked = 0
            AND is_deleted = 0
            AND due_date IS NOT NULL${rangeSql}
          ORDER BY due_date ASC, due_datetime ASC, item_id ASC`,
    args: [userId, ...rangeArgs],
  });
  return result.rows.map(mirrorItemToTodoistTask);
}

export async function listTodoistMirrorCompletedTasks(userId, {
  dbClient = db,
  start = null,
  end = null,
} = {}) {
  const lowerSql = start ? " AND due_date >= ?" : "";
  const upperSql = end ? " AND due_date <= ?" : "";
  const result = await dbClient.execute({
    sql: `SELECT item_id, project_id, content, description, checked, is_deleted,
                 due_date, due_datetime, due_timezone, due_is_recurring, priority, labels_json
          FROM ea_todoist_items
          WHERE user_id = ?
            AND checked = 1
            AND is_deleted = 0
            AND due_date IS NOT NULL${lowerSql}${upperSql}
          ORDER BY due_date ASC, due_datetime ASC, item_id ASC`,
    args: [userId, ...(start ? [start] : []), ...(end ? [end] : [])],
  });
  return result.rows.map(mirrorItemToTodoistTask);
}

export async function listTodoistMirrorActiveTaskIds(userId, {
  dbClient = db,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT item_id
          FROM ea_todoist_items
          WHERE user_id = ?
            AND checked = 0
            AND is_deleted = 0
            AND due_date IS NOT NULL
          ORDER BY item_id ASC`,
    args: [userId],
  });
  return new Set(result.rows.map((row) => String(row.item_id)));
}

export async function listTodoistMirrorDueTaskIds(userId, {
  dbClient = db,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT item_id
          FROM ea_todoist_items
          WHERE user_id = ?
            AND is_deleted = 0
            AND due_date IS NOT NULL
          ORDER BY item_id ASC`,
    args: [userId],
  });
  return new Set(result.rows.map((row) => String(row.item_id)));
}

export async function listTodoistMirrorProjects(userId, {
  dbClient = db,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT project_id, name, color, is_inbox_project
          FROM ea_todoist_projects
          WHERE user_id = ?
            AND is_deleted = 0
          ORDER BY name COLLATE NOCASE ASC, project_id ASC`,
    args: [userId],
  });
  return result.rows.map((row) => ({
    id: String(row.project_id),
    name: row.name || "",
    color: row.color || null,
    isInbox: !!row.is_inbox_project,
  }));
}

export async function listTodoistMirrorLabels(userId, {
  dbClient = db,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT label_id, name, color
          FROM ea_todoist_labels
          WHERE user_id = ?
            AND is_deleted = 0
          ORDER BY name COLLATE NOCASE ASC, label_id ASC`,
    args: [userId],
  });
  return result.rows.map((row) => ({
    id: String(row.label_id),
    name: row.name || "",
    color: row.color || null,
  }));
}

export async function upsertTodoistMirrorItem(userId, item, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
} = {}) {
  const timestamp = iso(now);
  await dbClient.execute(itemStatement(userId, item, timestamp));
  if (recordPendingSync) {
    await recordTodoistSyncRequest(userId, {
      dbClient,
      reason: "todoist-write",
      now,
    });
  }
}

export async function markTodoistMirrorItemCompleted(userId, itemId, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
} = {}) {
  const timestamp = iso(now);
  await dbClient.execute({
    sql: `INSERT INTO ea_todoist_items
            (user_id, item_id, content, checked, is_deleted, raw_json, synced_at, updated_at)
          VALUES (?, ?, '', 1, 0, '{}', ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            checked = 1,
            synced_at = excluded.synced_at,
            updated_at = excluded.updated_at`,
    args: [userId, normalizeId(itemId), timestamp, timestamp],
  });
  if (recordPendingSync) {
    await recordTodoistSyncRequest(userId, {
      dbClient,
      reason: "todoist-write",
      now,
    });
  }
}

export async function markTodoistMirrorItemDeleted(userId, itemId, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
} = {}) {
  const timestamp = iso(now);
  await dbClient.execute({
    sql: `INSERT INTO ea_todoist_items
            (user_id, item_id, content, checked, is_deleted, raw_json, synced_at, deleted_at, updated_at)
          VALUES (?, ?, '', 0, 1, '{}', ?, ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            is_deleted = 1,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at`,
    args: [userId, normalizeId(itemId), timestamp, timestamp, timestamp],
  });
  if (recordPendingSync) {
    await recordTodoistSyncRequest(userId, {
      dbClient,
      reason: "todoist-write",
      now,
    });
  }
}

async function markSyncing(userId, dbClient, timestamp) {
  await dbClient.execute({
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, status, sync_started_at, updated_at)
          VALUES (?, 'syncing', ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'syncing',
            sync_started_at = excluded.sync_started_at,
            last_error = NULL,
            updated_at = excluded.updated_at`,
    args: [userId, timestamp, timestamp],
  });
}

async function markSyncFailed(userId, dbClient, timestamp, err) {
  await dbClient.execute({
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, status, last_error, sync_started_at, last_check_failed_at,
             failed_check_count, updated_at)
          VALUES (?, 'idle', ?, NULL, ?, 1, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'idle',
            last_error = excluded.last_error,
            sync_started_at = NULL,
            last_check_failed_at = excluded.last_check_failed_at,
            failed_check_count = COALESCE(ea_todoist_sync_state.failed_check_count, 0) + 1,
            updated_at = excluded.updated_at`,
    args: [userId, String(err?.message || err || "Todoist sync failed").slice(0, 500), timestamp, timestamp],
  });
}

function isInvalidSyncTokenError(err) {
  const text = `${err?.message || ""} ${err?.body || ""}`.toLowerCase();
  return err?.status === 400 && /sync[_ ]token|sync token|invalid/.test(text);
}

async function applySyncResponse(userId, response, {
  dbClient,
  timestamp,
  isFullSync,
  syncStartedAt,
}) {
  const previousRows = await loadExistingReminderRows(userId, response.items || [], dbClient);
  const statements = [];
  if (isFullSync) statements.push(...fullSyncTombstoneStatements(userId, timestamp));
  statements.push(...(response.items || []).map((item) => itemStatement(userId, item, timestamp)));
  statements.push(completedOccurrenceReconcileStatement(userId));
  statements.push(...(response.projects || []).map((project) => projectStatement(userId, project, timestamp)));
  statements.push(...(response.labels || []).map((label) => labelStatement(userId, label, timestamp)));
  statements.push(stateSuccessStatement(userId, response, timestamp, isFullSync, syncStartedAt));
  // P2-21: fold reminder reconciliation into the SAME batch as the item upserts so
  // the mirror write and reminder reconciliation commit atomically, instead of a
  // batch followed by serial per-item reminder round-trips.
  const reminderStatements = await collectTodoistReminderReconcileStatements(
    userId,
    response.items || [],
    previousRows,
    dbClient,
  );
  statements.push(...reminderStatements);
  await dbClient.batch(statements);
}

// P3-63: three independent trigger paths (background read sync, refresh-blocking
// read sync, webhook/backstop requested sync) all funnel through this function.
// Without coordination a stale incremental could land after a newer full sync and
// regress sync_token. Keep at most one sync in flight per user; concurrent callers
// (including forceFull) coalesce onto the running promise.
const inFlightSyncs = new Map();

export function syncTodoistMirror(userId, options = {}) {
  if (!userId) return runTodoistMirrorSync(userId, options);

  const existing = inFlightSyncs.get(userId);
  if (existing) return existing;

  const running = runTodoistMirrorSync(userId, options).finally(() => {
    if (inFlightSyncs.get(userId) === running) {
      inFlightSyncs.delete(userId);
    }
  });
  inFlightSyncs.set(userId, running);
  return running;
}

async function runTodoistMirrorSync(userId, {
  dbClient = db,
  syncApiClient = fetchTodoistSyncResources,
  now = new Date(),
  forceFull = false,
} = {}) {
  const timestamp = iso(now);
  const token = await loadTodoistToken(userId, dbClient);
  if (!token) {
    return { status: "unconfigured", synced: false };
  }

  const state = await loadSyncState(userId, dbClient);
  const syncToken = forceFull || !state?.sync_token ? "*" : state.sync_token;
  await markSyncing(userId, dbClient, timestamp);

  // P3-62: wrap the whole fetch-and-apply body so any failure after markSyncing
  // (the '*' full retry, or a DB write error in applySyncResponse) resets status
  // to 'idle', records last_error, and increments failed_check_count — otherwise
  // the mirror is stuck in status='syncing' forever and startup resync is skipped.
  try {
    let response;
    let appliedSyncToken = syncToken;
    try {
      response = await syncApiClient({
        token,
        syncToken,
        resourceTypes: TODOIST_MIRROR_RESOURCE_TYPES,
      });
    } catch (err) {
      if (syncToken !== "*" && isInvalidSyncTokenError(err)) {
        appliedSyncToken = "*";
        response = await syncApiClient({
          token,
          syncToken: "*",
          resourceTypes: TODOIST_MIRROR_RESOURCE_TYPES,
        });
      } else {
        throw err;
      }
    }
    const isFullSync = appliedSyncToken === "*" || !!response.full_sync;

    await applySyncResponse(userId, response, {
      dbClient,
      timestamp,
      isFullSync,
      syncStartedAt: timestamp,
    });

    return {
      status: "current",
      syncToken: response.sync_token,
      fullSync: isFullSync,
      counts: {
        items: response.items?.length || 0,
        projects: response.projects?.length || 0,
        labels: response.labels?.length || 0,
      },
    };
  } catch (err) {
    await markSyncFailed(userId, dbClient, timestamp, err);
    throw err;
  }
}

export async function getTodoistMirrorHealth(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  // P2-5: loadSyncState does not depend on the token value, so resolve both
  // reads concurrently instead of serially on the warm /current path. The token
  // still solely gates the early-return shapes; state is discarded when the
  // account is unconfigured.
  const [token, state] = await Promise.all([
    loadTodoistToken(userId, dbClient),
    loadSyncState(userId, dbClient),
  ]);
  return computeTodoistMirrorHealth(state, { now, configured: !!token });
}
