import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";

vi.mock("@/api", () => ({
  getAlfredUsageStats: vi.fn(async () => ({ queries: 5, tools: { totalCalls: 3, byTool: [], distinctTools: 0 }, byModel: {}, cacheHitRate: 0.5 })),
  getEmailSearchStats: vi.fn(async () => ({ coverage: { total_indexed: 100 }, corpusEmbeddings: {}, querySearch: { actualUsage: {} } })),
  getTriageCacheStats: vi.fn(async () => ({ openaiCalls: 2, byTier: { cheap: {}, strong: {} }, models: [] })),
}));

const AiAnalyticsModal = (await import("./AiAnalyticsModal.jsx")).default;

it("defaults to the Alfred tab and switches sections", async () => {
  render(<AiAnalyticsModal open onClose={() => {}} />);
  expect(await screen.findByText(/Queries/i)).toBeTruthy(); // Alfred default
  fireEvent.click(screen.getByRole("tab", { name: /Email Search/i }));
  await waitFor(() => expect(screen.getByText(/Indexed/i)).toBeTruthy());
});

it("isolates a failing section", async () => {
  const { getAlfredUsageStats } = await import("@/api");
  getAlfredUsageStats.mockRejectedValueOnce(new Error("boom"));
  render(<AiAnalyticsModal open onClose={() => {}} />);
  expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
});
