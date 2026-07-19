import crypto from "crypto";
import db from "../db/connection.ts";
import { canonicalUrlService } from "../platform/canonical-url.ts";
import { fetchWithTimeout, type FetchFunction } from "../platform/fetch-with-timeout.ts";
import { clearTodoistNeedsReauth } from "../platform/provider-reauth.ts";
import { instanceCredentialService } from "../platform/instance-credential-service.ts";
import {
  todoistOAuthCredentialManager,
  type TodoistOAuthCandidateVersions,
  type TodoistOAuthCredentialManager,
} from "./todoist-oauth-credentials.ts";
import { storeTodoistOAuthTokenResponse } from "./todoist-token.ts";
import type { Client } from "@libsql/client";

const TODOIST_AUTHORIZATION_URL = "https://app.todoist.com/oauth/authorize";
const TODOIST_TOKEN_URL = "https://api.todoist.com/oauth/access_token";
const TODOIST_SCOPE = "data:read_write,data:delete";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 10_000;

type TodoistOAuthDb = Pick<Client, "execute">;
type TodoistTokenResponse = {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | string | null;
  scope?: string | null;
  token_type?: string | null;
};
type OAuthFetchResponse = {
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

export class TodoistOAuthFlowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TodoistOAuthFlowError";
    this.code = code;
    this.status = status;
  }
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function candidateVersionsFromRow(row: Record<string, unknown>): TodoistOAuthCandidateVersions | null {
  const clientId = row.client_id_version;
  const clientSecret = row.client_secret_version;
  if (clientId == null && clientSecret == null) return null;
  const versions = { clientId: Number(clientId), clientSecret: Number(clientSecret) };
  if (!Number.isInteger(versions.clientId) || !Number.isInteger(versions.clientSecret)) {
    throw new TodoistOAuthFlowError("TODOIST_OAUTH_STATE_INVALID", "Todoist OAuth state is invalid");
  }
  return versions;
}

export function createTodoistOAuthService({
  dbClient = db,
  credentialManager = todoistOAuthCredentialManager,
  canonicalUrlResolver = () => canonicalUrlService.resolveProviderCallbackUrl("todoistOAuth"),
  webhookUrlResolver = () => canonicalUrlService.resolveProviderCallbackUrl("todoistWebhook"),
  credentialMetadataResolver = (key: string) => instanceCredentialService.getCredentialMetadata(key),
  fetchFn = fetch,
  storeTokenResponse = (userId: string, response: TodoistTokenResponse) =>
    storeTodoistOAuthTokenResponse(userId, response),
  randomState = () => crypto.randomBytes(32).toString("base64url"),
  now = () => Date.now(),
}: {
  dbClient?: TodoistOAuthDb;
  credentialManager?: TodoistOAuthCredentialManager;
  canonicalUrlResolver?: () => Promise<string>;
  webhookUrlResolver?: () => Promise<string>;
  credentialMetadataResolver?: (key: string) => Promise<{
    source: string;
    activeConfigured: boolean;
    pendingConfigured: boolean;
  }>;
  fetchFn?: FetchFunction<OAuthFetchResponse>;
  storeTokenResponse?: (userId: string, response: TodoistTokenResponse) => Promise<unknown>;
  randomState?: () => string;
  now?: () => number;
} = {}) {
  async function beginAuthorization(userId: string, browserBindHash: string) {
    const selection = await credentialManager.selectForAuthorization();
    const state = randomState();
    const createdAt = now();
    await dbClient.execute({
      sql: "DELETE FROM ea_todoist_oauth_states WHERE expires_at < ?",
      args: [createdAt],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_todoist_oauth_states
              (state, user_id, browser_bind_hash, client_id_version, client_secret_version, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        state,
        userId,
        browserBindHash,
        selection.candidateVersions?.clientId ?? null,
        selection.candidateVersions?.clientSecret ?? null,
        createdAt + STATE_TTL_MS,
        createdAt,
      ],
    });
    const url = new URL(TODOIST_AUTHORIZATION_URL);
    url.searchParams.set("client_id", selection.credentials.clientId);
    url.searchParams.set("scope", TODOIST_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    return { url: url.toString() };
  }

  async function completeAuthorization({
    code,
    state,
    browserBindHash,
  }: {
    code: string;
    state: string;
    browserBindHash: string;
  }) {
    const result = await dbClient.execute({
      sql: `SELECT user_id, browser_bind_hash, client_id_version, client_secret_version, expires_at
            FROM ea_todoist_oauth_states WHERE state = ?`,
      args: [state],
    });
    await dbClient.execute({
      sql: "DELETE FROM ea_todoist_oauth_states WHERE state = ?",
      args: [state],
    });
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) {
      throw new TodoistOAuthFlowError("TODOIST_OAUTH_STATE_INVALID", "Todoist OAuth state is invalid");
    }
    if (now() > Number(row.expires_at)) {
      throw new TodoistOAuthFlowError("TODOIST_OAUTH_STATE_EXPIRED", "Todoist OAuth state expired");
    }
    if (!safeHashEqual(String(row.browser_bind_hash), browserBindHash)) {
      throw new TodoistOAuthFlowError("TODOIST_OAUTH_BROWSER_MISMATCH", "Todoist OAuth browser binding failed");
    }

    const candidateVersions = candidateVersionsFromRow(row);
    const applicationCredentials = candidateVersions
      ? await credentialManager.resolveCandidate(candidateVersions)
      : await credentialManager.resolveActive();
    const redirectUri = await canonicalUrlResolver();
    const response = await fetchWithTimeout(TODOIST_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: applicationCredentials.clientId,
        client_secret: applicationCredentials.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }, { timeoutMs: TOKEN_TIMEOUT_MS, fetchFn });
    if (!response.ok) {
      await response.text?.().catch(() => "");
      throw new TodoistOAuthFlowError(
        "TODOIST_OAUTH_EXCHANGE_FAILED",
        "Todoist OAuth authorization could not be completed",
        422,
      );
    }
    const tokenResponse = await response.json?.() as Partial<TodoistTokenResponse> | undefined;
    if (!tokenResponse || typeof tokenResponse.access_token !== "string" || !tokenResponse.access_token) {
      throw new TodoistOAuthFlowError(
        "TODOIST_OAUTH_EXCHANGE_FAILED",
        "Todoist OAuth authorization could not be completed",
        422,
      );
    }
    if (candidateVersions) await credentialManager.promoteCandidate(candidateVersions);
    await storeTokenResponse(String(row.user_id), tokenResponse as TodoistTokenResponse);
    await clearTodoistNeedsReauth(String(row.user_id), { dbClient: dbClient as Client }).catch(() => {});
    return { connected: true as const };
  }

  async function getStatus(userId: string) {
    const [settings, clientId, clientSecret, callbackUrl, webhookUrl] = await Promise.all([
      dbClient.execute({
        sql: `SELECT todoist_api_token_encrypted, todoist_oauth_refresh_token_encrypted,
                     todoist_connection_mode, todoist_needs_reauth
              FROM ea_settings WHERE user_id = ?`,
        args: [userId],
      }),
      credentialMetadataResolver("tasks.todoist_client_id"),
      credentialMetadataResolver("tasks.todoist_client_secret"),
      canonicalUrlResolver(),
      webhookUrlResolver(),
    ]);
    const row = settings.rows[0] as unknown as Record<string, unknown> | undefined;
    const configured = Boolean(row?.todoist_api_token_encrypted);
    const storedMode = row?.todoist_connection_mode;
    const mode = storedMode === "oauth" || storedMode === "personal_token"
      ? storedMode
      : configured
        ? row?.todoist_oauth_refresh_token_encrypted ? "oauth" : "personal_token"
        : "disconnected";
    const applicationConfigured = clientId.activeConfigured && clientSecret.activeConfigured;
    const source = clientId.source === clientSecret.source ? clientId.source : "mixed";
    return {
      mode,
      configured,
      oauthRefreshable: Boolean(row?.todoist_oauth_refresh_token_encrypted),
      needsReauth: Boolean(row?.todoist_needs_reauth),
      application: {
        configured: applicationConfigured,
        source,
        pendingConfigured: clientId.pendingConfigured || clientSecret.pendingConfigured,
      },
      callbackUrl,
      webhookUrl,
      deliveryMode: mode === "oauth" && applicationConfigured ? "webhook_ready" : "periodic",
    };
  }

  return { beginAuthorization, completeAuthorization, getStatus };
}

export type TodoistOAuthService = ReturnType<typeof createTodoistOAuthService>;
export const todoistOAuthService = createTodoistOAuthService();
