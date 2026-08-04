import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "../connectionModel";

const mockApi = vi.hoisted(() => ({ getAlfredModels: vi.fn() }));

// test-architecture: allow-boundary-mock -- the Alfred provider catalog crosses the authenticated model-discovery HTTP boundary while selection renders through the real control.
vi.mock("@/api", () => ({ getAlfredModels: mockApi.getAlfredModels }));

const { default: AlfredAiModelCard } = await import("./AlfredAiModelCard");

function connection(id: ConnectionId, state: ConnectionState): ConnectionRowView {
  return {
    id,
    group: "ai_providers",
    label: id === "openai" ? "OpenAI" : "Anthropic",
    description: "",
    minimumViable: "",
    hash: id,
    state,
    statusLabel: state,
    source: "stored",
    mode: "api_key",
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

function renderCard({ patch = vi.fn(), connections }: {
  patch?: SettingsPatch;
  connections?: ConnectionRowView[];
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>({
      alfred_provider: "anthropic",
      alfred_model: "claude-sonnet-4-6",
    });
    return (
      <AlfredAiModelCard
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        connections={connections}
      />
    );
  }
  return { patch, ...render(<Harness />) };
}

beforeEach(() => {
  mockApi.getAlfredModels.mockResolvedValue([
    {
      provider: "anthropic",
      label: "Anthropic",
      available: true,
      envVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-4-6",
      models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }],
    },
    {
      provider: "openai",
      label: "OpenAI",
      available: true,
      envVar: "OPENAI_API_KEY",
      defaultModel: "gpt-5.6-sol",
      models: [
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
        { id: "gpt-5.5", label: "GPT-5.5" },
      ],
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlfredAiModelCard", () => {
  it("loads provider-aware Alfred options and explains conversation locking", async () => {
    renderCard();

    expect(await screen.findByText("Alfred AI")).toBeTruthy();
    expect(screen.getByLabelText("Alfred provider")).toBeTruthy();
    expect(screen.getByLabelText("Alfred model")).toBeTruthy();
    expect(screen.getByText(/Existing conversations keep the model/)).toBeTruthy();
  });

  it("shows a disconnected saved provider without silently selecting a fallback", async () => {
    const patch = vi.fn();
    renderCard({
      patch,
      connections: [
        connection("anthropic", "not_connected"),
        connection("openai", "connected"),
      ],
    });
    await screen.findByLabelText("Alfred provider");

    expect(screen.getByRole("combobox", { name: "Alfred provider" }).textContent).toContain("Anthropic");
    expect(screen.getByText("Set ANTHROPIC_API_KEY")).toBeTruthy();
  });
});
