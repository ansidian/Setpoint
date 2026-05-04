import {
  getTodoistMirrorHealth,
  listTodoistMirrorActiveTaskIds,
  listTodoistMirrorActiveTasks,
  listTodoistMirrorLabels,
  listTodoistMirrorProjects,
  markTodoistMirrorItemCompleted,
  markTodoistMirrorItemDeleted,
  syncTodoistMirror,
  upsertTodoistMirrorItem,
} from "./todoist-mirror.js";
import { requestTodoistMirrorSync } from "./todoist-webhook.js";
import { getTodoistApiToken } from "./todoist-token.js";

const BASE_URL = "https://api.todoist.com/api/v1";
const TODOIST_DUE_TASKS_QUERY = "!no date";

// Todoist's REST API inverts our UI priority scale: API 4 = urgent, API 1 =
// natural/no priority. Dashboard uses 1 = urgent, 4 = low, null = none.
// Note: Todoist can't distinguish "user picked P4 Low" from "no priority" —
// both come back as API 1, so a roundtrip collapses UI P4 → null.
function toApiPriority(uiLevel) {
  if (uiLevel == null) return undefined;
  return 5 - uiLevel;
}
function toUiPriority(apiLevel) {
  if (apiLevel == null || apiLevel === 1) return null;
  return 5 - apiLevel;
}

// --- Caches: 10-minute TTL ---
const CACHE_TTL_MS = 10 * 60 * 1000;
let projectCache = { data: null, ts: 0 };
const MIRROR_BOOTSTRAP_TIMEOUT_MS = 10_000;
const MIRROR_REFRESH_TIMEOUT_MS = 2_000;
const TODOIST_COMPLETED_RANGE_TIMEOUT_MS = 5_000;
const backgroundSyncs = new Map();

async function getToken(userId) {
  return getTodoistApiToken(userId);
}

async function todoistFetch(token, path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Todoist API ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchProjects(token) {
  if (projectCache.data && Date.now() - projectCache.ts < CACHE_TTL_MS) {
    return projectCache.data;
  }
  const map = new Map();
  let cursor = null;
  do {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "200");
    const data = await todoistFetch(token, `/projects?${params}`);
    for (const p of data.results || data) {
      map.set(p.id, { name: p.name, color: p.color, isInbox: !!p.is_inbox_project });
    }
    cursor = data.next_cursor || null;
  } while (cursor);
  projectCache.data = map;
  projectCache.ts = Date.now();
  return map;
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function requestTodoistMirrorBackgroundSync(userId) {
  if (backgroundSyncs.has(userId)) return backgroundSyncs.get(userId);
  const syncPromise = syncTodoistMirror(userId)
    .catch((err) => {
      console.error("[Todoist] background mirror sync failed:", err.message);
      return null;
    })
    .finally(() => backgroundSyncs.delete(userId));
  backgroundSyncs.set(userId, syncPromise);
  return syncPromise;
}

async function waitForTodoistMirrorSync(userId, {
  forceFull = false,
  timeoutMs,
} = {}) {
  try {
    return await withTimeout(syncTodoistMirror(userId, { forceFull }), timeoutMs);
  } catch (err) {
    console.error("[Todoist] mirror sync failed:", err.message);
    return null;
  }
}

function requestTodoistWriteReconciliation(userId) {
  requestTodoistMirrorSync(userId, {
    reason: "todoist-write",
  });
}

async function prepareTodoistMirrorRead(userId, {
  refresh = false,
} = {}) {
  const health = await getTodoistMirrorHealth(userId);
  if (!health.configured) return health;

  if (!health.lastSuccessAt) {
    await waitForTodoistMirrorSync(userId, {
      forceFull: true,
      timeoutMs: MIRROR_BOOTSTRAP_TIMEOUT_MS,
    });
    return getTodoistMirrorHealth(userId);
  }

  if (refresh) {
    await waitForTodoistMirrorSync(userId, {
      timeoutMs: MIRROR_REFRESH_TIMEOUT_MS,
    });
  } else if (health.state !== "current") {
    requestTodoistMirrorBackgroundSync(userId);
  }

  return getTodoistMirrorHealth(userId);
}

async function fetchMirrorProjectMap(userId) {
  const projects = await listTodoistMirrorProjects(userId);
  return new Map(projects.map((project) => [
    project.id,
    {
      name: project.name,
      color: project.color,
      isInbox: project.isInbox,
    },
  ]));
}

async function fetchMirrorMappedTasks(userId, {
  start = null,
  end = null,
  refresh = false,
} = {}) {
  const health = await prepareTodoistMirrorRead(userId, { refresh });
  if (!health.configured) return { tasks: [], idSet: null, health };

  const [projects, tasks] = await Promise.all([
    fetchMirrorProjectMap(userId),
    listTodoistMirrorActiveTasks(userId, { start, end }),
  ]);
  const mappedTasks = tasks.map((task) => mapTodoistTask(task, projects));
  return {
    tasks: mappedTasks,
    idSet: new Set(mappedTasks.map((task) => String(task.id))),
    health,
  };
}

// Map Todoist color names to hex (subset of Todoist palette)
const TODOIST_COLORS = {
  berry_red: "#b8255f", red: "#db4035", orange: "#ff9933",
  yellow: "#fad000", olive_green: "#afb83b", lime_green: "#7ecc49",
  green: "#299438", mint_green: "#6accbc", teal: "#158fad",
  sky_blue: "#14aaf5", light_blue: "#96c3eb", blue: "#4073ff",
  grape: "#884dff", violet: "#af38eb", lavender: "#eb96eb",
  magenta: "#e05194", salmon: "#ff8d85", charcoal: "#808080",
  grey: "#b8b8b8", taupe: "#ccac93",
};

function mapColor(todoistColor) {
  return TODOIST_COLORS[todoistColor] || "#cba6da";
}

// Todoist returns due datetimes in the user's local timezone without a Z
// suffix, so parse the time directly from the string to avoid UTC reinterpretation.
function formatTime12h(dateStr) {
  if (!dateStr || !dateStr.includes("T")) return null;
  const match = dateStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const ampm = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${ampm}`;
}

function todoistTaskUrl(content, id) {
  const slug = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://app.todoist.com/app/task/${slug}-${id}`;
}

function extractDate(due) {
  if (!due?.date) return null;
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..."
  return due.date.split("T")[0];
}

function mapTodoistTask(t, projects) {
  const proj = projects.get(t.project_id);
  return {
    id: t.id,
    title: t.content,
    due_date: extractDate(t.due),
    due_time: formatTime12h(t.due.date),
    class_name: proj?.name || "Todoist",
    class_color: proj ? mapColor(proj.color) : "#cba6da",
    points_possible: null,
    status: "incomplete",
    source: "todoist",
    description: t.description || "",
    url: todoistTaskUrl(t.content, t.id),
    priority: toUiPriority(t.priority),
    labels: t.labels || [],
    is_recurring: !!t.due?.is_recurring,
  };
}

function completedTaskId(t) {
  return t.task_id || t.id || t.item_id;
}

function completedDueDate(t) {
  if (t.due?.date) return extractDate(t.due);
  const raw = t.due_date || t.date_due || t.dueDate;
  return raw ? String(raw).split("T")[0] : null;
}

function completedContent(t) {
  return t.content || t.task_content || t.title || t.name || "Untitled task";
}

function mapCompletedTodoistTask(t, projects) {
  const id = completedTaskId(t);
  const title = completedContent(t);
  const projectId = t.project_id || t.projectId;
  const proj = projects.get(projectId);
  const dueDate = completedDueDate(t);
  const due = t.due?.date
    ? t.due
    : dueDate
      ? { date: dueDate, is_recurring: !!(t.is_recurring || t.recurring) }
      : null;
  return {
    id,
    title,
    due_date: dueDate,
    due_time: formatTime12h(due?.date),
    class_name: proj?.name || t.project_name || "Todoist",
    class_color: proj ? mapColor(proj.color) : "#cba6da",
    points_possible: null,
    status: "complete",
    source: "todoist",
    description: t.description || "",
    url: id ? todoistTaskUrl(title, id) : null,
    priority: toUiPriority(t.priority),
    labels: t.labels || [],
    is_recurring: !!(t.due?.is_recurring || t.is_recurring || t.recurring),
    completed_at: t.completed_at || t.completed_at_date || t.date_completed || null,
  };
}

function isWithinDateRange(date, start, end) {
  return !!date && date >= start && date <= end;
}

function dedupeTodoistRangeTasks(tasks) {
  const seen = new Set();
  const result = [];
  for (const task of tasks) {
    const key = `${task.id}:${task.due_date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(task);
  }
  return result;
}

async function fetchTodoistCompletedByDueDate(token, { start, end }) {
  const params = new URLSearchParams({ since: start, until: end, limit: "200" });
  const allTasks = [];
  let cursor = null;
  do {
    if (cursor) params.set("cursor", cursor);
    const data = await todoistFetch(token, `/tasks/completed/by_due_date?${params}`);
    allTasks.push(...(data.results || data.items || []));
    cursor = data.next_cursor || null;
  } while (cursor);
  return allTasks;
}

async function fetchTodoistCompletedByDueDateWithFallback(token, { start, end }) {
  if (!token) return [];
  try {
    return await withTimeout(fetchTodoistCompletedByDueDate(token, { start, end }), TODOIST_COMPLETED_RANGE_TIMEOUT_MS) || [];
  } catch (err) {
    console.error("[Todoist] completed-by-due-date fetch failed:", err.message);
    return [];
  }
}

export async function fetchTodoistTasks(userId, options = {}) {
  const { tasks } = await fetchMirrorMappedTasks(userId, options);
  return tasks;
}

// Full-horizon fetch for the calendar modal: overdue + future incomplete.
export async function fetchTodoistTasksAll(userId, options = {}) {
  const { tasks } = await fetchMirrorMappedTasks(userId, options);
  return tasks;
}

export async function fetchTodoistTasksRange(userId, { start, end, refresh = false }) {
  const token = await getToken(userId);
  const [{ tasks: active }, completedTasks] = await Promise.all([
    fetchMirrorMappedTasks(userId, { start, end, refresh }),
    fetchTodoistCompletedByDueDateWithFallback(token, { start, end }),
  ]);
  if (!active.length && !token) return [];

  const projects = token && completedTasks.length ? await fetchProjects(token) : new Map();
  const completed = completedTasks
    .map(t => mapCompletedTodoistTask(t, projects))
    .filter(t => t.id && isWithinDateRange(t.due_date, start, end));

  return dedupeTodoistRangeTasks([...active, ...completed]);
}

// Lean full-horizon id probe used by tombstone orphan detection. Returns a
// Set of id strings for every non-deleted, non-checked task with a due date.
// Returns null when Todoist isn't configured; callers must treat null as
// "can't verify" and skip pruning rather than wiping every tombstone.
export async function fetchTodoistTaskIdSet(userId, options = {}) {
  const health = await prepareTodoistMirrorRead(userId, options);
  if (!health.configured) return null;
  return listTodoistMirrorActiveTaskIds(userId);
}

export async function fetchTodoistTasksAndIdSet(userId, options = {}) {
  const { tasks, idSet } = await fetchMirrorMappedTasks(userId, options);
  return { tasks, idSet };
}

export async function completeTodoistTask(userId, taskId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  await todoistFetch(token, `/tasks/${taskId}/close`, { method: "POST" });
  await markTodoistMirrorItemCompleted(userId, taskId);
  requestTodoistWriteReconciliation(userId);
}

export async function deleteTodoistTask(userId, taskId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!taskId) throw new Error("Task id is required");
  await todoistFetch(token, `/tasks/${taskId}`, { method: "DELETE" });
  await markTodoistMirrorItemDeleted(userId, taskId);
  requestTodoistWriteReconciliation(userId);
}

export async function fetchTodoistProjects(userId) {
  const health = await prepareTodoistMirrorRead(userId);
  if (!health.configured) throw new Error("Todoist not configured");
  const projects = await listTodoistMirrorProjects(userId);
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    color: mapColor(project.color),
    isInbox: !!project.isInbox,
  }));
}

export async function fetchTodoistLabels(userId) {
  const health = await prepareTodoistMirrorRead(userId);
  if (!health.configured) throw new Error("Todoist not configured");
  const labels = await listTodoistMirrorLabels(userId);
  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: mapColor(label.color),
  }));
}

export async function createTodoistTask(userId, { content, description, project_id, priority, labels, due_string }) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!content?.trim()) throw new Error("Task content is required");

  const body = { content: content.trim() };
  if (description) body.description = description;
  if (project_id) body.project_id = project_id;
  if (priority) body.priority = toApiPriority(priority);
  if (labels?.length) body.labels = labels;
  if (due_string) body.due_string = due_string;

  const task = await todoistFetch(token, "/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await upsertTodoistMirrorItem(userId, task);
  requestTodoistWriteReconciliation(userId);

  // Return in the same format as fetchTodoistTasks
  const projects = await fetchProjects(token);
  const proj = projects.get(task.project_id);
  return {
    id: task.id,
    title: task.content,
    due_date: extractDate(task.due),
    due_time: formatTime12h(task.due?.date),
    class_name: proj?.name || "Todoist",
    class_color: proj ? mapColor(proj.color) : "#cba6da",
    points_possible: null,
    status: "incomplete",
    source: "todoist",
    description: task.description || "",
    url: todoistTaskUrl(task.content, task.id),
    priority: toUiPriority(task.priority),
    labels: task.labels || [],
    is_recurring: !!task.due?.is_recurring,
  };
}

export async function updateTodoistTask(userId, taskId, { content, description, project_id, priority, labels, due_string }) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!taskId) throw new Error("Task id is required");

  const body = {};
  if (content !== undefined) body.content = content.trim();
  if (description !== undefined) body.description = description;
  if (project_id !== undefined) body.project_id = project_id;
  if (priority !== undefined) body.priority = priority == null ? 1 : toApiPriority(priority);
  if (labels !== undefined) body.labels = labels;
  if (due_string !== undefined) body.due_string = due_string;

  const task = await todoistFetch(token, `/tasks/${taskId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  await upsertTodoistMirrorItem(userId, task);
  requestTodoistWriteReconciliation(userId);

  const projects = await fetchProjects(token);
  const proj = projects.get(task.project_id);
  // Intentionally omit `status` — the client merges this over the existing
  // row, and the UI's completion state (including tombstone/_completing flags)
  // must survive an edit.
  return {
    id: task.id,
    title: task.content,
    due_date: extractDate(task.due),
    due_time: formatTime12h(task.due?.date),
    class_name: proj?.name || "Todoist",
    class_color: proj ? mapColor(proj.color) : "#cba6da",
    points_possible: null,
    source: "todoist",
    description: task.description || "",
    url: todoistTaskUrl(task.content, task.id),
    priority: toUiPriority(task.priority),
    labels: task.labels || [],
    is_recurring: !!task.due?.is_recurring,
  };
}

export async function testConnection(userId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist API token not configured");
  const data = await todoistFetch(token, "/projects?limit=1");
  return { success: true, projectCount: (data.results || data).length };
}

export async function getTodoistSyncHealth(userId) {
  return getTodoistMirrorHealth(userId);
}

// Test-only exports (do not use in production code)
export const __testing__ = {
  dedupeTodoistRangeTasks,
  mapCompletedTodoistTask,
  mapTodoistTask,
  TODOIST_DUE_TASKS_QUERY,
};
