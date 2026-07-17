import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";

const mockApi = vi.hoisted(() => ({
  getModels: vi.fn(),
}));

vi.mock("@/api", () => ({
  getModels: mockApi.getModels,
}));

vi.mock("@/components/ui/select", () => import("../shared/selectMock.test-utils"));

const { default: EmailAiModelCard } = await import("./EmailAiModelCard");

function renderCard({ initialSettings, patch = vi.fn() }: {
  initialSettings?: SettingsState;
  patch?: SettingsPatch;
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || {
      email_ai_provider: "anthropic",
      email_ai_model: "claude-sonnet-4-6",
    });
    return <EmailAiModelCard settings={settings} setSettings={setSettings} patch={patch} />;
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

    await waitFor(() => {
      expect(mockApi.getModels).toHaveBeenCalled();
    });

    expect(screen.getByText("Inbox Triage AI")).toBeTruthy();
    expect(screen.getByText("Model used for durable inbox triage. Bill extraction uses its own model.")).toBeTruthy();
    expect(screen.getByLabelText("Inbox triage provider")).toBeTruthy();
    expect(screen.getByLabelText("Inbox triage model")).toBeTruthy();
  });

  it("a provider change reaches patch with the resolved provider/model", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    await waitFor(() => {
      expect(mockApi.getModels).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Inbox triage provider"), {
      target: { value: "openai" },
    });

    await waitFor(() => {
      expect(patch).toHaveBeenLastCalledWith({
        email_ai_provider: "openai",
        email_ai_model: "gpt-5.5",
      });
    });
  });
});
