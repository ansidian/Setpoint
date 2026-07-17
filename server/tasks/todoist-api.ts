import { fetchWithTimeout, type FetchFunction } from "../platform/fetch-with-timeout.ts";
import type { RawTodoistItem, RawTodoistLabel, RawTodoistProject } from "./todoistMirrorStatements.ts";

const TODOIST_SYNC_URL = "https://api.todoist.com/api/v1/sync";
const SYNC_API_TIMEOUT_MS = 30_000;

export const TODOIST_MIRROR_RESOURCE_TYPES = ["items", "projects", "labels"] as const;
export type TodoistMirrorResourceType = typeof TODOIST_MIRROR_RESOURCE_TYPES[number];

export interface TodoistSyncResponse extends Record<string, unknown> {
  sync_token: string;
  full_sync?: boolean;
  items?: RawTodoistItem[];
  projects?: RawTodoistProject[];
  labels?: RawTodoistLabel[];
}

interface TodoistSyncFetchResponse {
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

export class TodoistSyncError extends Error {
  status: number | null;
  body: string;

  constructor(message: string, { status = null, body = "" }: { status?: number | null; body?: string } = {}) {
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
}: {
  token?: string | null;
  syncToken?: string;
  resourceTypes?: readonly TodoistMirrorResourceType[];
  fetchFn?: FetchFunction<TodoistSyncFetchResponse>;
} = {}): Promise<TodoistSyncResponse> {
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
    const text = await res.text!().catch(() => "");
    throw new TodoistSyncError(`Todoist Sync API ${res.status}: ${text}`, {
      status: res.status ?? null,
      body: text,
    });
  }

  return await res.json!() as TodoistSyncResponse;
}
