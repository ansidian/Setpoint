import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailTriageModeCard from "./EmailTriageModeCard";
import type { SettingsState } from "../settingsTypes";

// test-architecture: allow-boundary-mock -- triage usage statistics cross the authenticated reporting HTTP boundary while mode changes remain local rendered state.
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

function renderCard(initialSettings: SettingsState = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
      email_triage_classify_read_arrivals: false,
      ...initialSettings,
    });
    return (
      <EmailTriageModeCard
        settings={settings}
        setSettings={setSettings}
        patch={() => {}}
      />
    );
  }
  render(
    <Harness />,
  );
}

describe("EmailTriageModeCard", () => {
  it("shows stored and effective email triage modes distinctly", () => {
    renderCard({ email_triage_mode: "auto", email_triage_effective_mode: "no_model" });

    expect(screen.getByText("Email Triage Automation")).toBeTruthy();
    expect(screen.getByText("Stored: Auto")).toBeTruthy();
    expect(screen.getByText("Effective: No model")).toBeTruthy();
  });

  it("patches the selected mode", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(screen.getByText("Stored: Paused")).toBeTruthy();
    expect(screen.getByText("Effective: Paused")).toBeTruthy();
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

  it("enables triage for read arrivals through the settings patch flow", () => {
    renderCard();
    const toggle = screen.getByRole("switch", { name: "Triage read arrivals" });

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);

    expect(screen.getByRole("switch", { name: "Triage read arrivals" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Preflight rules still apply\./)).toBeTruthy();
  });

  it("shows the triage call count without a cache hit or savings line", async () => {
    vi.mocked(getTriageCacheStats).mockResolvedValueOnce({
      windowDays: 7,
      windowLabel: "7_days",
      generatedAt: "2026-07-15T00:00:00.000Z",
      openaiCalls: 3,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      hitRate: 0.5333,
      estimatedSavingsUsd: 0.002358,
      lastTriagedAt: null,
      models: [],
      comparisonWindows: {
        monthToDate: { windowDays: null, windowLabel: "month_to_date", openaiCalls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0, hitRate: 0 },
      },
      byTier: {
        cheap: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
        strong: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 },
      },
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
