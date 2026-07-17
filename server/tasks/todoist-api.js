import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";

const TODOIST_SYNC_URL = "https://api.todoist.com/api/v1/sync";
const SYNC_API_TIMEOUT_MS = 30_000;

export const TODOIST_MIRROR_RESOURCE_TYPES = ["items", "projects", "labels"];

export class TodoistSyncError extends Error {
  constructor(message, { status = null, body = "" } = {}) {
    super(message);
    this.name = "TodoistSyncError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchTodoistSyncResources({
  token,
  syncToken = "*",
  resourceTypes = TODOIST_MIRROR_RESOURCE_TYPES,
  fetchFn = fetch,
} = {}) {
  if (!token) throw new TodoistSyncError("Todoist token is required");

  const body = new URLSearchParams({
    sync_token: syncToken,
    resource_types: JSON.stringify(resourceTypes),
  });
  const res = await fetchWithTimeout(TODOIST_SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, { timeoutMs: SYNC_API_TIMEOUT_MS, fetchFn });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TodoistSyncError(`Todoist Sync API ${res.status}: ${text}`, {
      status: res.status,
      body: text,
    });
  }

  return res.json();
}
