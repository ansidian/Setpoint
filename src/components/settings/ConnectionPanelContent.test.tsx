import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTIONS } from "./connectionModel";
import type { ConnectionId, ConnectionRowView } from "./connectionModel";
import type { InstanceCredentialMetadata } from "../../../shared/types/instance-credentials";

const mockApi = vi.hoisted(() => ({
  addICloudAccount: vi.fn(),
  disableGoogleOAuthApplication: vi.fn(),
  disableInstanceCredential: vi.fn(),
  discardGoogleOAuthPending: vi.fn(),
  discardInstanceCredentialPending: vi.fn(),
  disconnectTodoistConnection: vi.fn(),
  geocodeLocation: vi.fn(),
  getActualCacheStatus: vi.fn(),
  getAccounts: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  importGoogleOAuthEnvironment: vi.fn(),
  importInstanceCredentialEnvironment: vi.fn(),
  removeAccount: vi.fn(),
  saveTodoistPersonalToken: vi.fn(),
  stageGoogleOAuthApplication: vi.fn(),
  stageInstanceCredential: vi.fn(),
  testDiscordReminderWebhook: vi.fn(),
  testInstanceCredential: vi.fn(),
  updateSettings: vi.fn(),
  useHostGoogleOAuthApplication: vi.fn(),
  useHostInstanceCredential: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  getCanonicalOriginStatus: vi.fn(),
  stepUpWithPassword: vi.fn(),
}));
const mockTodoist = vi.hoisted(() => ({
  beginTodoistOAuth: vi.fn(),
  discardTodoistOAuthPending: vi.fn(),
  getTodoistConnectionStatus: vi.fn(),
  importTodoistOAuthEnvironment: vi.fn(),
  stageTodoistOAuthApplication: vi.fn(),
}));
const mockGmailRealtime = vi.hoisted(() => ({
  generateGmailPubSubCallback: vi.fn(),
  getGmailPubSubStatus: vi.fn(),
  importGmailPubSubEnvironmentToken: vi.fn(),
  revokeGmailPubSubToken: vi.fn(),
  setGmailPubSubTopic: vi.fn(),
  testGmailPubSubWatches: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- real connection cards are rendered while API/provider adapters are replaced at their network boundaries.
vi.mock("@/api", () => mockApi);

// test-architecture: allow-boundary-mock -- security status and step-up are server-owned credential boundaries, not child-card seams.
vi.mock("@/auth/securityApi", () => mockSecurity);

// test-architecture: allow-boundary-mock -- Todoist OAuth status/actions are external provider boundaries; the real Todoist card remains mounted.
vi.mock("@/lib/todoistSetupApi", () => mockTodoist);

// test-architecture: allow-boundary-mock -- Gmail Pub/Sub status/actions are external provider boundaries; the real lazy card remains mounted.
vi.mock("@/lib/gmailPubSubSetupApi", () => mockGmailRealtime);

const { default: ConnectionPanelContent } = await import("./ConnectionPanelContent");

const disconnectedTodoistStatus = {
  mode: "disconnected",
  configured: false,
  oauthRefreshable: false,
  needsReauth: false,
  application: {
    configured: false,
    source: "absent",
    pendingConfigured: false,
    pendingStagedAt: null,
    pendingExpiresAt: null,
    candidateVersions: null,
  },
  callbackUrl: "https://setpoint.example/api/ea/accounts/todoist/callback",
  webhookUrl: "https://setpoint.example/api/todoist/webhook",
  deliveryMode: "periodic",
} as const;

const periodicGmailStatus = {
  configured: false,
  healthy: true,
  deliveryMode: "periodic",
  deliveryStatus: "periodic_reconciliation",
  delayedUpdates: true,
  topic: { source: "absent", configured: false },
  pushToken: { source: "absent", configured: false },
  callbackUrl: "https://setpoint.example/api/gmail/push",
  watchTest: { lastTestedAt: null, lastSucceededAt: null, lastFailedAt: null, errorCode: null },
} as const;

function connection(id: ConnectionId): ConnectionRowView {
  const definition = CONNECTIONS.find((candidate) => candidate.id === id)!;
  return {
    ...definition,
    state: "not_connected",
    statusLabel: "Not connected",
    source: "absent",
    mode: null,
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

function credential(key: string): InstanceCredentialMetadata {
  return {
    key,
    handling: key.includes("api_key") ? "secret" : "non_secret",
    capabilities: [],
    source: "absent",
    activeConfigured: false,
    pendingConfigured: false,
    pendingStagedAt: null,
    pendingExpiresAt: null,
    validationState: "untested",
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: null,
  };
}

function renderConnection(
  id: ConnectionId,
  setupTarget: "gmail-realtime" | "todoist-advanced" | null = null,
  credentialMetadata: InstanceCredentialMetadata[] = [],
) {
  return render(
    <ConnectionPanelContent
      connection={connection(id)}
      setupTarget={setupTarget}
      accounts={[]}
      setAccounts={vi.fn()}
      settings={{}}
      patch={vi.fn()}
      credentialMetadata={credentialMetadata}
      onCredentialMetadataChange={vi.fn()}
      onRefreshCredentialMetadata={vi.fn(async () => {})}
      onRefreshConnections={vi.fn(async () => {})}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

beforeEach(() => {
  mockApi.getAccounts.mockResolvedValue([]);
  mockApi.getActualCacheStatus.mockResolvedValue({
    success: true,
    configured: false,
    hydrated: false,
    message: "Actual local budget cache not found",
  });
  mockSecurity.getCanonicalOriginStatus.mockResolvedValue({
    currentOrigin: "https://setpoint.example",
    proposedOrigin: "https://setpoint.example",
    affectedPasskeys: 0,
    callbacks: [],
    recentAuth: false,
  });
  mockTodoist.getTodoistConnectionStatus.mockResolvedValue(disconnectedTodoistStatus);
  mockGmailRealtime.getGmailPubSubStatus.mockResolvedValue(periodicGmailStatus);
});

describe("ConnectionPanelContent user-visible ownership", () => {
  it("keeps Google application, account, and advanced Gmail delivery controls together", async () => {
    renderConnection("google-workspace");

    expect(screen.getByText("Google application")).toBeTruthy();
    expect(screen.getByText("Google accounts")).toBeTruthy();
    expect(await screen.findByText("Gmail real-time delivery")).toBeTruthy();
    expect(screen.queryByText("iCloud accounts")).toBeNull();
  });

  it("reveals only the advanced subsection owned by the targeted service", async () => {
    renderConnection("google-workspace", "gmail-realtime");
    const gmailAdvanced = await screen.findByText("Advanced Pub/Sub setup");
    expect(gmailAdvanced.closest("details")?.open).toBe(true);

    cleanup();
    renderConnection("todoist", "gmail-realtime");
    const todoistAdvanced = await screen.findByText("Advanced OAuth and webhooks");
    expect(todoistAdvanced.closest("details")?.open).toBe(false);

    cleanup();
    renderConnection("todoist", "todoist-advanced");
    const targetedTodoistAdvanced = await screen.findByText("Advanced OAuth and webhooks");
    expect(targetedTodoistAdvanced.closest("details")?.open).toBe(true);
  });

  it("gives iCloud Mail only its account lifecycle", () => {
    renderConnection("icloud-mail");

    expect(screen.getByText("iCloud accounts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add iCloud account" })).toBeTruthy();
    expect(screen.queryByText("Google accounts")).toBeNull();
  });

  it.each([
    ["openai", "ai.openai_api_key", "OpenAI API key"],
    ["anthropic", "ai.anthropic_api_key", "Anthropic API key"],
    ["google-places", "calendar.google_places_api_key", "Google Maps Platform API key"],
  ] as const)("shows the %s credential editor in its connection", (id, key, label) => {
    renderConnection(id, null, [credential(key)]);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("keeps Home inside the stable Google Maps Platform panel", () => {
    renderConnection("google-places", null, [credential("calendar.google_places_api_key")]);
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByLabelText("Choose Home")).toBeTruthy();
    expect(screen.getByText(/Routes calculates traffic-aware departure time/)).toBeTruthy();
  });

  it("keeps the Pirate Weather key and weather location in one service panel", () => {
    renderConnection("pirate-weather", null, [credential("weather.pirate_weather_api_key")]);

    expect(screen.getByLabelText("Pirate Weather API key")).toBeTruthy();
    expect(screen.getByText("Weather Location")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Look up" })).toBeTruthy();
  });

  it.each([
    ["todoist", "Todoist API token", "Save & verify"],
    ["actual-budget", "https://actual.yourdomain.com", "Check connection"],
    ["discord-reminders", "https://discord.com/api/webhooks/...", "Save Discord"],
  ] as const)("routes %s to its existing lifecycle controls", (id, inputPlaceholder, actionLabel) => {
    renderConnection(id);
    expect(screen.getByPlaceholderText(inputPlaceholder)).toBeTruthy();
    expect(screen.getByRole("button", { name: actionLabel })).toBeTruthy();
  });

  it("normalizes stored settings sources and keeps verification evidence visible", () => {
    const row = {
      ...connection("actual-budget"),
      source: "settings" as const,
      lastSucceededAt: "2026-07-19T18:00:00.000Z",
    };
    render(
      <ConnectionPanelContent
        connection={row}
        accounts={[]}
        setAccounts={vi.fn()}
        settings={{}}
        patch={vi.fn()}
        credentialMetadata={[]}
        onCredentialMetadataChange={vi.fn()}
        onRefreshCredentialMetadata={vi.fn(async () => {})}
        onRefreshConnections={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText("Source: Saved in Setpoint")).toBeTruthy();
    expect(screen.getByText(/last verified/i)).toBeTruthy();
  });
});
