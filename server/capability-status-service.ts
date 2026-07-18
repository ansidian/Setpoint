import type { Client } from "@libsql/client";
import type { CapabilitySource, CapabilityStatusResponse } from "../shared/types/capabilities.ts";
import type { InstanceCredentialMetadata } from "../shared/types/instance-credentials.ts";
import db from "./db/connection.ts";
import { getActiveOwner } from "./auth/owner-context.ts";
import {
  projectCapabilityStatuses,
  type CapabilityProjectionInput,
} from "./platform/capability-projection.ts";
import {
  instanceCredentialService,
  type InstanceCredentialService,
} from "./platform/instance-credential-service.ts";

type CapabilityEvidence = Omit<CapabilityProjectionInput, "generatedAt" | "credentials" | "gmailRealtime" | "todoistAdvanced"> & {
  gmailPubSub: {
    tokenSource: CapabilitySource;
    tokenConfigured: boolean;
    lastTestedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    errorCode: string | null;
  };
};

type CredentialMetadataService = Pick<InstanceCredentialService, "getCredentialMetadata" | "subscribe">;

const CAPABILITY_CREDENTIAL_KEYS = [
  "ai.anthropic_api_key",
  "ai.openai_api_key",
  "calendar.google_places_api_key",
  "gmail.pubsub_topic",
  "google.oauth_client_id",
  "google.oauth_client_secret",
  "tasks.todoist_client_id",
  "tasks.todoist_client_secret",
  "weather.pirate_weather_api_key",
] as const;

function text(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

function sourceFor(sources: CapabilitySource[]): CapabilitySource {
  const present = [...new Set(sources.filter((source) => source !== "absent"))];
  return present.length === 0 ? "absent" : present.length === 1 ? present[0]! : "mixed";
}

export async function loadCapabilityEvidence({
  dbClient = db,
  environment = process.env,
}: {
  dbClient?: Pick<Client, "execute">;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
} = {}): Promise<CapabilityEvidence> {
  const userId = getActiveOwner()?.userId ?? environment.EA_USER_ID;
  if (!userId) throw new Error("Owner identity is unavailable");
  const [accountResult, settingsResult, actualResult, pubSubResult, todoistResult] = await Promise.all([
    dbClient.execute({
      sql: "SELECT type, needs_reauth FROM ea_accounts WHERE user_id = ?",
      args: [userId],
    }),
    dbClient.execute({
      sql: `SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id,
                   discord_webhook_url_encrypted, todoist_api_token_encrypted,
                   todoist_oauth_refresh_token_encrypted, todoist_connection_mode,
                   todoist_needs_reauth, weather_lat, weather_lng
            FROM ea_settings WHERE user_id = ?`,
      args: [userId],
    }),
    dbClient.execute({
      sql: `SELECT status, last_success_at, last_attempt_at
            FROM ea_actual_metadata_mirror WHERE user_id = ?`,
      args: [userId],
    }),
    dbClient.execute({
      sql: `SELECT push_token_hash, token_disabled, last_tested_at,
                   last_succeeded_at, last_failed_at, error_code
            FROM ea_gmail_pubsub_config WHERE singleton_id = 1`,
      args: [],
    }),
    dbClient.execute({
      sql: `SELECT status, last_success_at, last_check_failed_at
            FROM ea_todoist_sync_state WHERE user_id = ?`,
      args: [userId],
    }),
  ]);
  const settings = (settingsResult.rows[0] ?? {}) as Record<string, unknown>;
  const actual = actualResult.rows[0];
  const pubSub = pubSubResult.rows[0];
  const todoist = todoistResult.rows[0];
  const todoistConfigured = Boolean(settings.todoist_api_token_encrypted);
  const storedMode = settings.todoist_connection_mode;
  const todoistMode = storedMode === "oauth" || storedMode === "personal_token"
    ? storedMode
    : todoistConfigured
      ? settings.todoist_oauth_refresh_token_encrypted ? "oauth" : "personal_token"
      : "disconnected";
  const tokenSource: CapabilitySource = pubSub?.push_token_hash
    ? "stored"
    : Number(pubSub?.token_disabled) === 1
      ? "disabled"
      : environment.GMAIL_PUBSUB_PUSH_TOKEN
        ? "environment"
        : "absent";
  return {
    accounts: accountResult.rows.map((row) => ({
      type: String(row.type),
      needsReauth: Boolean(row.needs_reauth),
    })),
    settings: {
      actualConfigured: Boolean(
        settings.actual_budget_url
        && settings.actual_budget_password_encrypted
        && settings.actual_budget_sync_id
      ),
      discordConfigured: Boolean(settings.discord_webhook_url_encrypted),
      todoistConfigured,
      todoistMode,
      todoistNeedsReauth: Boolean(settings.todoist_needs_reauth),
      weatherLocationConfigured: settings.weather_lat != null && settings.weather_lng != null,
    },
    actual: actual ? {
      status: String(actual.status ?? "needs_sync"),
      lastSucceededAt: text(actual.last_success_at),
      lastFailedAt: String(actual.status ?? "") === "current" ? null : text(actual.last_attempt_at),
    } : null,
    todoist: todoist ? {
      status: String(todoist.status ?? "idle"),
      lastSucceededAt: text(todoist.last_success_at),
      lastFailedAt: text(todoist.last_check_failed_at),
    } : null,
    gmailPubSub: {
      tokenSource,
      tokenConfigured: tokenSource === "stored" || tokenSource === "environment",
      lastTestedAt: pubSub?.last_tested_at == null ? null : new Date(Number(pubSub.last_tested_at)).toISOString(),
      lastSucceededAt: pubSub?.last_succeeded_at == null ? null : new Date(Number(pubSub.last_succeeded_at)).toISOString(),
      lastFailedAt: pubSub?.last_failed_at == null ? null : new Date(Number(pubSub.last_failed_at)).toISOString(),
      errorCode: text(pubSub?.error_code),
    },
  };
}

export function createCapabilityStatusService({
  credentialService = instanceCredentialService,
  loadEvidence = loadCapabilityEvidence,
  now = Date.now,
  cacheTtlMs = 5_000,
}: {
  credentialService?: CredentialMetadataService;
  loadEvidence?: () => Promise<CapabilityEvidence>;
  now?: () => number;
  cacheTtlMs?: number;
} = {}) {
  let cached: { expiresAt: number; response: CapabilityStatusResponse } | null = null;
  let inflight: Promise<CapabilityStatusResponse> | null = null;

  function invalidate(): void {
    cached = null;
  }

  credentialService.subscribe(invalidate);

  async function build(): Promise<CapabilityStatusResponse> {
    const [credentials, evidence]: [InstanceCredentialMetadata[], CapabilityEvidence] = await Promise.all([
      Promise.all(CAPABILITY_CREDENTIAL_KEYS.map((key) => credentialService.getCredentialMetadata(key))),
      loadEvidence(),
    ]);
    const byKey = new Map(credentials.map((credential) => [credential.key, credential]));
    const topic = byKey.get("gmail.pubsub_topic");
    const todoistClientId = byKey.get("tasks.todoist_client_id");
    const todoistClientSecret = byKey.get("tasks.todoist_client_secret");
    const gmailSource = sourceFor([topic?.source ?? "absent", evidence.gmailPubSub.tokenSource]);
    const todoistSources: CapabilitySource[] = [todoistClientId?.source, todoistClientSecret?.source]
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    return projectCapabilityStatuses({
      generatedAt: new Date(now()).toISOString(),
      credentials,
      accounts: evidence.accounts,
      settings: evidence.settings,
      actual: evidence.actual,
      todoist: evidence.todoist,
      gmailRealtime: {
        configured: Boolean(topic?.activeConfigured) && evidence.gmailPubSub.tokenConfigured,
        source: gmailSource,
        lastTestedAt: evidence.gmailPubSub.lastTestedAt,
        lastSucceededAt: evidence.gmailPubSub.lastSucceededAt,
        lastFailedAt: evidence.gmailPubSub.lastFailedAt,
        errorCode: evidence.gmailPubSub.errorCode,
      },
      todoistAdvanced: {
        applicationConfigured: Boolean(todoistClientId?.activeConfigured && todoistClientSecret?.activeConfigured),
        pendingConfigured: Boolean(todoistClientId?.pendingConfigured || todoistClientSecret?.pendingConfigured),
        source: sourceFor(todoistSources),
        deliveryMode: evidence.settings.todoistMode === "oauth" ? "webhook_ready" : "periodic",
      },
    });
  }

  async function getStatus({ refresh = false }: { refresh?: boolean } = {}): Promise<CapabilityStatusResponse> {
    const currentTime = now();
    if (!refresh && cached && cached.expiresAt > currentTime) return cached.response;
    if (!refresh && inflight) return inflight;
    const request = build().then((response) => {
      cached = { response, expiresAt: now() + cacheTtlMs };
      return response;
    }).finally(() => {
      if (inflight === request) inflight = null;
    });
    if (!refresh) inflight = request;
    return request;
  }

  return { getStatus, invalidate };
}

export type CapabilityStatusService = ReturnType<typeof createCapabilityStatusService>;
export const capabilityStatusService = createCapabilityStatusService();
