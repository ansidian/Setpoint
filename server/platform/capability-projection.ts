import type {
  CapabilityActionId,
  CapabilityReasonCode,
  CapabilitySource,
  CapabilityState,
  CapabilityStatus,
  CapabilityStatusResponse,
} from "../../shared/types/capabilities.ts";
import type { InstanceCredentialMetadata } from "../../shared/types/instance-credentials.ts";

export interface CapabilityProjectionInput {
  generatedAt: string;
  credentials: InstanceCredentialMetadata[];
  accounts: Array<{ type: string; needsReauth: boolean }>;
  settings: {
    actualConfigured: boolean;
    discordConfigured: boolean;
    todoistConfigured: boolean;
    todoistMode: "disconnected" | "personal_token" | "oauth";
    todoistNeedsReauth: boolean;
    weatherLocationConfigured: boolean;
  };
  actual: { status: string; lastSucceededAt: string | null; lastFailedAt: string | null } | null;
  todoist: { status: string; lastSucceededAt: string | null; lastFailedAt: string | null } | null;
  gmailRealtime: {
    configured: boolean;
    source: CapabilitySource;
    lastTestedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    errorCode: string | null;
  } | null;
  todoistAdvanced: {
    applicationConfigured: boolean;
    pendingConfigured: boolean;
    source: CapabilitySource;
    deliveryMode: string;
  } | null;
}

type StatusFields = Omit<CapabilityStatus, "id" | "guidanceRef">;

const EMPTY_TIMES = {
  lastTestedAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
} as const;

function status(
  id: CapabilityStatus["id"],
  fields: Partial<StatusFields> & Pick<StatusFields, "state">,
): CapabilityStatus {
  return {
    id,
    source: "absent",
    mode: null,
    reasonCodes: [],
    availableActions: ["configure"],
    guidanceRef: `setup.${id}`,
    ...EMPTY_TIMES,
    ...fields,
  };
}

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function latest(values: Array<number | null>): string | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? timestamp(Math.max(...present)) : null;
}

function combinedSource(credentials: InstanceCredentialMetadata[]): CapabilitySource {
  const sources = [...new Set(credentials.filter(({ activeConfigured, source }) => activeConfigured || source === "disabled").map(({ source }) => source))];
  if (!sources.length) return "absent";
  return sources.length === 1 ? sources[0]! : "mixed";
}

function credentialStatus(
  id: CapabilityStatus["id"],
  credentials: InstanceCredentialMetadata[],
  { requiresLocation = false, locationConfigured = true }: { requiresLocation?: boolean; locationConfigured?: boolean } = {},
): CapabilityStatus {
  const active = credentials.filter(({ activeConfigured }) => activeConfigured);
  const invalid = active.filter(({ validationState }) => validationState === "invalid");
  const valid = active.filter(({ validationState, pendingConfigured }) => validationState !== "invalid" || pendingConfigured);
  const pending = credentials.some(({ pendingConfigured }) => pendingConfigured);
  const allDisabled = credentials.length > 0 && credentials.every(({ source }) => source === "disabled");
  let state: CapabilityState = "not_configured";
  const reasonCodes: CapabilityReasonCode[] = [];
  if (allDisabled) state = "disabled";
  else if (valid.length && (!requiresLocation || locationConfigured)) state = invalid.length || pending ? "degraded" : "ready";
  else if (invalid.length) state = "needs_attention";
  else if (pending) state = "pending";
  if (invalid.length) reasonCodes.push("CREDENTIAL_INVALID");
  return status(id, {
    state,
    source: combinedSource(credentials),
    mode: active.length ? active.map(({ key }) => key.split(".")[1]).sort().join("+") : null,
    reasonCodes,
    availableActions: state === "not_configured"
      ? ["configure"]
      : state === "disabled"
        ? ["configure"]
        : ["manage", "test", "disable", ...(credentials.some(({ source }) => source === "environment") ? ["migrate_environment" as CapabilityActionId] : [])],
    lastTestedAt: latest(credentials.map(({ lastTestedAt }) => lastTestedAt)),
    lastSucceededAt: latest(credentials.map(({ lastSucceededAt }) => lastSucceededAt)),
    lastFailedAt: latest(credentials.map(({ lastFailedAt }) => lastFailedAt)),
  });
}

export function projectCapabilityStatuses(input: CapabilityProjectionInput): CapabilityStatusResponse {
  const credentialByKey = new Map(input.credentials.map((credential) => [credential.key, credential]));
  const credentials = (...keys: string[]) => keys.flatMap((key) => credentialByKey.get(key) ?? []);

  const gmail = input.accounts.filter(({ type }) => type === "gmail");
  const icloud = input.accounts.filter(({ type }) => type === "icloud");
  const healthyGmail = gmail.some(({ needsReauth }) => !needsReauth);
  const healthyIcloud = icloud.some(({ needsReauth }) => !needsReauth);
  const accountReauth = input.accounts.some(({ needsReauth }) => needsReauth);
  const accountReasons: CapabilityReasonCode[] = [];
  const googleAppCredentials = credentials("google.oauth_client_id", "google.oauth_client_secret");
  const googleAppReady = googleAppCredentials.length === 2 && googleAppCredentials.every(({ activeConfigured }) => activeConfigured);
  const googleAppPending = googleAppCredentials.some(({ pendingConfigured }) => pendingConfigured);
  const googleAppUsesEnvironment = googleAppCredentials.some(({ source }) => source === "environment");
  if (accountReauth) accountReasons.push("ACCOUNT_REAUTH_REQUIRED");
  if (!healthyGmail && healthyIcloud) accountReasons.push("CALENDAR_NOT_CONNECTED");
  if (gmail.length && !googleAppReady) accountReasons.push("APPLICATION_CREDENTIALS_MISSING");
  const accountSource = input.accounts.length ? "account" : "absent";
  const emailCalendar = status("email_calendar", {
    state: healthyGmail && !accountReauth && googleAppReady
      ? "ready"
      : healthyGmail || healthyIcloud
        ? "degraded"
        : input.accounts.length
          ? "needs_attention"
          : googleAppPending
            ? "pending"
          : "not_configured",
    source: sourceForProjection(accountSource, combinedSource(googleAppCredentials)),
    mode: healthyGmail ? "gmail_calendar" : healthyIcloud ? "email_only" : googleAppReady ? "google_oauth_ready" : null,
    reasonCodes: accountReasons,
    availableActions: [
      ...(input.accounts.length ? ["manage" as const] : ["connect" as const]),
      ...(accountReauth ? ["reconnect" as const] : []),
      ...(googleAppUsesEnvironment ? ["migrate_environment" as const] : []),
    ],
  });

  const aiCredentials = credentials("ai.openai_api_key", "ai.anthropic_api_key");
  const ai = credentialStatus("ai", aiCredentials);
  ai.mode = aiCredentials
    .filter(({ activeConfigured, validationState, pendingConfigured }) => activeConfigured && (validationState !== "invalid" || pendingConfigured))
    .map(({ key }) => key.includes("openai") ? "openai" : "anthropic")
    .sort()
    .join("+") || null;
  const aiInvalid = aiCredentials.some(({ activeConfigured, validationState }) => activeConfigured && validationState === "invalid");
  const aiUsableCount = aiCredentials.filter(({ activeConfigured, validationState, pendingConfigured }) => (
    activeConfigured && (validationState !== "invalid" || pendingConfigured)
  )).length;
  if (aiUsableCount === 1) {
    ai.state = "degraded";
    ai.reasonCodes.unshift("AI_PROVIDER_PARTIAL");
  } else if (aiInvalid && aiUsableCount > 0) {
    ai.reasonCodes.unshift("AI_PROVIDER_PARTIAL");
  }

  const todoistFailed = Boolean(input.todoist?.lastFailedAt) || Boolean(input.todoist && input.todoist.status === "failed");
  const tasks = status("tasks", {
    state: input.settings.todoistNeedsReauth
      ? "needs_attention"
      : input.settings.todoistConfigured
        ? todoistFailed && input.todoist?.lastSucceededAt
          ? "degraded"
          : todoistFailed
            ? "needs_attention"
            : "ready"
        : "not_configured",
    source: input.settings.todoistConfigured ? "settings" : "absent",
    mode: input.settings.todoistMode,
    reasonCodes: input.settings.todoistNeedsReauth ? ["TODOIST_REAUTH_REQUIRED"] : todoistFailed ? ["OPERATION_FAILED"] : [],
    availableActions: input.settings.todoistConfigured ? ["manage", ...(input.settings.todoistNeedsReauth ? ["reconnect" as const] : [])] : ["connect"],
    lastSucceededAt: input.todoist?.lastSucceededAt ?? null,
    lastFailedAt: input.todoist?.lastFailedAt ?? null,
  });

  const weather = credentialStatus(
    "weather",
    credentials("weather.pirate_weather_api_key"),
    { requiresLocation: true, locationConfigured: input.settings.weatherLocationConfigured },
  );
  if (weather.mode) weather.mode = "pirate_weather";

  const actualFailed = Boolean(input.actual?.lastFailedAt) || Boolean(input.actual && !["current", "ready"].includes(input.actual.status));
  const finances = status("finances", {
    state: !input.settings.actualConfigured
      ? "not_configured"
      : !input.actual
        ? "pending"
      : actualFailed && input.actual?.lastSucceededAt
        ? "degraded"
        : actualFailed
          ? "needs_attention"
          : "ready",
    source: input.settings.actualConfigured ? "settings" : "absent",
    mode: input.settings.actualConfigured ? "actual_budget" : null,
    reasonCodes: actualFailed ? ["OPERATION_FAILED"] : [],
    availableActions: input.settings.actualConfigured ? ["manage", "test"] : ["configure"],
    lastSucceededAt: input.actual?.lastSucceededAt ?? null,
    lastFailedAt: input.actual?.lastFailedAt ?? null,
  });

  const notifications = status("notifications", {
    state: input.settings.discordConfigured ? "ready" : "not_configured",
    source: input.settings.discordConfigured ? "settings" : "absent",
    mode: input.settings.discordConfigured ? "discord" : null,
    availableActions: input.settings.discordConfigured ? ["manage", "test"] : ["configure"],
  });

  const realtime = input.gmailRealtime;
  const gmailRealtime = status("gmail_realtime", {
    state: !realtime?.configured
      ? realtime?.source === "disabled" ? "disabled" : "not_configured"
      : realtime.errorCode ? "degraded" : "ready",
    source: realtime?.source ?? "absent",
    mode: realtime?.configured ? "push_and_periodic" : "periodic",
    reasonCodes: realtime?.errorCode ? ["GMAIL_WATCH_TEST_FAILED"] : [],
    availableActions: [
      ...(realtime?.configured ? ["manage" as const, "test" as const, "disable" as const] : ["configure" as const]),
      ...(realtime?.source === "environment" || realtime?.source === "mixed" ? ["migrate_environment" as const] : []),
    ],
    lastTestedAt: realtime?.lastTestedAt ?? null,
    lastSucceededAt: realtime?.lastSucceededAt ?? null,
    lastFailedAt: realtime?.lastFailedAt ?? null,
  });

  const advanced = input.todoistAdvanced;
  const todoistAdvanced = status("todoist_advanced", {
    state: advanced?.applicationConfigured && input.settings.todoistMode === "oauth"
      ? input.settings.todoistNeedsReauth ? "needs_attention" : "ready"
      : advanced?.pendingConfigured
        ? "pending"
        : advanced?.source === "disabled"
          ? "disabled"
          : "not_configured",
    source: advanced?.source ?? "absent",
    mode: advanced?.deliveryMode ?? "periodic",
    reasonCodes: input.settings.todoistNeedsReauth && input.settings.todoistMode === "oauth" ? ["TODOIST_REAUTH_REQUIRED"] : [],
    availableActions: [
      ...(advanced?.applicationConfigured ? ["manage" as const, "reconnect" as const] : ["configure" as const]),
      ...(advanced?.source === "environment" || advanced?.source === "mixed" ? ["migrate_environment" as const] : []),
    ],
  });

  const places = credentialStatus("calendar_places", credentials("calendar.google_places_api_key"));
  if (places.mode) places.mode = "google_places";

  return {
    generatedAt: input.generatedAt,
    capabilities: [emailCalendar, ai, tasks, weather, finances, notifications, gmailRealtime, todoistAdvanced, places],
  };
}

function sourceForProjection(left: CapabilitySource, right: CapabilitySource): CapabilitySource {
  if (left === "absent") return right;
  if (right === "absent" || left === right) return left;
  return "mixed";
}
