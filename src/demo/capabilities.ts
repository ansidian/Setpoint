import type { CapabilityStatusResponse } from "../../shared/types/capabilities.ts";
import type { InstanceCredentialMetadataResponse } from "../../shared/types/instance-credentials.ts";

export function getDemoCapabilityStatus(): CapabilityStatusResponse {
  const base = {
    source: "absent" as const,
    mode: null,
    reasonCodes: [],
    availableActions: ["configure" as const],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
  return {
    generatedAt: "2026-05-12T16:00:00.000Z",
    capabilities: [
      { ...base, id: "email_calendar", state: "ready", source: "account", mode: "gmail_calendar", availableActions: ["manage"], guidanceRef: "setup.email_calendar" },
      { ...base, id: "ai", state: "ready", source: "stored", mode: "openai", availableActions: ["manage", "test", "disable"], guidanceRef: "setup.ai" },
      { ...base, id: "tasks", state: "ready", source: "settings", mode: "personal_token", availableActions: ["manage"], guidanceRef: "setup.tasks" },
      { ...base, id: "weather", state: "ready", source: "stored", mode: "pirate_weather", availableActions: ["manage", "test", "disable"], guidanceRef: "setup.weather" },
      { ...base, id: "finances", state: "ready", source: "settings", mode: "actual_budget", availableActions: ["manage", "test"], guidanceRef: "setup.finances" },
      { ...base, id: "notifications", state: "ready", source: "settings", mode: "discord", availableActions: ["manage", "test"], guidanceRef: "setup.notifications" },
      { ...base, id: "gmail_realtime", state: "not_configured", mode: "periodic", guidanceRef: "setup.gmail_realtime" },
      { ...base, id: "todoist_advanced", state: "not_configured", mode: "periodic", guidanceRef: "setup.todoist_advanced" },
      { ...base, id: "calendar_places", state: "not_configured", guidanceRef: "setup.calendar_places" },
    ],
  };
}

export function getDemoInstanceCredentialMetadata(): InstanceCredentialMetadataResponse {
  const activeKeys = new Set([
    "ai.openai_api_key",
    "google.oauth_client_id",
    "google.oauth_client_secret",
    "weather.pirate_weather_api_key",
  ]);
  const nonSecretKeys = new Set([
    "gmail.pubsub_topic",
    "google.oauth_client_id",
    "tasks.todoist_client_id",
  ]);
  const keys = [
    "ai.anthropic_api_key",
    "ai.openai_api_key",
    "calendar.google_places_api_key",
    "gmail.pubsub_topic",
    "google.oauth_client_id",
    "google.oauth_client_secret",
    "tasks.todoist_client_id",
    "tasks.todoist_client_secret",
    "weather.pirate_weather_api_key",
  ];
  return {
    credentials: keys.map((key) => {
      const activeConfigured = activeKeys.has(key);
      return {
        key,
        handling: nonSecretKeys.has(key) ? "non_secret" as const : "secret" as const,
        capabilities: [],
        source: activeConfigured ? "stored" as const : "absent" as const,
        activeConfigured,
        pendingConfigured: false,
        pendingStagedAt: null,
        pendingExpiresAt: null,
        validationState: activeConfigured ? "valid" as const : "untested" as const,
        lastTestedAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        errorCode: null,
        version: activeConfigured ? 1 : null,
      };
    }),
    rootKey: {
      configured: true,
      valid: true,
      fingerprint: "demo-fictional",
      decryptability: "ok",
    },
  };
}
