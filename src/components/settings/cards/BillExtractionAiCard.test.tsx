import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";

const mockApi = vi.hoisted(() => ({
  getBillExtractModels: vi.fn(),
}));

vi.mock("@/api", () => ({
  getBillExtractModels: mockApi.getBillExtractModels,
}));

vi.mock("@/components/ui/select", () => import("../shared/selectMock.test-utils"));

const { default: BillExtractionAiCard } = await import("./BillExtractionAiCard");

function renderCard({ initialSettings, patch = vi.fn() }: {
  initialSettings?: SettingsState;
  patch?: SettingsPatch;
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || {
      bill_extract_provider: "anthropic",
      bill_extract_model: "claude-haiku-4-5",
    });
    return <BillExtractionAiCard settings={settings} setSettings={setSettings} patch={patch} />;
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
  mockApi.getBillExtractModels.mockResolvedValue([
    {
      provider: "anthropic",
      label: "Anthropic",
      available: true,
      envVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-haiku-4-5",
      models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
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

describe("BillExtractionAiCard", () => {
  it("renders the two labeled provider/model selects", async () => {
    renderCard();

    await waitFor(() => {
      expect(mockApi.getBillExtractModels).toHaveBeenCalled();
    });

    expect(screen.getByText("Provider")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByLabelText("Bill extraction provider")).toBeTruthy();
    expect(screen.getByLabelText("Bill extraction model")).toBeTruthy();
  });

  it("a provider change reaches patch with the resolved provider/model", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    await waitFor(() => {
      expect(mockApi.getBillExtractModels).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Bill extraction provider"), {
      target: { value: "openai" },
    });

    await waitFor(() => {
      expect(patch).toHaveBeenLastCalledWith({
        bill_extract_provider: "openai",
        bill_extract_model: "gpt-5.5",
      });
    });
  });

  it("shows the env-var warning for an unavailable provider", async () => {
    mockApi.getBillExtractModels.mockResolvedValueOnce([
      {
        provider: "anthropic",
        label: "Anthropic",
        available: true,
        envVar: "ANTHROPIC_API_KEY",
        defaultModel: "claude-haiku-4-5",
        models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
      },
      {
        provider: "openai",
        label: "OpenAI",
        available: false,
        envVar: "OPENAI_API_KEY",
        defaultModel: "gpt-5.5",
        models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
      },
    ]);

    renderCard({
      initialSettings: {
        bill_extract_provider: "openai",
        bill_extract_model: "gpt-5.5",
      },
    });

    await screen.findByText("Set OPENAI_API_KEY");
  });
});
