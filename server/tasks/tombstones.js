import db from "../db/connection.js";

// Today's date in Pacific time (ISO format YYYY-MM-DD)
function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

// Subtract whole days from an ISO date string, returning a new ISO string.
export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(dt);
}

// Capture the fields needed to re-render a completed Todoist occurrence
// after the live API has advanced the task to its next due_date.
// Explicitly whitelists known fields — drops transient runtime props
// like _completing and status that don't belong in the persisted snapshot.
export function buildSnapshot(task) {
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

// Partition DB rows into live (due_date >= today) and expired (due_date < today).
// Rows with null due_date are defensively treated as expired.
export function partitionByExpiry(rows, today) {
  const live = [];
  const expired = [];
  for (const r of rows) {
    if (r.due_date && r.due_date >= today) live.push(r);
    else expired.push(r);
  }
  return { live, expired };
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
  userId,
  liveTodoistIds = null,
  { viewBoundary = "today", start = null, end = null } = {},
) {
  const result = await db.execute({
    sql: "SELECT todoist_id, due_date, snapshot_json FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NOT NULL",
    args: [userId],
  });
  if (!result.rows.length) return [];

  const today = todayPacific();
  const yesterday = addDaysIso(today, -1);
  const filterBoundary = viewBoundary === "yesterday" ? yesterday : today;

  const toDelete = [];
  const retained = [];
  for (const row of result.rows) {
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

  const hydrated = [];
  for (const row of retained) {
    if (start || end) {
      if (start && row.due_date < start) continue;
      if (end && row.due_date > end) continue;
    } else if (row.due_date < filterBoundary) {
      continue;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(row.snapshot_json);
    } catch (err) {
      console.warn(`[Tombstones] Skipping malformed snapshot for ${row.todoist_id}: ${err.message}`);
      continue;
    }
    hydrated.push({ ...snapshot, status: "complete", _tombstone: true });
  }
  return hydrated;
}
