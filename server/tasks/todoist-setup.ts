export {
  todoistOAuthCredentialManager,
  type TodoistOAuthCredentialManager,
} from "./todoist-oauth-credentials.ts";
export {
  todoistOAuthService,
  type TodoistOAuthService,
} from "./todoist-oauth.ts";
export async function saveTodoistPersonalTokenCandidate(userId: string, token: string) {
  const service = await import("./todoist-personal-token.ts");
  return service.saveTodoistPersonalTokenCandidate(userId, token);
}

export async function disconnectTodoistConnection(userId: string) {
  const service = await import("./todoist-personal-token.ts");
  return service.disconnectTodoistConnection(userId);
}
