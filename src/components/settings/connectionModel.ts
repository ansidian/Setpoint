export type ConnectionId =
  | "google-workspace"
  | "icloud-mail"
  | "todoist"
  | "actual-budget"
  | "openai"
  | "anthropic"
  | "discord-reminders"
  | "pirate-weather"
  | "google-places";

export type ConnectionGroupId = "data_sources" | "ai_providers" | "supporting_services";

export interface ConnectionGroupDefinition {
  id: ConnectionGroupId;
  label: string;
}

export interface ConnectionDefinition {
  id: ConnectionId;
  group: ConnectionGroupId;
  label: string;
  description: string;
  minimumViable: string;
  hash: ConnectionId;
}

export type ConnectionState = "connected" | "needs_setup" | "needs_attention" | "not_connected";

const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  connected: "Connected",
  needs_setup: "Needs setup",
  needs_attention: "Needs attention",
  not_connected: "Not connected",
};

function connectionStateLabel(state: ConnectionState | null): string {
  return state === null ? "Status unavailable" : CONNECTION_STATE_LABELS[state];
}

export interface ConnectionRowView extends ConnectionDefinition {
  state: ConnectionState | null;
  statusLabel: string;
  source: CapabilitySource | null;
  mode: string | null;
  identities: string[];
  lastTestedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
}

export interface ConnectionProjectionInput {
  accounts: AccountSummary[];
  settings: Partial<SettingsResponse> | null;
  capabilities: CapabilityStatus[];
  credentialMetadata: InstanceCredentialMetadata[] | null;
}

export const CONNECTION_GROUPS = [
  { id: "data_sources", label: "Data sources" },
  { id: "ai_providers", label: "AI providers" },
  { id: "supporting_services", label: "Supporting services" },
] as const satisfies readonly ConnectionGroupDefinition[];

export const CONNECTIONS = [
  {
    id: "google-workspace",
    group: "data_sources",
    label: "Google Workspace",
    description: "Gmail and Google Calendar accounts.",
    minimumViable: "Application credentials and a healthy Google authorization",
    hash: "google-workspace",
  },
  {
    id: "icloud-mail",
    group: "data_sources",
    label: "iCloud Mail",
    description: "iCloud email accounts.",
    minimumViable: "At least one healthy iCloud account",
    hash: "icloud-mail",
  },
  {
    id: "todoist",
    group: "data_sources",
    label: "Todoist",
    description: "Deadlines and task synchronization.",
    minimumViable: "A healthy personal token or OAuth connection",
    hash: "todoist",
  },
  {
    id: "actual-budget",
    group: "data_sources",
    label: "Actual Budget",
    description: "Budget metadata, bills, and transactions.",
    minimumViable: "URL, password, sync ID, and usable health evidence",
    hash: "actual-budget",
  },
  {
    id: "openai",
    group: "ai_providers",
    label: "OpenAI",
    description: "AI triage, extraction, search, and configured fallbacks.",
    minimumViable: "An active OpenAI key that is not invalid",
    hash: "openai",
  },
  {
    id: "anthropic",
    group: "ai_providers",
    label: "Anthropic",
    description: "AI triage, extraction, Alfred, and configured fallbacks.",
    minimumViable: "An active Anthropic key that is not invalid",
    hash: "anthropic",
  },
  {
    id: "discord-reminders",
    group: "supporting_services",
    label: "Discord Reminders",
    description: "Private reminder delivery through Discord.",
    minimumViable: "A configured Discord webhook",
    hash: "discord-reminders",
  },
  {
    id: "pirate-weather",
    group: "supporting_services",
    label: "Pirate Weather",
    description: "Dashboard forecasts for the saved location.",
    minimumViable: "An active key and saved weather location",
    hash: "pirate-weather",
  },
  {
    id: "google-places",
    group: "supporting_services",
    label: "Google Places",
    description: "Optional Calendar place suggestions and details.",
    minimumViable: "An active Google Places key that is not invalid",
    hash: "google-places",
  },
] as const satisfies readonly ConnectionDefinition[];

const GOOGLE_CREDENTIAL_KEYS = ["google.oauth_client_id", "google.oauth_client_secret"] as const;

function credentialIsUsable(metadata: InstanceCredentialMetadata): boolean {
  return metadata.activeConfigured
    && (metadata.validationState !== "invalid" || metadata.pendingConfigured);
}

function sourceForCredentials(credentials: InstanceCredentialMetadata[]): CapabilitySource {
  const sources = [...new Set(credentials.map(({ source }) => source).filter((source) => source !== "absent"))];
  return sources.length === 0 ? "absent" : sources.length === 1 ? sources[0]! : "mixed";
}

function metadataTimestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function latestMetadataTimestamp(
  credentials: InstanceCredentialMetadata[],
  field: "lastTestedAt" | "lastSucceededAt" | "lastFailedAt",
): string | null {
  const values = credentials
    .map((metadata) => metadata[field])
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? new Date(Math.max(...values)).toISOString() : null;
}

function applyCredentialRow(
  row: ConnectionRowView,
  metadata: InstanceCredentialMetadata | undefined,
  mode: string,
): void {
  row.mode = mode;
  if (!metadata) {
    row.state = "not_connected";
    row.source = "absent";
    return;
  }
  row.source = metadata.source;
  row.lastTestedAt = metadataTimestamp(metadata.lastTestedAt);
  row.lastSucceededAt = metadataTimestamp(metadata.lastSucceededAt);
  row.lastFailedAt = metadataTimestamp(metadata.lastFailedAt);
  row.state = credentialIsUsable(metadata)
    ? "connected"
    : metadata.activeConfigured && metadata.validationState === "invalid"
      ? "needs_attention"
      : metadata.pendingConfigured
        ? "needs_setup"
        : "not_connected";
}

function emptyRow(definition: ConnectionDefinition): ConnectionRowView {
  return {
    ...definition,
    state: "not_connected",
    statusLabel: connectionStateLabel("not_connected"),
    source: "absent",
    mode: null,
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

function applyCapabilityEvidence(row: ConnectionRowView, capability: CapabilityStatus | undefined): void {
  if (!capability) return;
  row.source = capability.source;
  row.mode = capability.mode;
  row.lastTestedAt = capability.lastTestedAt;
  row.lastSucceededAt = capability.lastSucceededAt;
  row.lastFailedAt = capability.lastFailedAt;
}

export function projectConnectionRows(input: ConnectionProjectionInput): ConnectionRowView[] {
  const rows = CONNECTIONS.map((definition) => emptyRow(definition));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const credentials = input.credentialMetadata === null
    ? null
    : new Map(input.credentialMetadata.map((metadata) => [metadata.key, metadata]));
  const capabilities = new Map(input.capabilities.map((capability) => [capability.id, capability]));
  const gmailAccounts = input.accounts.filter(({ type }) => type === "gmail");
  const icloudAccounts = input.accounts.filter(({ type }) => type === "icloud");

  const googleRow = rowById.get("google-workspace")!;
  googleRow.identities = gmailAccounts.map(({ email }) => email);
  googleRow.mode = "google_oauth";
  if (credentials === null) {
    googleRow.state = null;
    googleRow.source = null;
  } else {
    const googleCredentials = GOOGLE_CREDENTIAL_KEYS.flatMap((key) => credentials.get(key) ?? []);
    const applicationReady = googleCredentials.length === GOOGLE_CREDENTIAL_KEYS.length
      && googleCredentials.every(credentialIsUsable);
    const applicationStarted = googleCredentials.some(({ activeConfigured, pendingConfigured }) => activeConfigured || pendingConfigured);
    const healthyAccount = gmailAccounts.some(({ needs_reauth }) => !needs_reauth);
    const accountNeedsAttention = gmailAccounts.some(({ needs_reauth }) => needs_reauth);
    googleRow.source = sourceForCredentials(googleCredentials);
    googleRow.lastTestedAt = latestMetadataTimestamp(googleCredentials, "lastTestedAt");
    googleRow.lastSucceededAt = latestMetadataTimestamp(googleCredentials, "lastSucceededAt");
    googleRow.lastFailedAt = latestMetadataTimestamp(googleCredentials, "lastFailedAt");
    googleRow.state = applicationReady && healthyAccount
      ? "connected"
      : gmailAccounts.length > 0 && (accountNeedsAttention || !applicationReady)
        ? "needs_attention"
        : applicationStarted
          ? "needs_setup"
          : "not_connected";
    const gmailRealtime = capabilities.get("gmail_realtime");
    const realtimeWasEnabled = gmailRealtime
      && gmailRealtime.source !== "absent"
      && gmailRealtime.source !== "disabled";
    if (
      googleRow.state === "connected"
      && realtimeWasEnabled
      && (gmailRealtime.state === "degraded" || gmailRealtime.state === "needs_attention")
    ) {
      googleRow.state = "needs_attention";
      googleRow.lastTestedAt = gmailRealtime.lastTestedAt ?? googleRow.lastTestedAt;
      googleRow.lastSucceededAt = gmailRealtime.lastSucceededAt ?? googleRow.lastSucceededAt;
      googleRow.lastFailedAt = gmailRealtime.lastFailedAt ?? googleRow.lastFailedAt;
    }
  }

  const icloudRow = rowById.get("icloud-mail")!;
  icloudRow.identities = icloudAccounts.map(({ email }) => email);
  icloudRow.source = icloudAccounts.length ? "account" : "absent";
  icloudRow.mode = icloudAccounts.length ? "app_password" : null;
  icloudRow.state = icloudAccounts.some(({ needs_reauth }) => !needs_reauth)
    ? "connected"
    : icloudAccounts.length
      ? "needs_attention"
      : "not_connected";

  const openAiRow = rowById.get("openai")!;
  const anthropicRow = rowById.get("anthropic")!;
  if (credentials === null) {
    openAiRow.state = null;
    openAiRow.source = null;
    anthropicRow.state = null;
    anthropicRow.source = null;
  } else {
    applyCredentialRow(openAiRow, credentials.get("ai.openai_api_key"), "api_key");
    applyCredentialRow(anthropicRow, credentials.get("ai.anthropic_api_key"), "api_key");
  }

  const todoistRow = rowById.get("todoist")!;
  const todoistCapability = capabilities.get("tasks");
  const todoistAdvanced = capabilities.get("todoist_advanced");
  const todoistConfigured = Boolean(input.settings?.todoist_configured);
  const todoistMode = input.settings?.todoist_connection_mode ?? "disconnected";
  applyCapabilityEvidence(todoistRow, todoistCapability);
  todoistRow.mode = todoistMode;
  todoistRow.source = todoistCapability?.source ?? (todoistConfigured ? "settings" : "absent");
  const todoistBroken = Boolean(input.settings?.todoist_needs_reauth)
    || todoistCapability?.state === "degraded"
    || todoistCapability?.state === "needs_attention"
    || (todoistMode === "oauth" && (todoistAdvanced?.state === "degraded" || todoistAdvanced?.state === "needs_attention"));
  todoistRow.state = todoistConfigured
    ? todoistBroken
      ? "needs_attention"
      : todoistCapability?.state === "ready"
        ? "connected"
        : "needs_setup"
    : todoistAdvanced?.state === "pending"
      ? "needs_setup"
      : "not_connected";

  const actualRow = rowById.get("actual-budget")!;
  const actualCapability = capabilities.get("finances");
  const actualConfigured = Boolean(input.settings?.actual_budget_configured);
  const actualStarted = actualConfigured
    || Boolean(input.settings?.actual_budget_url)
    || Boolean(input.settings?.actual_budget_sync_id);
  applyCapabilityEvidence(actualRow, actualCapability);
  actualRow.mode = "actual_budget";
  actualRow.source = actualCapability?.source ?? (actualStarted ? "settings" : "absent");
  actualRow.state = actualConfigured
    ? actualCapability?.state === "ready"
      ? "connected"
      : actualCapability?.state === "degraded" || actualCapability?.state === "needs_attention"
        ? "needs_attention"
        : "needs_setup"
    : actualStarted
      ? "needs_setup"
      : "not_connected";

  const discordRow = rowById.get("discord-reminders")!;
  const discordCapability = capabilities.get("notifications");
  const discordConfigured = Boolean(input.settings?.discord_webhook_configured);
  applyCapabilityEvidence(discordRow, discordCapability);
  discordRow.mode = "webhook";
  discordRow.source = discordCapability?.source ?? (discordConfigured ? "settings" : "absent");
  discordRow.state = discordConfigured ? "connected" : "not_connected";

  const weatherRow = rowById.get("pirate-weather")!;
  const weatherLocationConfigured = input.settings?.weather_lat != null
    && input.settings?.weather_lng != null;
  if (credentials === null) {
    weatherRow.state = null;
    weatherRow.source = null;
  } else {
    const weatherCredential = credentials.get("weather.pirate_weather_api_key");
    applyCredentialRow(weatherRow, weatherCredential, "api_key");
    if (weatherRow.state === "connected" && !weatherLocationConfigured) {
      weatherRow.state = "needs_setup";
    } else if (
      weatherRow.state === "not_connected"
      && weatherLocationConfigured
      && weatherCredential?.source !== "disabled"
    ) {
      weatherRow.state = "needs_setup";
    }
  }

  const placesRow = rowById.get("google-places")!;
  if (credentials === null) {
    placesRow.state = null;
    placesRow.source = null;
  } else {
    applyCredentialRow(placesRow, credentials.get("calendar.google_places_api_key"), "api_key");
  }

  return rows.map((row) => ({ ...row, statusLabel: connectionStateLabel(row.state) }));
}
import type { AccountSummary } from "../../../shared/types/accounts";
import type { CapabilityStatus, CapabilitySource } from "../../../shared/types/capabilities";
import type { InstanceCredentialMetadata } from "../../../shared/types/instance-credentials";
import type { SettingsResponse } from "../../../shared/types/settings";
