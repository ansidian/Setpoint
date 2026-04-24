import { decrypt } from "./encryption.js";
import db from "../db/connection.js";

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
let labelCache = { data: null, ts: 0 };

async function getToken(userId) {
  const result = await db.execute({
    sql: "SELECT todoist_api_token_encrypted FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  const encrypted = result.rows[0]?.todoist_api_token_encrypted;
  if (!encrypted) return null;
  return decrypt(encrypted);
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

async function fetchTodoistFiltered(token, query) {
  const params = new URLSearchParams({ query, limit: "200" });
  const allTasks = [];
  let cursor = null;
  do {
    if (cursor) params.set("cursor", cursor);
    const data = await todoistFetch(token, `/tasks/filter?${params}`);
    allTasks.push(...(data.results || data.items || []));
    cursor = data.next_cursor || null;
  } while (cursor);
  return allTasks;
}

export async function fetchTodoistTasks(userId) {
  const token = await getToken(userId);
  if (!token) return [];

  const projects = await fetchProjects(token);
  const tasks = await fetchTodoistFiltered(token, TODOIST_DUE_TASKS_QUERY);

  return tasks
    .filter(t => !t.checked && !t.is_deleted && t.due)
    .map(t => mapTodoistTask(t, projects));
}

// Full-horizon fetch for the calendar modal: overdue + future incomplete.
export async function fetchTodoistTasksAll(userId) {
  const token = await getToken(userId);
  if (!token) return [];

  const projects = await fetchProjects(token);
  const tasks = await fetchTodoistFiltered(token, TODOIST_DUE_TASKS_QUERY);

  return tasks
    .filter(t => !t.checked && !t.is_deleted && t.due)
    .map(t => mapTodoistTask(t, projects));
}

// Lean full-horizon id probe used by tombstone orphan detection. Returns a
// Set of id strings for every non-deleted, non-checked task with a due date.
// Returns null when Todoist isn't configured; callers must treat null as
// "can't verify" and skip pruning rather than wiping every tombstone.
export async function fetchTodoistTaskIdSet(userId) {
  const token = await getToken(userId);
  if (!token) return null;
  const tasks = await fetchTodoistFiltered(token, TODOIST_DUE_TASKS_QUERY);
  return new Set(
    tasks
      .filter(t => !t.is_deleted && !t.checked)
      .map(t => String(t.id)),
  );
}

export async function completeTodoistTask(userId, taskId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  await todoistFetch(token, `/tasks/${taskId}/close`, { method: "POST" });
}

export async function deleteTodoistTask(userId, taskId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!taskId) throw new Error("Task id is required");
  await todoistFetch(token, `/tasks/${taskId}`, { method: "DELETE" });
}

export async function fetchTodoistProjects(userId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  const projects = await fetchProjects(token);
  return Array.from(projects.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    color: mapColor(p.color),
    isInbox: !!p.isInbox,
  }));
}

export async function fetchTodoistLabels(userId) {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (labelCache.data && Date.now() - labelCache.ts < CACHE_TTL_MS) {
    return labelCache.data;
  }
  const data = await todoistFetch(token, "/labels");
  const labels = (data.results || data).map(l => ({ id: l.id, name: l.name, color: mapColor(l.color) }));
  labelCache = { data: labels, ts: Date.now() };
  return labels;
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

// Test-only exports (do not use in production code)
export const __testing__ = { mapTodoistTask, TODOIST_DUE_TASKS_QUERY };
