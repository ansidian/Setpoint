import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailTriageModeCard from "./EmailTriageModeCard.jsx";

vi.mock("@/api", () => ({
  getTriageCacheStats: vi.fn(async () => ({
    windowDays: 7,
    openaiCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
    hitRate: 0,
    lastTriagedAt: null,
    models: [],
    comparisonWindows: {
      monthToDate: { windowDays: null, windowLabel: "month_to_date", openaiCalls: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
    },
    byTier: {
      cheap: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
      strong: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
    },
  })),
}));

const { getTriageCacheStats } = await import("@/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(initialSettings = {}) {
  const patch = vi.fn();
  const setSettingsSpy = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
      ...initialSettings,
    });
    const setSettingsWithSpy = (updater) => {
      setSettingsSpy(updater);
      setSettings(updater);
    };
    return (
      <EmailTriageModeCard
        settings={settings}
        setSettings={setSettingsWithSpy}
        patch={patch}
      />
    );
  }
  render(
    <Harness />,
  );
  return { patch, setSettings: setSettingsSpy };
}

describe("EmailTriageModeCard", () => {
  it("shows stored and effective email triage modes distinctly", () => {
    renderCard({ email_triage_mode: "auto", email_triage_effective_mode: "no_model" });

    expect(screen.getByText("Email Triage Automation")).toBeTruthy();
    expect(screen.getByText("Stored: Auto")).toBeTruthy();
    expect(screen.getByText("Effective: No model")).toBeTruthy();
  });

  it("patches the selected mode", () => {
    const { patch, setSettings } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(setSettings).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ email_triage_mode: "paused" });
  });

  it("updates the effective chip immediately for explicit modes", () => {
    renderCard({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
    });

    fireEvent.click(screen.getByRole("button", { name: /use real/i }));

    expect(screen.getByText("Stored: Real")).toBeTruthy();
    expect(screen.getByText("Effective: Real")).toBeTruthy();
  });

  it("re-resolves auto immediately after an explicit mode was selected", () => {
    renderCard({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
    });

    fireEvent.click(screen.getByRole("button", { name: /use real/i }));
    expect(screen.getByText("Effective: Real")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^auto$/i }));

    expect(screen.getByText("Stored: Auto")).toBeTruthy();
    expect(screen.getByText("Effective: No model")).toBeTruthy();
  });

  it("shows recent OpenAI triage cache savings", async () => {
    getTriageCacheStats.mockResolvedValueOnce({
      windowDays: 7,
      openaiCalls: 2,
      inputTokens: 3000,
      cachedInputTokens: 1600,
      outputTokens: 300,
      estimatedCostUsd: 0.005967,
      estimatedSavingsUsd: 0.002358,
      hitRate: 0.5333,
      lastTriagedAt: "2026-05-04T12:05:00.000Z",
      models: ["gpt-5.4", "gpt-5.4-nano"],
      comparisonWindows: {
        monthToDate: { windowDays: null, windowLabel: "month_to_date", openaiCalls: 2, estimatedCostUsd: 0.005967, estimatedSavingsUsd: 0.002358 },
      },
      byTier: {
        cheap: { calls: 1, inputTokens: 1000, cachedInputTokens: 600, outputTokens: 100, estimatedCostUsd: 0.000217, estimatedSavingsUsd: 0.000108 },
        strong: { calls: 1, inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 200, estimatedCostUsd: 0.00575, estimatedSavingsUsd: 0.00225 },
      },
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Cache: 53.3% hit")).toBeTruthy();
    });
    expect(screen.queryByText("Cost")).toBeNull();
    expect(screen.queryByText("1.6k")).toBeNull();
    expect(screen.getByText((content) => content.includes("$0.0024"))).toBeTruthy();
    expect(screen.getByText("Cache: 53.3% hit")).toBeTruthy();
    expect(screen.getByText("2 OpenAI calls in 7 days")).toBeTruthy();
    expect(screen.queryByText("MTD cost: $0.0060")).toBeNull();
    expect(screen.queryByText(/Last: May 4/)).toBeNull();
  });

  it("does not round tiny nonzero cache savings down to zero", async () => {
    getTriageCacheStats.mockResolvedValueOnce({
      windowDays: 7,
      openaiCalls: 1,
      inputTokens: 1100,
      cachedInputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.000227,
      estimatedSavingsUsd: 0.000018,
      hitRate: 0.0909,
      lastTriagedAt: null,
      models: ["gpt-5.4-nano"],
      comparisonWindows: {
        monthToDate: { windowDays: null, windowLabel: "month_to_date", openaiCalls: 1, estimatedCostUsd: 0.000227, estimatedSavingsUsd: 0.000018 },
      },
      byTier: {
        cheap: { calls: 1, inputTokens: 1100, cachedInputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.000227, estimatedSavingsUsd: 0.000018 },
        strong: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
      },
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes("<$0.0001"))).toBeTruthy();
    });
  });
});
