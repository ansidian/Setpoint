import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTIONS } from "./connectionModel";
import type { ConnectionId, ConnectionRowView } from "./connectionModel";

vi.mock("@/components/settings/cards/ActualBudgetConnectionCard", () => ({
  default: () => <div data-testid="actual-controls" />,
}));
vi.mock("@/components/settings/cards/DiscordRemindersCard", () => ({
  default: () => <div data-testid="discord-controls" />,
}));
vi.mock("@/components/settings/cards/GoogleOAuthCredentialsCard", () => ({
  default: () => <div data-testid="google-application-controls" />,
}));
vi.mock("@/components/settings/cards/GoogleWorkspaceAccountsPanel", () => ({
  default: () => <div data-testid="google-account-controls" />,
}));
vi.mock("@/components/settings/cards/ICloudMailAccountsPanel", () => ({
  default: () => <div data-testid="icloud-account-controls" />,
}));
vi.mock("@/components/settings/cards/TodoistCard", () => ({
  default: ({ openAdvancedSetup }: { openAdvancedSetup?: boolean }) => (
    <div data-testid="todoist-controls" data-advanced-open={String(Boolean(openAdvancedSetup))} />
  ),
}));
vi.mock("@/components/settings/cards/WeatherLocationCard", () => ({
  default: () => <div data-testid="weather-location-controls" />,
}));
vi.mock("@/components/settings/cards/GmailRealtimeCard", () => ({
  default: ({ openAdvancedSetup }: { openAdvancedSetup?: boolean }) => (
    <div data-testid="gmail-realtime-controls" data-advanced-open={String(Boolean(openAdvancedSetup))} />
  ),
}));
vi.mock("@/components/settings/cards/CoreProviderCredentialsCard", () => ({
  default: ({ credentials }: { credentials: Array<{ key: string }> }) => (
    <div data-testid="credential-controls" data-credential-keys={credentials.map(({ key }) => key).join(",")} />
  ),
}));

const { default: ConnectionPanelContent } = await import("./ConnectionPanelContent");

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

function renderConnection(id: ConnectionId, setupTarget: "gmail-realtime" | "todoist-advanced" | null = null) {
  return render(
    <ConnectionPanelContent
      connection={connection(id)}
      setupTarget={setupTarget}
      accounts={[]}
      setAccounts={vi.fn()}
      settings={{}}
      patch={vi.fn()}
      credentialMetadata={[]}
      onCredentialMetadataChange={vi.fn()}
      onRefreshCredentialMetadata={vi.fn()}
      onRefreshConnections={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("ConnectionPanelContent ownership", () => {
  it("keeps Google application, account, and advanced Gmail delivery controls together", async () => {
    renderConnection("google-workspace");

    expect(screen.getByTestId("google-application-controls")).toBeTruthy();
    expect(screen.getByTestId("google-account-controls")).toBeTruthy();
    expect(await screen.findByTestId("gmail-realtime-controls")).toBeTruthy();
    expect(screen.queryByTestId("icloud-account-controls")).toBeNull();
  });

  it("reveals only the advanced subsection owned by the targeted service", async () => {
    renderConnection("google-workspace", "gmail-realtime");
    expect((await screen.findByTestId("gmail-realtime-controls")).getAttribute("data-advanced-open")).toBe("true");

    cleanup();
    renderConnection("todoist", "gmail-realtime");
    expect(screen.getByTestId("todoist-controls").getAttribute("data-advanced-open")).toBe("false");

    cleanup();
    renderConnection("todoist", "todoist-advanced");
    expect(screen.getByTestId("todoist-controls").getAttribute("data-advanced-open")).toBe("true");
  });

  it("gives iCloud Mail only its account lifecycle", () => {
    renderConnection("icloud-mail");

    expect(screen.getByTestId("icloud-account-controls")).toBeTruthy();
    expect(screen.queryByTestId("google-account-controls")).toBeNull();
  });

  it.each([
    ["openai", "ai.openai_api_key"],
    ["anthropic", "ai.anthropic_api_key"],
    ["google-places", "calendar.google_places_api_key"],
  ] as const)("isolates the %s credential", (id, key) => {
    renderConnection(id);
    expect(screen.getByTestId("credential-controls").getAttribute("data-credential-keys")).toBe(key);
  });

  it("keeps the Pirate Weather key and weather location in one service panel", () => {
    renderConnection("pirate-weather");

    expect(screen.getByTestId("credential-controls").getAttribute("data-credential-keys")).toBe("weather.pirate_weather_api_key");
    expect(screen.getByTestId("weather-location-controls")).toBeTruthy();
  });

  it.each([
    ["todoist", "todoist-controls"],
    ["actual-budget", "actual-controls"],
    ["discord-reminders", "discord-controls"],
  ] as const)("routes %s to its existing lifecycle controls", (id, testId) => {
    renderConnection(id);
    expect(screen.getByTestId(testId)).toBeTruthy();
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
        onRefreshCredentialMetadata={vi.fn()}
        onRefreshConnections={vi.fn()}
      />,
    );

    expect(screen.getByText("Source: Saved in Setpoint")).toBeTruthy();
    expect(screen.getByText(/last verified/i)).toBeTruthy();
  });
});
