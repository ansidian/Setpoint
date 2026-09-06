import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import AiAnalyticsModal from "./AiAnalyticsModal";
import { demoEmailAiUsageStats } from "@/demo/emailAiUsageData";

const statsByPath: Record<string, unknown> = {
  "/api/alfred/usage": { queries: 5, tools: { totalCalls: 3, byTool: [], distinctTools: 0 }, byModel: {}, cacheHitRate: 0.5 },
  "/api/ea/email-search/usage": { coverage: { total_indexed: 100 }, corpusEmbeddings: {}, querySearch: { actualUsage: {} } },
  "/api/ea/triage/cache-stats": { openaiCalls: 2, byTier: { cheap: {}, strong: {} }, models: [] },
  "/api/ea/email-ai/usage": demoEmailAiUsageStats(),
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    return response(statsByPath[path] ?? { error: "not found" }, path in statsByPath ? 200 : 404);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("recovers the failing section when Try again succeeds", async () => {
  let alfredRequests = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    if (path === "/api/alfred/usage" && alfredRequests++ === 0) return response({ error: "boom" }, 500);
    return response(statsByPath[path]);
  });

  render(<AiAnalyticsModal open onClose={() => {}} />);
  expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /try again/i }));

  expect(await screen.findByText(/Queries/i)).toBeTruthy();
  expect(screen.getByText("5")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(/couldn.t load/i)).toBeNull());
});
