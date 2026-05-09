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
    semanticSearch: {
      coverage: {
        semantic_status: "active",
        total_indexed: 1981,
        fresh_embeddings: 1981,
        stale_embeddings: 0,
        missing_embeddings: 0,
        coverage_ratio: 1,
      },
      corpusEmbeddings: {
        model: "text-embedding-3-small",
        embeddedDocuments: 1981,
        estimatedInputTokens: 125000,
        estimatedCostUsd: 0.0025,
        actualUsage: {
          calls: 2,
          inputTokens: 210000,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0.0042,
          estimatedCalls: 0,
          byEvent: {
            corpus_embedding: { calls: 2 },
          },
        },
      },
      askAi: {
        actualUsage: {
          calls: 3,
          inputTokens: 1020,
          cachedInputTokens: 200,
          outputTokens: 160,
          estimatedCostUsd: 0.0012,
          estimatedCalls: 1,
          byEvent: {
            planner: { calls: 1 },
            query_embedding: { calls: 1, estimatedCalls: 1 },
            answer: { calls: 1 },
          },
        },
        perSuccessfulAskEstimate: {
          estimatedCostUsd: 0.0061,
        },
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
    render(
      <TriageAnalyticsModal
        open
        onClose={() => {}}
        backdropSnapshot={{ dataUrl: "data:image/jpeg;base64,analytics-backdrop" }}
      />,
    );

    expect(await screen.findByRole("dialog", { name: /ai analytics/i })).toBeTruthy();
    expect(getTriageCacheStats).toHaveBeenCalledWith({ semantic: true });
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay?.className).toContain("bg-[#0b0b13]/70");
    expect(overlay?.style.backdropFilter).toBe("none");
    expect(overlay?.style.backgroundImage).toContain("analytics-backdrop");

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
    expect(screen.getByText("Triage cost")).toBeTruthy();
    expect(screen.getAllByText("Ask AI cost").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Semantic search")).toBeTruthy();
    expect(screen.getByText("Semantic search details")).toBeTruthy();
    expect(screen.getAllByText("1981 / 1981").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("$0.0025").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("$0.0012").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("$0.0061").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Backfill spend")).toBeNull();
    expect(screen.queryByText("Backfill calls")).toBeNull();
    expect(screen.getByText(/actual Ask AI usage is logged as aggregate tokens only/i)).toBeTruthy();
    expect(screen.getByText(/Ask AI spent \$0.0012 in this window/i)).toBeTruthy();
    expect(screen.getByText(/Hit rate can fall when new uncached calls add input tokens/)).toBeTruthy();
  });

  it("falls back to an opaque non-blurred overlay without a snapshot", async () => {
    render(<TriageAnalyticsModal open onClose={() => {}} />);

    expect(await screen.findByRole("dialog", { name: /ai analytics/i })).toBeTruthy();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay?.className).toContain("bg-[#0b0b13]/70");
    expect(overlay?.style.backdropFilter).toBe("none");
    expect(overlay?.style.backgroundImage).toBe("");
  });
});
