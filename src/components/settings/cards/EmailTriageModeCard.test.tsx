import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
