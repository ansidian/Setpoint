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

  it("shows the triage call count without a cache hit or savings line", async () => {
    getTriageCacheStats.mockResolvedValueOnce({
      windowDays: 7,
      openaiCalls: 3,
      hitRate: 0.5333,
      estimatedSavingsUsd: 0.002358,
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText("3 OpenAI calls in 7 days")).toBeTruthy();
    });
    // Cache framing is gone: no "Cache: X% hit" line and no "Saved $…" fragment,
    // even though the stats payload still carries hitRate/savings.
    expect(screen.queryByText(/Cache:/i)).toBeNull();
    expect(screen.queryByText(/Saved \$/i)).toBeNull();
    // The OpenAI-only provenance pill remains.
    expect(screen.getByText("OpenAI only")).toBeTruthy();
  });
});
