import { apiFetch } from "./apiFetch";
import type {
  TodoistConnectionStatus,
  TodoistOAuthApplicationRequest,
  TodoistOAuthAuthorizationResponse,
} from "../../shared/types/tasks";

export const getTodoistConnectionStatus = (): Promise<TodoistConnectionStatus> =>
  apiFetch("/api/ea/accounts/todoist/status");

export const stageTodoistOAuthApplication = (data: TodoistOAuthApplicationRequest): Promise<unknown> =>
  apiFetch("/api/instance-credentials/todoist-oauth/pending", {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const importTodoistOAuthEnvironment = (): Promise<unknown> =>
  apiFetch("/api/instance-credentials/todoist-oauth/import-environment", { method: "POST" });

export const beginTodoistOAuth = (): Promise<TodoistOAuthAuthorizationResponse> =>
  apiFetch("/api/ea/accounts/todoist/auth");
