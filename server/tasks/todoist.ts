import {
  getTodoistMirrorHealth,
  listTodoistMirrorActiveTasks,
  listTodoistMirrorCompletedTasks,
  listTodoistMirrorDueTaskIds,
  listTodoistMirrorLabels,
  listTodoistMirrorProjects,
  markTodoistMirrorItemCompleted,
  markTodoistMirrorItemDeleted,
  syncTodoistMirror,
  upsertTodoistMirrorItem,
} from "./todoist-mirror.ts";
import { requestTodoistMirrorSync } from "./todoist-webhook.ts";
import { getTodoistApiToken } from "./todoist-token.ts";
import type {
  TodoistLabel,
  TodoistMirrorHealth,
  TodoistPriority,
  TodoistProject,
  TodoistTask,
} from "../../shared/types/tasks.ts";
import type { RawTodoistDue, RawTodoistItem } from "./todoistMirrorStatements.ts";

const BASE_URL = "https://api.todoist.com/api/v1";
// Todoist's REST API inverts our UI priority scale: API 4 = urgent, API 1 =
// natural/no priority. Dashboard uses 1 = urgent, 4 = low, null = none.
// Note: Todoist can't distinguish "user picked P4 Low" from "no priority" —
// both come back as API 1, so a roundtrip collapses UI P4 → null.
interface TodoistProjectInfo {
  name: string;
  color: string | null;
  isInbox?: boolean;
}

type TodoistProjectMap = Map<string, TodoistProjectInfo>;

interface TodoistReadOptions {
  start?: string | null;
  end?: string | null;
  refresh?: boolean;
}

interface TodoistMutationPayload {
  content?: string;
  description?: string;
  project_id?: string | null;
  priority?: TodoistPriority;
  labels?: string[];
  due_string?: string;
}

interface TodoistRestTask extends RawTodoistItem {
  id: string;
  content: string;
  description?: string | null;
  project_id?: string | null;
  due?: RawTodoistDue | null;
  labels?: string[] | null;
}

interface RawCompletedTodoistTask extends Record<string, unknown> {
  id?: string | null;
  task_id?: string | null;
  item_id?: string | null;
  content?: string | null;
  task_content?: string | null;
  title?: string | null;
  name?: string | null;
  project_id?: string | null;
  projectId?: string | null;
  project_name?: string | null;
  due?: RawTodoistDue | null;
  due_date?: string | null;
  date_due?: string | null;
  dueDate?: string | null;
  is_recurring?: boolean | null;
  recurring?: boolean | null;
  description?: string | null;
  priority?: number | null;
  labels?: string[] | null;
  completed_at?: string | null;
  completed_at_date?: string | null;
  date_completed?: string | null;
}

type TodoistFetchOptions = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

interface ProjectListResponse {
  results?: Array<{ id: string; name: string; color?: string | null; is_inbox_project?: boolean }>;
  next_cursor?: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toApiPriority(uiLevel: TodoistPriority): number | undefined {
  if (uiLevel == null) return undefined;
  return 5 - uiLevel;
}
function toUiPriority(apiLevel: number | null | undefined): TodoistPriority {
  if (apiLevel == null || apiLevel === 1) return null;
  return (5 - apiLevel) as Exclude<TodoistPriority, null>;
}

// --- Caches: 10-minute TTL ---
const CACHE_TTL_MS = 10 * 60 * 1000;
// P3-13: keyed by userId (mirrors the per-user backgroundSyncs map) so a future
// multi-user deployment never serves one user's project names/colors to another.
const projectCache = new Map<string, { data: TodoistProjectMap; ts: number }>(); // userId -> { data, ts }
const MIRROR_BOOTSTRAP_TIMEOUT_MS = 10_000;
const MIRROR_REFRESH_TIMEOUT_MS = 2_000;
const backgroundSyncs = new Map<string, Promise<unknown>>();

async function getToken(userId: string): Promise<string | null> {
  return getTodoistApiToken(userId);
}

async function todoistFetch<T>(token: string, path: string, options: TodoistFetchOptions = {}): Promise<T> {
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
  if (res.status === 204) return null as T;
  return await res.json() as T;
}

async function fetchProjects(token: string, userId: string): Promise<TodoistProjectMap> {
  const cached = projectCache.get(userId);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const map: TodoistProjectMap = new Map();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "200");
    const data = await todoistFetch<ProjectListResponse | NonNullable<ProjectListResponse["results"]>>(token, `/projects?${params}`);
    const page = Array.isArray(data) ? data : data.results || [];
    for (const p of page) {
      map.set(p.id, { name: p.name, color: p.color ?? null, isInbox: !!p.is_inbox_project });
    }
    cursor = Array.isArray(data) ? null : data.next_cursor || null;
  } while (cursor);
  projectCache.set(userId, { data: map, ts: Date.now() });
  return map;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function requestTodoistMirrorBackgroundSync(userId: string): Promise<unknown> {
  if (backgroundSyncs.has(userId)) return backgroundSyncs.get(userId)!;
  const syncPromise = syncTodoistMirror(userId)
    .catch((err) => {
      console.error("[Todoist] background mirror sync failed:", errorMessage(err));
      return null;
    })
    .finally(() => backgroundSyncs.delete(userId));
  backgroundSyncs.set(userId, syncPromise);
  return syncPromise;
}

async function waitForTodoistMirrorSync(userId: string, {
  forceFull = false,
  timeoutMs,
}: { forceFull?: boolean; timeoutMs: number }): Promise<unknown> {
  try {
    return await withTimeout(syncTodoistMirror(userId, { forceFull }), timeoutMs);
  } catch (err) {
    console.error("[Todoist] mirror sync failed:", errorMessage(err));
    return null;
  }
}

function requestTodoistWriteReconciliation(userId: string): void {
  requestTodoistMirrorSync(userId, {
    reason: "todoist-write",
  });
}

async function prepareTodoistMirrorRead(userId: string, {
  refresh = false,
}: { refresh?: boolean } = {}): Promise<TodoistMirrorHealth> {
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

async function fetchMirrorProjectMap(userId: string): Promise<TodoistProjectMap> {
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

async function fetchMirrorMappedTasks(userId: string, {
  start = null,
  end = null,
  refresh = false,
  // P2-6/P2-25: a caller fetching both active and completed tasks can resolve
  // mirror health and the project map ONCE and pass them in, so each inner read
  // skips its own redundant prepare + project-map round-trips.
  health: providedHealth = null,
  projects: providedProjects = null,
}: TodoistReadOptions & { health?: TodoistMirrorHealth | null; projects?: TodoistProjectMap | null } = {}): Promise<{ tasks: TodoistTask[]; idSet: Set<string> | null; health: TodoistMirrorHealth }> {
  const health = providedHealth || await prepareTodoistMirrorRead(userId, { refresh });
  if (!health.configured) return { tasks: [], idSet: null, health };

  const [projects, tasks] = await Promise.all([
    providedProjects || fetchMirrorProjectMap(userId),
    listTodoistMirrorActiveTasks(userId, { start, end }),
  ]);
  const mappedTasks = tasks.map((task) => mapTodoistTask(task, projects));
  return {
    tasks: mappedTasks,
    idSet: new Set(mappedTasks.map((task) => String(task.id))),
    health,
  };
}

async function fetchMirrorMappedCompletedTasks(userId: string, {
  start = null,
  end = null,
  health: providedHealth = null,
  projects: providedProjects = null,
}: TodoistReadOptions & { health?: TodoistMirrorHealth | null; projects?: TodoistProjectMap | null } = {}): Promise<{ tasks: TodoistTask[]; health: TodoistMirrorHealth }> {
  const health = providedHealth || await prepareTodoistMirrorRead(userId);
  if (!health.configured) return { tasks: [], health };

  const [projects, tasks] = await Promise.all([
    providedProjects || fetchMirrorProjectMap(userId),
    listTodoistMirrorCompletedTasks(userId, { start, end }),
  ]);
  return {
    tasks: tasks.map((task) => mapCompletedTodoistTask(task as RawCompletedTodoistTask, projects)),
    health,
  };
}

// Map Todoist color names to hex (subset of Todoist palette)
const TODOIST_COLORS: Record<string, string> = {
  berry_red: "#b8255f", red: "#db4035", orange: "#ff9933",
  yellow: "#fad000", olive_green: "#afb83b", lime_green: "#7ecc49",
  green: "#299438", mint_green: "#6accbc", teal: "#158fad",
  sky_blue: "#14aaf5", light_blue: "#96c3eb", blue: "#4073ff",
  grape: "#884dff", violet: "#af38eb", lavender: "#eb96eb",
  magenta: "#e05194", salmon: "#ff8d85", charcoal: "#808080",
  grey: "#b8b8b8", taupe: "#ccac93",
};

function mapColor(todoistColor: string | null | undefined): string {
  return (todoistColor ? TODOIST_COLORS[todoistColor] : undefined) || "#cba6da";
}

// Todoist returns due datetimes in one of two shapes: (1) the user's local
// timezone without a Z/offset suffix (a "floating" due) — parse the time
// directly from the string to avoid UTC reinterpretation; (2) a fixed-timezone
// due as a real RFC3339 UTC instant with a trailing Z or ±HH:MM offset — that
// literal HH:MM is UTC, so it must be converted to Pacific before display.
const OFFSET_SUFFIX_RE = /Z$|[+-]\d{2}:\d{2}$/;

function formatTime12h(dateStr: string | null | undefined): string | null {
  if (!dateStr || !dateStr.includes("T")) return null;
  if (OFFSET_SUFFIX_RE.test(dateStr)) {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(dateStr));
    // Intl gives "7:00 PM"; normalize the space before AM/PM if it's a
    // non-breaking space (some ICU builds emit U+202F narrow no-break space).
    return formatted.replace(/\s+(AM|PM)$/, " $1");
  }
  const match = dateStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  let hour = parseInt(match[1] ?? "", 10);
  const minute = match[2] ?? "00";
  const ampm = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${ampm}`;
}

function todoistTaskUrl(content: string, id: string): string {
  const slug = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://app.todoist.com/app/task/${slug}-${id}`;
}

function extractDate(due: RawTodoistDue | null | undefined): string | null {
  if (!due?.date) return null;
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..." (floating, no suffix): the date
  // component is already the intended local day, so split on "T" literally.
  // Z/offset-suffixed strings are a real UTC instant — resolve the Pacific
  // calendar day via the same en-CA formatter as todayPacific() instead.
  if (OFFSET_SUFFIX_RE.test(due.date)) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(due.date));
  }
  return due.date.split("T")[0] ?? null;
}

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function mapTodoistTask(t: RawTodoistItem, projects: TodoistProjectMap): TodoistTask {
  const projectId = t.project_id == null ? null : String(t.project_id);
  const proj = projectId ? projects.get(projectId) : undefined;
  const id = String(t.id ?? "");
  const title = String(t.content || "");
  return {
    id,
    title,
    due_date: extractDate(t.due),
    due_time: formatTime12h(t.due?.date),
    class_name: proj?.name || "Todoist",
    class_color: proj ? mapColor(proj.color) : "#cba6da",
    points_possible: null,
    status: t.checked ? "complete" : "incomplete",
    source: "todoist",
    description: t.description || "",
    url: todoistTaskUrl(title, id),
    priority: toUiPriority(t.priority),
    labels: (t.labels || []).map(String),
    is_recurring: !!t.due?.is_recurring,
  };
}

function completedTaskId(t: RawCompletedTodoistTask): string | null {
  return t.task_id || t.id || t.item_id || null;
}

function completedDueDate(t: RawCompletedTodoistTask): string | null {
  if (t.due?.date) return extractDate(t.due);
  const raw = t.due_date || t.date_due || t.dueDate;
  return raw ? String(raw).split("T")[0] ?? null : null;
}

function completedContent(t: RawCompletedTodoistTask): string {
  return t.content || t.task_content || t.title || t.name || "Untitled task";
}

function mapCompletedTodoistTask(t: RawCompletedTodoistTask, projects: TodoistProjectMap): TodoistTask {
  const id = completedTaskId(t);
  const title = completedContent(t);
  const projectId = t.project_id || t.projectId;
  const proj = projectId ? projects.get(String(projectId)) : undefined;
  const dueDate = completedDueDate(t);
  const due = t.due?.date
    ? t.due
    : dueDate
      ? { date: dueDate, is_recurring: !!(t.is_recurring || t.recurring) }
      : null;
  return {
    id: id || "",
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

function dedupeTodoistRangeTasks<T extends Pick<TodoistTask, "id" | "due_date">>(tasks: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const task of tasks) {
    const key = `${task.id}:${task.due_date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(task);
  }
  return result;
}

export async function fetchTodoistTasks(userId: string, options: TodoistReadOptions = {}): Promise<TodoistTask[]> {
  return fetchMirrorMappedTasksWithVisibleCompleted(userId, options);
}

async function fetchMirrorMappedTasksWithVisibleCompleted(userId: string, options: TodoistReadOptions = {}): Promise<TodoistTask[]> {
  // P2-6/P2-25: resolve mirror health (with the active read's refresh semantics)
  // and the project map ONCE, then thread them into both reads so they no longer
  // each run prepareTodoistMirrorRead + fetchMirrorProjectMap.
  const health = await prepareTodoistMirrorRead(userId, { refresh: options.refresh || false });
  const projects = health.configured ? await fetchMirrorProjectMap(userId) : null;
  const [{ tasks: active }, { tasks: completed }] = await Promise.all([
    fetchMirrorMappedTasks(userId, { ...options, health, projects }),
    fetchMirrorMappedCompletedTasks(userId, { start: todayPacific(), health, projects }),
  ]);
  return dedupeTodoistRangeTasks([...active, ...completed]);
}

// Full-horizon fetch for the calendar modal: overdue + future incomplete,
// plus checked tasks that remain visible through their due date.
export async function fetchTodoistTasksAll(userId: string, options: TodoistReadOptions = {}): Promise<TodoistTask[]> {
  return fetchMirrorMappedTasksWithVisibleCompleted(userId, options);
}

export async function fetchTodoistTasksRange(userId: string, { start, end, refresh = false }: { start: string; end: string; refresh?: boolean }): Promise<TodoistTask[]> {
  // P2-6/P2-25: same single-resolution pattern as fetchMirrorMappedTasksWithVisibleCompleted.
  const health = await prepareTodoistMirrorRead(userId, { refresh });
  const projects = health.configured ? await fetchMirrorProjectMap(userId) : null;
  const [{ tasks: active }, { tasks: completed }] = await Promise.all([
    fetchMirrorMappedTasks(userId, { start, end, refresh, health, projects }),
    fetchMirrorMappedCompletedTasks(userId, { start, end, health, projects }),
  ]);
  return dedupeTodoistRangeTasks([...active, ...completed]);
}

// Lean full-horizon id probe used by tombstone orphan detection. Returns a
// Set of id strings for every non-deleted, non-checked task with a due date.
// Returns null when Todoist isn't configured; callers must treat null as
// "can't verify" and skip pruning rather than wiping every tombstone.
export async function fetchTodoistDueTaskIdSet(userId: string, options: { refresh?: boolean } = {}): Promise<Set<string> | null> {
  const health = await prepareTodoistMirrorRead(userId, options);
  if (!health.configured) return null;
  return listTodoistMirrorDueTaskIds(userId);
}

export async function completeTodoistTask(userId: string, taskId: string, occurrenceDate: string): Promise<void> {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  await todoistFetch<null>(token, `/tasks/${taskId}/close`, { method: "POST" });
  await markTodoistMirrorItemCompleted(userId, taskId, occurrenceDate);
  requestTodoistWriteReconciliation(userId);
}

export async function deleteTodoistTask(userId: string, taskId: string): Promise<void> {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!taskId) throw new Error("Task id is required");
  await todoistFetch<null>(token, `/tasks/${taskId}`, { method: "DELETE" });
  await markTodoistMirrorItemDeleted(userId, taskId);
  requestTodoistWriteReconciliation(userId);
}

export async function fetchTodoistProjects(userId: string): Promise<TodoistProject[]> {
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

export async function fetchTodoistLabels(userId: string): Promise<TodoistLabel[]> {
  const health = await prepareTodoistMirrorRead(userId);
  if (!health.configured) throw new Error("Todoist not configured");
  const labels = await listTodoistMirrorLabels(userId);
  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: mapColor(label.color),
  }));
}

export async function createTodoistTask(userId: string, { content, description, project_id, priority, labels, due_string }: TodoistMutationPayload): Promise<TodoistTask> {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!content?.trim()) throw new Error("Task content is required");

  const body: Record<string, unknown> = { content: content.trim() };
  if (description) body.description = description;
  if (project_id) body.project_id = project_id;
  if (priority) body.priority = toApiPriority(priority);
  if (labels?.length) body.labels = labels;
  if (due_string) body.due_string = due_string;
  if (body.due_string) body.due_lang = "en";

  const task = await todoistFetch<TodoistRestTask>(token, "/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await upsertTodoistMirrorItem(userId, task);
  requestTodoistWriteReconciliation(userId);

  // Return in the same format as fetchTodoistTasks
  const projects = await fetchProjects(token, userId);
  const proj = task.project_id ? projects.get(String(task.project_id)) : undefined;
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

export async function updateTodoistTask(userId: string, taskId: string, { content, description, project_id, priority, labels, due_string }: TodoistMutationPayload): Promise<TodoistTask> {
  const token = await getToken(userId);
  if (!token) throw new Error("Todoist not configured");
  if (!taskId) throw new Error("Task id is required");

  const body: Record<string, unknown> = {};
  if (content !== undefined) body.content = content.trim();
  if (description !== undefined) body.description = description;
  if (project_id !== undefined) body.project_id = project_id;
  if (priority !== undefined) body.priority = priority == null ? 1 : toApiPriority(priority);
  if (labels !== undefined) body.labels = labels;
  if (due_string !== undefined) body.due_string = due_string;
  if (body.due_string) body.due_lang = "en";

  const task = await todoistFetch<TodoistRestTask>(token, `/tasks/${taskId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  await upsertTodoistMirrorItem(userId, task);
  requestTodoistWriteReconciliation(userId);

  const projects = await fetchProjects(token, userId);
  const proj = task.project_id ? projects.get(String(task.project_id)) : undefined;
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

export async function getTodoistSyncHealth(userId: string): Promise<TodoistMirrorHealth> {
  return getTodoistMirrorHealth(userId);
}
