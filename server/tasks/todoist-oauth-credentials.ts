import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import { InstanceCredentialConflictError } from "../platform/instance-credential-store.ts";

const CLIENT_ID_KEY = "tasks.todoist_client_id";
const CLIENT_SECRET_KEY = "tasks.todoist_client_secret";

export type TodoistOAuthApplicationCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TodoistOAuthCandidateVersions = {
  clientId: number;
  clientSecret: number;
};

export class TodoistOAuthConfigurationError extends Error {
  readonly status = 409;
  readonly code: "TODOIST_OAUTH_NOT_CONFIGURED" | "TODOIST_OAUTH_CANDIDATE_INCOMPLETE";

  constructor(code: "TODOIST_OAUTH_NOT_CONFIGURED" | "TODOIST_OAUTH_CANDIDATE_INCOMPLETE") {
    super(code === "TODOIST_OAUTH_NOT_CONFIGURED"
      ? "Todoist OAuth application credentials are not configured"
      : "Todoist OAuth application credential candidate is incomplete");
    this.code = code;
  }
}

export function createTodoistOAuthCredentialManager(injectedService?: InstanceCredentialService) {
  async function service(): Promise<InstanceCredentialService> {
    if (injectedService) return injectedService;
    return (await import("../platform/instance-credential-service.ts")).instanceCredentialService;
  }

  async function resolveActive(): Promise<TodoistOAuthApplicationCredentials> {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.resolve(CLIENT_ID_KEY),
      credentials.resolve(CLIENT_SECRET_KEY),
    ]);
    if (!clientId.value || !clientSecret.value) {
      throw new TodoistOAuthConfigurationError("TODOIST_OAUTH_NOT_CONFIGURED");
    }
    return { clientId: clientId.value, clientSecret: clientSecret.value };
  }

  async function selectForAuthorization() {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.readPending(CLIENT_ID_KEY),
      credentials.readPending(CLIENT_SECRET_KEY),
    ]);
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new TodoistOAuthConfigurationError("TODOIST_OAUTH_CANDIDATE_INCOMPLETE");
    }
    if (clientId && clientSecret) {
      return {
        credentials: { clientId: clientId.value, clientSecret: clientSecret.value },
        candidateVersions: { clientId: clientId.version, clientSecret: clientSecret.version },
      };
    }
    return { credentials: await resolveActive(), candidateVersions: null };
  }

  async function stageCandidate(credentials: TodoistOAuthApplicationCredentials) {
    const credentialService = await service();
    const metadata = await credentialService.stagePendingGroup([
      { key: CLIENT_ID_KEY, value: credentials.clientId },
      { key: CLIENT_SECRET_KEY, value: credentials.clientSecret },
    ]);
    return {
      credentials: metadata,
      candidateVersions: {
        clientId: metadata[0]!.version!,
        clientSecret: metadata[1]!.version!,
      },
    };
  }

  async function resolveCandidate(candidateVersions: TodoistOAuthCandidateVersions) {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.readPending(CLIENT_ID_KEY),
      credentials.readPending(CLIENT_SECRET_KEY),
    ]);
    if (!clientId || !clientSecret
      || clientId.version !== candidateVersions.clientId
      || clientSecret.version !== candidateVersions.clientSecret) {
      throw new InstanceCredentialConflictError();
    }
    return { clientId: clientId.value, clientSecret: clientSecret.value };
  }

  async function promoteCandidate(candidateVersions: TodoistOAuthCandidateVersions) {
    const credentials = await service();
    return credentials.promotePendingGroup([
      { key: CLIENT_ID_KEY, expectedVersion: candidateVersions.clientId },
      { key: CLIENT_SECRET_KEY, expectedVersion: candidateVersions.clientSecret },
    ]);
  }

  async function importEnvironment() {
    const credentials = await service();
    return credentials.importEnvironmentGroup([CLIENT_ID_KEY, CLIENT_SECRET_KEY]);
  }

  return {
    resolveActive,
    selectForAuthorization,
    stageCandidate,
    resolveCandidate,
    promoteCandidate,
    importEnvironment,
  };
}

export type TodoistOAuthCredentialManager = ReturnType<typeof createTodoistOAuthCredentialManager>;
export const todoistOAuthCredentialManager = createTodoistOAuthCredentialManager();
