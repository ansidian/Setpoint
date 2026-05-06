import db from "../db/connection.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import {
  fetchTodoistSyncResources,
  TODOIST_MIRROR_RESOURCE_TYPES,
} from "./todoist-api.js";
import { getTodoistApiToken } from "./todoist-token.js";

const HEALTH_DEGRADED_AFTER_MS = 24 * 60 * 60 * 1000;

function iso(now) {
  return now.toISOString();
}

function boolInt(value) {
  return value ? 1 : 0;
}

function normalizeId(value) {
  return value == null ? null : String(value);
}

function dueDate(due) {
  if (!due?.date) return null;
  return String(due.date).split("T")[0];
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

function deletedAt(resource, timestamp) {
  return resource?.is_deleted ? timestamp : null;
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

function fullSyncTombstoneStatements(userId, timestamp) {
  return [
    {
      sql: `UPDATE ea_todoist_items
            SET is_deleted = 1, deleted_at = ?, updated_at = ?
            WHERE user_id = ?`,
      args: [timestamp, timestamp, userId],
    },
    {
      sql: `UPDATE ea_todoist_projects
            SET is_deleted = 1, deleted_at = ?, updated_at = ?
            WHERE user_id = ?`,
      args: [timestamp, timestamp, userId],
    },
    {
      sql: `UPDATE ea_todoist_labels
            SET is_deleted = 1, deleted_at = ?, updated_at = ?
            WHERE user_id = ?`,
      args: [timestamp, timestamp, userId],
    },
  ];
}

function itemStatement(userId, item, timestamp) {
  const deleted = boolInt(item.is_deleted);
  return {
    sql: `INSERT INTO ea_todoist_items
            (user_id, item_id, project_id, section_id, parent_id, content,
             description, checked, is_deleted, due_date, due_datetime, due_timezone,
             due_is_recurring, priority, labels_json, raw_json, synced_at, deleted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            project_id = excluded.project_id,
            section_id = excluded.section_id,
            parent_id = excluded.parent_id,
            content = excluded.content,
            description = excluded.description,
            checked = excluded.checked,
            is_deleted = excluded.is_deleted,
            due_date = excluded.due_date,
            due_datetime = excluded.due_datetime,
            due_timezone = excluded.due_timezone,
            due_is_recurring = excluded.due_is_recurring,
            priority = excluded.priority,
            labels_json = excluded.labels_json,
            raw_json = excluded.raw_json,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      normalizeId(item.id),
      normalizeId(item.project_id),
      normalizeId(item.section_id),
      normalizeId(item.parent_id),
      item.content || "",
      item.description || "",
      boolInt(item.checked),
      deleted,
      dueDate(item.due),
      item.due?.date || null,
      item.due?.timezone || null,
      boolInt(item.due?.is_recurring),
      item.priority ?? null,
      JSON.stringify(item.labels || []),
      JSON.stringify(item),
      timestamp,
      deletedAt(item, timestamp),
      timestamp,
    ],
  };
}

function projectStatement(userId, project, timestamp) {
  const deleted = boolInt(project.is_deleted);
  return {
    sql: `INSERT INTO ea_todoist_projects
            (user_id, project_id, name, color, is_inbox_project, is_deleted,
             raw_json, synced_at, deleted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, project_id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            is_inbox_project = excluded.is_inbox_project,
            is_deleted = excluded.is_deleted,
            raw_json = excluded.raw_json,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      normalizeId(project.id),
      project.name || "",
      project.color || null,
      boolInt(project.is_inbox_project),
      deleted,
      JSON.stringify(project),
      timestamp,
      deletedAt(project, timestamp),
      timestamp,
    ],
  };
}

function labelStatement(userId, label, timestamp) {
  const deleted = boolInt(label.is_deleted);
  return {
    sql: `INSERT INTO ea_todoist_labels
            (user_id, label_id, name, color, is_deleted, raw_json, synced_at, deleted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, label_id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            is_deleted = excluded.is_deleted,
            raw_json = excluded.raw_json,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      normalizeId(label.id),
      label.name || "",
      label.color || null,
      deleted,
      JSON.stringify(label),
      timestamp,
      deletedAt(label, timestamp),
      timestamp,
    ],
  };
}

function stateSuccessStatement(userId, response, timestamp, isFullSync) {
  return {
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, sync_token, status, last_sync_at, last_success_at,
             last_full_sync_at, last_incremental_sync_at, last_error, sync_started_at,
             sync_requested_at, sync_request_reason, last_check_failed_at,
             failed_check_count, updated_at)
          VALUES (?, ?, 'idle', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            sync_token = excluded.sync_token,
            status = 'idle',
            last_sync_at = excluded.last_sync_at,
            last_success_at = excluded.last_success_at,
            last_full_sync_at = COALESCE(excluded.last_full_sync_at, ea_todoist_sync_state.last_full_sync_at),
            last_incremental_sync_at = COALESCE(excluded.last_incremental_sync_at, ea_todoist_sync_state.last_incremental_sync_at),
            last_error = NULL,
            sync_started_at = NULL,
            sync_requested_at = NULL,
            sync_request_reason = NULL,
            last_check_failed_at = NULL,
            failed_check_count = 0,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      response.sync_token,
      timestamp,
      timestamp,
      isFullSync ? timestamp : null,
      isFullSync ? null : timestamp,
      timestamp,
    ],
  };
}

function isAfter(left, right) {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function hasPendingSyncEvidence(state) {
  return isAfter(state.sync_requested_at, state.last_success_at);
}

function failureAgeMs(state, now) {
  const since = state.last_success_at || state.last_check_failed_at;
  if (!since) return null;
  return Math.max(0, now.getTime() - new Date(since).getTime());
}

async function applySyncResponse(userId, response, {
  dbClient,
  timestamp,
  isFullSync,
}) {
  const statements = [];
  if (isFullSync) statements.push(...fullSyncTombstoneStatements(userId, timestamp));
  statements.push(...(response.items || []).map((item) => itemStatement(userId, item, timestamp)));
  statements.push(...(response.projects || []).map((project) => projectStatement(userId, project, timestamp)));
  statements.push(...(response.labels || []).map((label) => labelStatement(userId, label, timestamp)));
  statements.push(stateSuccessStatement(userId, response, timestamp, isFullSync));
  await dbClient.batch(statements);
}

export async function syncTodoistMirror(userId, {
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
      await markSyncFailed(userId, dbClient, timestamp, err);
      throw err;
    }
  }
  const isFullSync = appliedSyncToken === "*" || !!response.full_sync;

  await applySyncResponse(userId, response, {
    dbClient,
    timestamp,
    isFullSync,
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
}

export async function getTodoistMirrorHealth(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const token = await loadTodoistToken(userId, dbClient);
  if (!token) {
    return {
      state: "unconfigured",
      configured: false,
      severity: "none",
      lastSuccessAt: null,
      lastError: null,
      syncStartedAt: null,
      syncRequestedAt: null,
      syncRequestReason: null,
      lastCheckFailedAt: null,
      failedCheckCount: 0,
      ageMs: null,
    };
  }

  const state = await loadSyncState(userId, dbClient);
  if (!state) {
    return {
      state: "unavailable",
      configured: true,
      severity: "error",
      lastSuccessAt: null,
      lastError: null,
      syncStartedAt: null,
      syncRequestedAt: null,
      syncRequestReason: null,
      lastCheckFailedAt: null,
      failedCheckCount: 0,
      ageMs: null,
    };
  }

  const lastSuccessAt = state.last_success_at || null;
  const ageMs = lastSuccessAt
    ? Math.max(0, now.getTime() - new Date(lastSuccessAt).getTime())
    : null;
  const pendingEvidence = hasPendingSyncEvidence(state);
  const failedCheckCount = Number(state.failed_check_count || 0);
  const degradedByFailedChecks = !pendingEvidence
    && failedCheckCount > 0
    && failureAgeMs(state, now) != null
    && failureAgeMs(state, now) >= HEALTH_DEGRADED_AFTER_MS;

  let nextState;
  let severity;
  if (state.status === "syncing") {
    nextState = "syncing";
    severity = pendingEvidence ? "warning" : "info";
  } else if (!lastSuccessAt) {
    nextState = "unavailable";
    severity = "error";
  } else if (pendingEvidence) {
    nextState = "needs_sync";
    severity = "warning";
  } else if (degradedByFailedChecks) {
    nextState = "degraded";
    severity = "warning";
  } else {
    nextState = "current";
    severity = "none";
  }

  return {
    state: nextState,
    configured: true,
    severity,
    lastSuccessAt,
    lastError: state.last_error || null,
    syncStartedAt: state.sync_started_at || null,
    syncRequestedAt: state.sync_requested_at || null,
    syncRequestReason: state.sync_request_reason || null,
    lastCheckFailedAt: state.last_check_failed_at || null,
    failedCheckCount,
    ageMs,
  };
}
