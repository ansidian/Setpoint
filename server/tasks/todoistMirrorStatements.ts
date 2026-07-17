import type { InValue } from "@libsql/client";

export interface TodoistMirrorStatement {
  sql: string;
  args: InValue[];
}

export interface RawTodoistDue extends Record<string, unknown> {
  date?: string | null;
  timezone?: string | null;
  is_recurring?: boolean | null;
}

export interface RawTodoistItem extends Record<string, unknown> {
  id?: unknown;
  project_id?: unknown;
  section_id?: unknown;
  parent_id?: unknown;
  content?: string | null;
  description?: string | null;
  checked?: boolean | null;
  is_deleted?: boolean | null;
  due?: RawTodoistDue | null;
  priority?: number | null;
  labels?: unknown[] | null;
}

export interface RawTodoistProject extends Record<string, unknown> {
  id?: unknown;
  name?: string | null;
  color?: string | null;
  is_inbox_project?: boolean | null;
  is_deleted?: boolean | null;
}

export interface RawTodoistLabel extends Record<string, unknown> {
  id?: unknown;
  name?: string | null;
  color?: string | null;
  is_deleted?: boolean | null;
}

export interface RawTodoistSyncResponse extends Record<string, unknown> {
  sync_token: string;
}

function boolInt(value: unknown): 0 | 1 {
  return value ? 1 : 0;
}

export function normalizeId(value: unknown): string | null {
  return value == null ? null : String(value);
}

function dueDate(due: RawTodoistDue | null | undefined): string | null {
  if (!due?.date) return null;
  return String(due.date).split("T")[0] ?? null;
}

function deletedAt(resource: { is_deleted?: boolean | null } | null | undefined, timestamp: string): string | null {
  return resource?.is_deleted ? timestamp : null;
}

export function fullSyncTombstoneStatements(userId: string, timestamp: string): TodoistMirrorStatement[] {
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

// A completion tombstone in ea_completed_tasks records an occurrence the user
// closed from Setpoint, and completeDeadlineOccurrence trusts it to short-circuit
// the Todoist /close on a repeat Mark-done. When Todoist reports that same
// occurrence as active again (the user reopened/unchecked it), the tombstone is
// stale and that short-circuit would silently skip the close forever.
//
// Reconcile against the freshly-written mirror (so it runs INSIDE the sync batch,
// after the item upserts): drop every tombstone whose item the mirror now holds as
// active for that exact due_date. This is set-based so it also heals tombstones
// reopened in an earlier sync — they never reappear in an incremental delta.
//
// Recurring tasks (due_is_recurring = 1) are deliberately excluded: completing one
// advances its due date, so the old occurrence's tombstone stays the resurrection
// guard against a stale sync re-reporting that already-advanced occurrence active.
export function completedOccurrenceReconcileStatement(userId: string): TodoistMirrorStatement {
  return {
    sql: `DELETE FROM ea_completed_tasks
          WHERE user_id = ?
            AND (todoist_id, due_date) IN (
              SELECT item_id, due_date
              FROM ea_todoist_items
              WHERE user_id = ?
                AND checked = 0
                AND is_deleted = 0
                AND due_is_recurring = 0
                AND due_date IS NOT NULL
            )`,
    args: [userId, userId],
  };
}

export function itemStatement(userId: string, item: RawTodoistItem, timestamp: string): TodoistMirrorStatement {
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

export function projectStatement(userId: string, project: RawTodoistProject, timestamp: string): TodoistMirrorStatement {
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

export function labelStatement(userId: string, label: RawTodoistLabel, timestamp: string): TodoistMirrorStatement {
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

export function stateSuccessStatement(
  userId: string,
  response: RawTodoistSyncResponse,
  timestamp: string,
  isFullSync: boolean,
  syncStartedAt: string,
): TodoistMirrorStatement {
  // P3-66: only clear sync_requested_at/sync_request_reason when the pending
  // request predates this sync's start. A webhook that lands mid-sync records a
  // newer sync_requested_at; nulling it unconditionally would transiently mask
  // that work until the next trigger. Compare against the start timestamp so a
  // request newer than the sync survives the success write.
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
            sync_requested_at = CASE
              WHEN ea_todoist_sync_state.sync_requested_at IS NULL
                OR ea_todoist_sync_state.sync_requested_at <= ?
              THEN NULL
              ELSE ea_todoist_sync_state.sync_requested_at
            END,
            sync_request_reason = CASE
              WHEN ea_todoist_sync_state.sync_requested_at IS NULL
                OR ea_todoist_sync_state.sync_requested_at <= ?
              THEN NULL
              ELSE ea_todoist_sync_state.sync_request_reason
            END,
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
      syncStartedAt,
      syncStartedAt,
    ],
  };
}
