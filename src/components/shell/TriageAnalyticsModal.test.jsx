import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TriageAnalyticsModal from "./TriageAnalyticsModal.jsx";

vi.mock("@/api", () => ({
  getTriageCacheStats: vi.fn(async () => ({
    windowDays: 7,
    windowLabel: "rolling",
    generatedAt: "2026-05-07T12:00:00.000Z",
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
      monthToDate: {
        windowDays: null,
        windowLabel: "month_to_date",
        openaiCalls: 2,
        inputTokens: 3000,
        cachedInputTokens: 1600,
        outputTokens: 300,
        estimatedCostUsd: 0.005967,
        estimatedSavingsUsd: 0.002358,
        hitRate: 0.5333,
      },
    },
    byTier: {
      cheap: {
        calls: 1,
        inputTokens: 1000,
        cachedInputTokens: 600,
        outputTokens: 100,
        estimatedCostUsd: 0.000217,
        estimatedSavingsUsd: 0.000108,
      },
      strong: {
        calls: 1,
        inputTokens: 2000,
        cachedInputTokens: 1000,
        outputTokens: 200,
        estimatedCostUsd: 0.00575,
        estimatedSavingsUsd: 0.00225,
      },
    },
  })),
}));

const { getTriageCacheStats } = await import("@/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TriageAnalyticsModal", () => {
  it("shows OpenAI triage cache, cost, model, and tier analytics", async () => {
    render(<TriageAnalyticsModal open onClose={() => {}} />);

    expect(await screen.findByRole("dialog", { name: /ai triage analytics/i })).toBeTruthy();
    expect(getTriageCacheStats).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getAllByText("53.3%").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.6k").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0060").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0024").length).toBeGreaterThan(0);
    expect(screen.getByText("Saved 28.3% versus an uncached estimate.")).toBeTruthy();
    expect(screen.getByText("gpt-5.4")).toBeTruthy();
    expect(screen.getByText("gpt-5.4-nano")).toBeTruthy();
    expect(screen.getByText("Cheap tier")).toBeTruthy();
    expect(screen.getByText("Strong tier")).toBeTruthy();
    expect(screen.getByText(/Hit rate can fall when new uncached calls add input tokens/)).toBeTruthy();
  });
});
