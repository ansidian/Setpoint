import db from "../db/connection.ts";
import type { InValue } from "@libsql/client";
import type { TodoistTask } from "../../shared/types/tasks.ts";

interface SnapshotTaskInput extends Record<string, unknown> {
  id: string;
  title: string;
  due_date: string | null;
  due_time?: string | null;
  class_name: string;
  class_color: string;
  url: string | null;
  priority?: number | null;
  labels?: string[];
  description?: string;
  is_recurring?: boolean;
}

interface CompletedTodoistSnapshot {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  class_name: string;
  class_color: string;
  url: string | null;
  priority: number | null;
  labels: string[];
  description: string;
  source: "todoist";
  is_recurring: boolean;
}

interface CompletedTaskRow {
  todoist_id: InValue;
  due_date: string | null;
  snapshot_json: string;
}

interface TombstoneOptions {
  viewBoundary?: "today" | "yesterday";
  start?: string | null;
  end?: string | null;
}

// Today's date in Pacific time (ISO format YYYY-MM-DD)
function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

// Subtract whole days from an ISO date string, returning a new ISO string.
export function addDaysIso(iso: string, n: number): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(dt);
}

// Capture the fields needed to re-render a completed Todoist occurrence
// after the live API has advanced the task to its next due_date.
// Explicitly whitelists known fields — drops transient runtime props
// like _completing and status that don't belong in the persisted snapshot.
export function buildSnapshot(task: SnapshotTaskInput): CompletedTodoistSnapshot {
  return {
    id: task.id,
    title: task.title,
    due_date: task.due_date,
    due_time: task.due_time ?? null,
    class_name: task.class_name,
    class_color: task.class_color,
    url: task.url,
    priority: task.priority ?? null,
    labels: task.labels ?? [],
    description: task.description ?? "",
    source: "todoist",
    is_recurring: !!task.is_recurring,
  };
}

// Read all completed occurrence rows for a user and hydrate the rows visible
// to the requested surface. Date windows are render filters only; completed
// occurrence history is not deleted merely because it is older than today.
//
// `liveTodoistIds` (optional): a Set of id strings present in the live
// Todoist task list. When provided, tombstones whose task id is NOT in
// the set are treated as orphaned (e.g. the task was deleted in Todoist)
// and pruned alongside retention-expired rows. Pass `null` to skip orphan
// detection — required when the live list is unavailable, since a
// missing-from-list check with no list would wipe every tombstone.
export async function hydrateRecurringTombstones(
  userId: string,
  liveTodoistIds: Set<string> | null = null,
  { viewBoundary = "today", start = null, end = null }: TombstoneOptions = {},
): Promise<TodoistTask[]> {
  const result = await db.execute({
    sql: "SELECT todoist_id, due_date, snapshot_json FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NOT NULL",
    args: [userId],
  });
  if (!result.rows.length) return [];

  const today = todayPacific();
  const yesterday = addDaysIso(today, -1);
  const filterBoundary = viewBoundary === "yesterday" ? yesterday : today;

  const rows = result.rows as unknown as CompletedTaskRow[];
  const toDelete: CompletedTaskRow[] = [];
  const retained: CompletedTaskRow[] = [];
  for (const row of rows) {
    if (!row.due_date) {
      toDelete.push(row);
    } else if (liveTodoistIds && !liveTodoistIds.has(String(row.todoist_id))) {
      toDelete.push(row);
    } else {
      retained.push(row);
    }
  }

  if (toDelete.length) {
    const placeholders = toDelete.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM ea_completed_tasks WHERE user_id = ? AND todoist_id IN (${placeholders})`,
      args: [userId, ...toDelete.map((r) => r.todoist_id)],
    });
  }

  const hydrated: TodoistTask[] = [];
  for (const row of retained) {
    const dueDate = row.due_date;
    if (!dueDate) continue;
    if (start || end) {
      if (start && dueDate < start) continue;
      if (end && dueDate > end) continue;
    } else if (dueDate < filterBoundary) {
      continue;
    }
    let snapshot: TodoistTask;
    try {
      snapshot = JSON.parse(row.snapshot_json) as TodoistTask;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Tombstones] Skipping malformed snapshot for ${row.todoist_id}: ${message}`);
      continue;
    }
    hydrated.push({ ...snapshot, status: "complete", _tombstone: true });
  }
  return hydrated;
}
