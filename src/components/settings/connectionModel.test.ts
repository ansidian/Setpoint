import { describe, expect, it } from "vitest";
import {
  CONNECTION_GROUPS,
  CONNECTIONS,
  projectConnectionRows,
} from "./connectionModel";
import type { AccountSummary } from "../../../shared/types/accounts";
import type { CapabilityStatus } from "../../../shared/types/capabilities";
import type { InstanceCredentialMetadata } from "../../../shared/types/instance-credentials";

function account(type: "gmail" | "icloud", needsReauth = false): AccountSummary {
  return {
    id: `${type}-1`,
    type,
    email: `${type}@example.test`,
    label: type,
    color: null,
    icon: null,
    calendar_enabled: 1,
    sort_order: 0,
    created_at: "2026-07-19T00:00:00.000Z",
    needs_reauth: needsReauth,
  };
}

function credential(key: string, overrides: Partial<InstanceCredentialMetadata> = {}): InstanceCredentialMetadata {
  return {
    key,
    handling: "secret",
    capabilities: [],
    source: "absent",
    activeConfigured: false,
    pendingConfigured: false,
    validationState: "untested",
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: null,
    ...overrides,
  };
}

function capability(id: CapabilityStatus["id"], state: CapabilityStatus["state"], overrides: Partial<CapabilityStatus> = {}): CapabilityStatus {
  return {
    id,
    state,
    source: "absent",
    mode: null,
    reasonCodes: [],
    availableActions: [],
    guidanceRef: `setup.${id}`,
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    ...overrides,
  };
}

const googleCredentials = [
  credential("google.oauth_client_id", { source: "stored", activeConfigured: true, validationState: "valid" }),
  credential("google.oauth_client_secret", { source: "stored", activeConfigured: true, validationState: "valid" }),
];

describe("connectionModel definitions", () => {
  it("keeps the nine services in the parent-locked groups and order", () => {
    expect(CONNECTION_GROUPS).toEqual([
      { id: "data_sources", label: "Data sources" },
      { id: "ai_providers", label: "AI providers" },
      { id: "supporting_services", label: "Supporting services" },
    ]);
    expect(CONNECTIONS.map(({ id, group }) => [group, id])).toEqual([
      ["data_sources", "google-workspace"],
      ["data_sources", "icloud-mail"],
      ["data_sources", "todoist"],
      ["data_sources", "actual-budget"],
      ["ai_providers", "openai"],
      ["ai_providers", "anthropic"],
      ["supporting_services", "discord-reminders"],
      ["supporting_services", "pirate-weather"],
      ["supporting_services", "google-places"],
    ]);
    expect(CONNECTIONS.map(({ hash }) => hash)).toEqual(CONNECTIONS.map(({ id }) => id));
    expect(CONNECTIONS.map(({ minimumViable }) => minimumViable)).toEqual([
      "Application credentials and a healthy Google authorization",
      "At least one healthy iCloud account",
      "A healthy personal token or OAuth connection",
      "URL, password, sync ID, and usable health evidence",
      "An active OpenAI key that is not invalid",
      "An active Anthropic key that is not invalid",
      "A configured Discord webhook",
      "An active key and saved weather location",
      "An active Google Places key that is not invalid",
    ]);
  });
});

describe("projectConnectionRows", () => {
  it("separates healthy Google Workspace from an iCloud account that needs reauthorization", () => {
    const rows = projectConnectionRows({
      accounts: [account("gmail"), account("icloud", true)],
      settings: {},
      capabilities: [capability("email_calendar", "degraded")],
      credentialMetadata: googleCredentials,
    });

    expect(rows.find(({ id }) => id === "google-workspace")?.state).toBe("connected");
    expect(rows.find(({ id }) => id === "icloud-mail")?.state).toBe("needs_attention");
  });

  it("projects OpenAI and Anthropic from their individual keys", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [capability("ai", "degraded")],
      credentialMetadata: [
        credential("ai.openai_api_key", {
          source: "stored",
          activeConfigured: true,
          validationState: "valid",
        }),
        credential("ai.anthropic_api_key", {
          source: "stored",
          activeConfigured: true,
          validationState: "invalid",
        }),
      ],
    });

    expect(rows.find(({ id }) => id === "openai")?.state).toBe("connected");
    expect(rows.find(({ id }) => id === "anthropic")?.state).toBe("needs_attention");
  });

  it("keeps Todoist personal-token periodic mode connected without advanced OAuth or webhooks", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {
        todoist_configured: true,
        todoist_connection_mode: "personal_token",
        todoist_needs_reauth: false,
      },
      capabilities: [
        capability("tasks", "ready", { source: "settings", mode: "personal_token" }),
        capability("todoist_advanced", "not_configured", { mode: "periodic" }),
      ],
      credentialMetadata: [],
    });

    expect(rows.find(({ id }) => id === "todoist")?.state).toBe("connected");
  });

  it("connects Actual Budget only when configuration has usable health evidence", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {
        actual_budget_configured: true,
        actual_budget_url: "https://actual.example.test",
        actual_budget_sync_id: "sync-id",
      },
      capabilities: [capability("finances", "ready", {
        source: "settings",
        mode: "actual_budget",
        lastSucceededAt: "2026-07-19T01:00:00.000Z",
      })],
      credentialMetadata: [],
    });

    expect(rows.find(({ id }) => id === "actual-budget")).toMatchObject({
      state: "connected",
      lastSucceededAt: "2026-07-19T01:00:00.000Z",
    });
  });

  it("treats a configured Discord webhook as the minimum viable reminder connection", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: { discord_webhook_configured: true, discord_user_id: null },
      capabilities: [capability("notifications", "ready", {
        source: "settings",
        mode: "discord",
      })],
      credentialMetadata: [],
    });

    expect(rows.find(({ id }) => id === "discord-reminders")?.state).toBe("connected");
  });

  it("requires both a Pirate Weather key and a saved location", () => {
    const weatherKey = credential("weather.pirate_weather_api_key", {
      source: "stored",
      activeConfigured: true,
      validationState: "valid",
    });
    const withoutLocation = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [capability("weather", "not_configured")],
      credentialMetadata: [weatherKey],
    });
    const withLocation = projectConnectionRows({
      accounts: [],
      settings: { weather_location: "Pasadena, CA", weather_lat: 34.15, weather_lng: -118.14 },
      capabilities: [capability("weather", "ready")],
      credentialMetadata: [weatherKey],
    });

    expect(withoutLocation.find(({ id }) => id === "pirate-weather")?.state).toBe("needs_setup");
    expect(withLocation.find(({ id }) => id === "pirate-weather")?.state).toBe("connected");
  });

  it("projects Google Places independently from Google Workspace", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [capability("calendar_places", "ready")],
      credentialMetadata: [credential("calendar.google_places_api_key", {
        source: "environment",
        activeConfigured: true,
        validationState: "valid",
      })],
    });

    expect(rows.find(({ id }) => id === "google-places")).toMatchObject({
      state: "connected",
      source: "environment",
    });
    expect(rows.find(({ id }) => id === "google-workspace")?.state).toBe("not_connected");
  });

  it("does not downgrade Google Workspace for missing realtime, but surfaces a broken enabled watch", () => {
    const base = {
      accounts: [account("gmail")],
      settings: {},
      credentialMetadata: googleCredentials,
    };
    const periodic = projectConnectionRows({
      ...base,
      capabilities: [capability("gmail_realtime", "not_configured", { mode: "periodic" })],
    });
    const brokenRealtime = projectConnectionRows({
      ...base,
      capabilities: [capability("gmail_realtime", "degraded", {
        source: "stored",
        mode: "push_and_periodic",
        lastFailedAt: "2026-07-19T02:00:00.000Z",
      })],
    });

    expect(periodic.find(({ id }) => id === "google-workspace")?.state).toBe("connected");
    expect(brokenRealtime.find(({ id }) => id === "google-workspace")).toMatchObject({
      state: "needs_attention",
      lastFailedAt: "2026-07-19T02:00:00.000Z",
    });
  });

  it("surfaces broken Todoist OAuth after advanced mode was enabled", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {
        todoist_configured: true,
        todoist_oauth_configured: true,
        todoist_connection_mode: "oauth",
        todoist_needs_reauth: true,
      },
      capabilities: [
        capability("tasks", "needs_attention", { source: "settings", mode: "oauth" }),
        capability("todoist_advanced", "needs_attention", { source: "stored", mode: "webhook_ready" }),
      ],
      credentialMetadata: [],
    });

    expect(rows.find(({ id }) => id === "todoist")?.state).toBe("needs_attention");
  });

  it("keeps never-configured optional services neutral", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [],
      credentialMetadata: [],
    });

    expect(rows.filter(({ id }) => ["discord-reminders", "google-places"].includes(id)).map(({ state }) => state))
      .toEqual(["not_connected", "not_connected"]);
  });

  it("keeps a working credential connected while a replacement candidate has failed", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [],
      credentialMetadata: [credential("ai.openai_api_key", {
        source: "stored",
        activeConfigured: true,
        pendingConfigured: true,
        validationState: "invalid",
        errorCode: "INVALID_CREDENTIAL",
      })],
    });

    expect(rows.find(({ id }) => id === "openai")?.state).toBe("connected");
  });

  it("labels credential-backed rows unavailable when metadata cannot be read", () => {
    const rows = projectConnectionRows({
      accounts: [],
      settings: {},
      capabilities: [],
      credentialMetadata: null,
    });

    expect(rows.find(({ id }) => id === "openai")?.state).toBeNull();
    expect(rows.find(({ id }) => id === "openai")?.statusLabel).toBe("Status unavailable");
  });
});
