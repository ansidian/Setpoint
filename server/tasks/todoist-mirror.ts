import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import {
  fetchTodoistSyncResources,
  TODOIST_MIRROR_RESOURCE_TYPES,
} from "./todoist-api.ts";
import {
  deleteSourceReminders,
  recomputeUnsentRemindersForSource,
} from "../reminders/reminder-service.ts";
import { todoistReminderAnchorFromTask } from "./todoist-reminder-source.ts";
import { getTodoistApiToken } from "./todoist-token.ts";
import {
  normalizeId,
  fullSyncTombstoneStatements,
  completedOccurrenceReconcileStatement,
  itemStatement,
  projectStatement,
  labelStatement,
  stateSuccessStatement,
} from "./todoistMirrorStatements.ts";
import { computeTodoistMirrorHealth } from "./todoistMirrorHealthModel.ts";
import type { Client, InStatement } from "@libsql/client";
import type { ReminderAnchor } from "../../shared/types/reminders.ts";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";
import type { TodoistSyncResponse } from "./todoist-api.ts";
import type { RawTodoistItem } from "./todoistMirrorStatements.ts";
import type { TodoistSyncStateRow } from "./todoistMirrorHealthModel.ts";

type TodoistMirrorDb = Client;

interface TodoistMirrorItemRow extends Record<string, unknown> {
  item_id: unknown;
  project_id?: unknown;
  content?: unknown;
  description?: unknown;
  checked?: unknown;
  is_deleted?: unknown;
  due_date?: unknown;
  due_datetime?: unknown;
  due_timezone?: unknown;
  due_is_recurring?: unknown;
  priority?: unknown;
  labels_json?: unknown;
}

interface TodoistMirrorRangeOptions {
  dbClient?: TodoistMirrorDb;
  start?: string | null;
  end?: string | null;
}

interface TodoistMirrorWriteOptions {
  dbClient?: TodoistMirrorDb;
  now?: Date;
  recordPendingSync?: boolean;
}

interface TodoistMirrorProject {
  id: string;
  name: string;
  color: string | null;
  isInbox: boolean;
}

interface TodoistMirrorLabel {
  id: string;
  name: string;
  color: string | null;
}

type TodoistSyncApiClient = (input: {
  token: string;
  syncToken: string;
  resourceTypes: readonly ("items" | "projects" | "labels")[];
}) => Promise<TodoistSyncResponse>;

interface TodoistMirrorSyncOptions {
  dbClient?: TodoistMirrorDb;
  syncApiClient?: TodoistSyncApiClient;
  now?: Date;
  forceFull?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function iso(now: Date): string {
  return now.toISOString();
}

function anchorsEqual(left: ReminderAnchor | null, right: ReminderAnchor | null): boolean {
  return left?.anchorKind === right?.anchorKind && left?.anchorAt === right?.anchorAt;
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mirrorItemToTodoistTask(row: TodoistMirrorItemRow): RawTodoistItem {
  const dueDateTime = row.due_datetime || row.due_date || null;
  return {
    id: String(row.item_id),
    content: String(row.content || ""),
    description: String(row.description || ""),
    project_id: normalizeId(row.project_id),
    checked: !!row.checked,
    is_deleted: !!row.is_deleted,
    due: dueDateTime
      ? {
          date: String(dueDateTime),
          timezone: row.due_timezone ? String(row.due_timezone) : null,
          is_recurring: !!row.due_is_recurring,
        }
      : null,
    priority: row.priority == null ? null : Number(row.priority),
    labels: parseJsonArray(row.labels_json),
  };
}

async function loadTodoistToken(userId: string, dbClient: TodoistMirrorDb): Promise<string | null> {
  return getTodoistApiToken(userId, { dbClient });
}

async function loadSyncState(userId: string, dbClient: TodoistMirrorDb): Promise<(TodoistSyncStateRow & { sync_token?: string | null }) | null> {
  const result = await dbClient.execute({
    sql: "SELECT * FROM ea_todoist_sync_state WHERE user_id = ?",
    args: [userId],
  });
  return result.rows[0] as unknown as (TodoistSyncStateRow & { sync_token?: string | null }) | undefined || null;
}

async function loadExistingReminderRows(userId: string, items: RawTodoistItem[], dbClient: TodoistMirrorDb): Promise<Map<string, TodoistMirrorItemRow>> {
  const ids = [...new Set((items || []).map((item) => normalizeId(item.id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await dbClient.execute({
    sql: `SELECT item_id, checked, is_deleted, due_date, due_datetime, due_timezone
          FROM ea_todoist_items
          WHERE user_id = ? AND item_id IN (${placeholders})`,
    args: [userId, ...ids],
  });
  return new Map((result.rows as unknown as TodoistMirrorItemRow[]).map((row) => [String(row.item_id), row]));
}

// P2-21: collect the reminder-reconcile mutations as statements (the reads still
// run here against dbClient) so applySyncResponse can fold them into the same
// batched transaction as the item upserts, restoring atomicity and replacing the
// per-item serial round-trips.
async function collectTodoistReminderReconcileStatements(
  userId: string,
  items: RawTodoistItem[],
  previousRows: Map<string, TodoistMirrorItemRow>,
  dbClient: TodoistMirrorDb,
): Promise<InStatement[]> {
  const statements: InStatement[] = [];
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
    const previousAnchor = todoistReminderAnchorFromTask(previousRow as Parameters<typeof todoistReminderAnchorFromTask>[0]);
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

export async function recordTodoistSyncRequest(userId: string, {
  dbClient = db,
  reason = "manual",
  now = new Date(),
}: { dbClient?: TodoistMirrorDb; reason?: string; now?: Date } = {}): Promise<{ recorded: boolean; syncRequestedAt?: string; reason?: string }> {
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

export async function listTodoistMirrorActiveTasks(userId: string, {
  dbClient = db,
  start = null,
  end = null,
}: TodoistMirrorRangeOptions = {}): Promise<RawTodoistItem[]> {
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
  return (result.rows as unknown as TodoistMirrorItemRow[]).map(mirrorItemToTodoistTask);
}

export async function listTodoistMirrorCompletedTasks(userId: string, {
  dbClient = db,
  start = null,
  end = null,
}: TodoistMirrorRangeOptions = {}): Promise<RawTodoistItem[]> {
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
  return (result.rows as unknown as TodoistMirrorItemRow[]).map(mirrorItemToTodoistTask);
}

export async function listTodoistMirrorDueTaskIds(userId: string, {
  dbClient = db,
}: { dbClient?: TodoistMirrorDb } = {}): Promise<Set<string>> {
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

export async function listTodoistMirrorProjects(userId: string, {
  dbClient = db,
}: { dbClient?: TodoistMirrorDb } = {}): Promise<TodoistMirrorProject[]> {
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
    name: String(row.name || ""),
    color: row.color ? String(row.color) : null,
    isInbox: !!row.is_inbox_project,
  }));
}

export async function listTodoistMirrorLabels(userId: string, {
  dbClient = db,
}: { dbClient?: TodoistMirrorDb } = {}): Promise<TodoistMirrorLabel[]> {
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
    name: String(row.name || ""),
    color: row.color ? String(row.color) : null,
  }));
}

export async function upsertTodoistMirrorItem(userId: string, item: RawTodoistItem, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
}: TodoistMirrorWriteOptions = {}): Promise<void> {
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

export async function markTodoistMirrorItemCompleted(userId: string, itemId: unknown, occurrenceDate: string, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
}: TodoistMirrorWriteOptions = {}): Promise<void> {
  const timestamp = iso(now);
  // Todoist reuses the same id when a recurring task advances. Restrict the
  // optimistic write to the occurrence that was actually closed so a webhook
  // sync that already installed the next occurrence cannot be overwritten by
  // this later post-close write.
  await dbClient.execute({
    sql: `UPDATE ea_todoist_items
          SET checked = 1,
              synced_at = ?,
              updated_at = ?
          WHERE user_id = ?
            AND item_id = ?
            AND due_date = ?`,
    args: [timestamp, timestamp, userId, normalizeId(itemId), occurrenceDate],
  });
  if (recordPendingSync) {
    await recordTodoistSyncRequest(userId, {
      dbClient,
      reason: "todoist-write",
      now,
    });
  }
}

export async function markTodoistMirrorItemDeleted(userId: string, itemId: unknown, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
}: TodoistMirrorWriteOptions = {}): Promise<void> {
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

async function markSyncing(userId: string, dbClient: TodoistMirrorDb, timestamp: string): Promise<void> {
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

async function markSyncFailed(userId: string, dbClient: TodoistMirrorDb, timestamp: string, err: unknown): Promise<void> {
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
    args: [userId, errorMessage(err || "Todoist sync failed").slice(0, 500), timestamp, timestamp],
  });
}

function isInvalidSyncTokenError(err: unknown): boolean {
  const candidate = err as { message?: unknown; body?: unknown; status?: unknown } | null;
  const text = `${candidate?.message || ""} ${candidate?.body || ""}`.toLowerCase();
  return candidate?.status === 400 && /sync[_ ]token|sync token|invalid/.test(text);
}

async function applySyncResponse(userId: string, response: TodoistSyncResponse, {
  dbClient,
  timestamp,
  isFullSync,
  syncStartedAt,
}: { dbClient: TodoistMirrorDb; timestamp: string; isFullSync: boolean; syncStartedAt: string }): Promise<void> {
  const previousRows = await loadExistingReminderRows(userId, response.items || [], dbClient);
  const statements: InStatement[] = [];
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
const inFlightSyncs = new Map<string, Promise<TodoistMirrorSyncResult>>();

export type TodoistMirrorSyncResult =
  | { status: "unconfigured"; synced: false }
  | {
      status: "current";
      syncToken: string;
      fullSync: boolean;
      counts: { items: number; projects: number; labels: number };
    };

export function syncTodoistMirror(userId: string, options: TodoistMirrorSyncOptions = {}): Promise<TodoistMirrorSyncResult> {
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

async function runTodoistMirrorSync(userId: string, {
  dbClient = db,
  syncApiClient = fetchTodoistSyncResources,
  now = new Date(),
  forceFull = false,
}: TodoistMirrorSyncOptions = {}): Promise<TodoistMirrorSyncResult> {
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
    let response: TodoistSyncResponse;
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

export async function getTodoistMirrorHealth(userId: string, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: TodoistMirrorDb; now?: Date } = {}): Promise<TodoistMirrorHealth> {
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
