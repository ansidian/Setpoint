import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "../connectionModel";

const mockApi = vi.hoisted(() => ({
  getModels: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- the triage provider catalog crosses the authenticated model-discovery HTTP boundary while selection renders through the real control.
vi.mock("@/api", () => ({
  getModels: mockApi.getModels,
}));

const { default: EmailAiModelCard } = await import("./EmailAiModelCard");

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

function renderCard({ initialSettings, patch = vi.fn(), connections }: {
  initialSettings?: SettingsState;
  patch?: SettingsPatch;
  connections?: ConnectionRowView[];
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || {
      email_ai_provider: "anthropic",
      email_ai_model: "claude-sonnet-4-6",
    });
    return (
      <EmailAiModelCard
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        connections={connections}
      />
    );
  }

  return {
    patch,
    ...render(<Harness />),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getModels.mockResolvedValue([
    {
      provider: "anthropic",
      label: "Anthropic",
      pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      available: true,
      envVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-4-6",
      models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }],
    },
    {
      provider: "openai",
      label: "OpenAI",
      pricingUrl: "https://developers.openai.com/api/docs/pricing",
      available: true,
      envVar: "OPENAI_API_KEY",
      defaultModel: "gpt-5.5",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
      ],
    },
  ]);
});

describe("EmailAiModelCard", () => {
  it("renders the two labeled provider/model selects", async () => {
    renderCard();

    expect(await screen.findByText("Inbox Triage AI")).toBeTruthy();
    expect(screen.getByLabelText("Inbox triage provider")).toBeTruthy();
    expect(screen.getByLabelText("Inbox triage model")).toBeTruthy();
    expect(screen.getByRole("link", {
      name: "Anthropic API pricing (opens in a new tab)",
    })).toBeTruthy();
  });

  it("keeps a saved unhealthy provider selected and links to repair without patching a fallback", async () => {
    const patch = vi.fn();
    renderCard({
      initialSettings: {
        email_ai_provider: "openai",
        email_ai_model: "gpt-5.4",
      },
      patch,
      connections: [
        connection("anthropic", "connected"),
        connection("openai", "needs_attention"),
      ],
    });

    expect((await screen.findByRole<HTMLButtonElement>("combobox", { name: "Inbox triage provider" })).textContent).toContain("OpenAI");
    expect(screen.getByRole<HTMLButtonElement>("combobox", { name: "Inbox triage model" }).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Repair OpenAI" }).getAttribute("href"))
      .toBe("/settings?tab=connections#openai");
  });
});
