import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import AlfredAnalyticsSection from "./AlfredAnalyticsSection.jsx";

it("renders Alfred hero metrics and per-tool breakdown", () => {
  render(<AlfredAnalyticsSection stats={{
    queries: 12, turns: 30, inputTokens: 50000, cachedInputTokens: 30000,
    outputTokens: 4000, cacheHitRate: 0.6, estimatedCostUsd: 0.12, estimatedSavingsUsd: 0.08,
    byModel: { "claude-sonnet-4-6": { calls: 25, estimatedCostUsd: 0.1 } },
    tools: { totalCalls: 18, distinctTools: 2, byTool: [
      { name: "search_email", calls: 12, errors: 1, errorRate: 0.08, avgDurationMs: 120 },
      { name: "get_calendar_events", calls: 6, errors: 0, errorRate: 0, avgDurationMs: 40 },
    ] },
    comparisonWindows: { monthToDate: {} },
  }} />);
  expect(screen.getByText(/Queries/i)).toBeTruthy();
  // "12" appears both as the Queries metric and as search_email's call count.
  expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  expect(screen.getByText(/search_email/)).toBeTruthy();
  expect(screen.getByText(/get_calendar_events/)).toBeTruthy();
});

it("renders an empty state when no tool calls were made", () => {
  render(<AlfredAnalyticsSection stats={{
    queries: 0, tools: { totalCalls: 0, distinctTools: 0, byTool: [] }, byModel: {},
  }} />);
  expect(screen.getByText(/No tool calls in this window/i)).toBeTruthy();
});
