import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

it("carries the blocking calendar-hotkey suspension marker while open", async () => {
  render(<AiAnalyticsModal open onClose={() => {}} />);

  // The calendar's hotkey handler suspends its whole keyboard surface while an
  // element with data-suspend-calendar-hotkeys="blocking" is mounted anywhere —
  // assert the same presence query the handler runs.
  await waitFor(() => {
    expect(document.querySelector("[data-suspend-calendar-hotkeys='blocking']")).toBeTruthy();
  });
});

it("isolates a failing section", async () => {
  const { getAlfredUsageStats } = await import("@/api");
  getAlfredUsageStats.mockRejectedValueOnce(new Error("boom"));
  render(<AiAnalyticsModal open onClose={() => {}} />);
  expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
});

it("recovers the failing section when Try again succeeds", async () => {
  const { getAlfredUsageStats } = await import("@/api");
  // Reset the shared mock so the mount call rejects exactly once and the retry
  // (and every later mount) resolves. Queries are scoped to this modal below.
  getAlfredUsageStats.mockReset();
  getAlfredUsageStats
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValue({ queries: 5, tools: { totalCalls: 3, byTool: [], distinctTools: 0 }, byModel: {}, cacheHitRate: 0.5 });

  render(<AiAnalyticsModal open onClose={() => {}} />);
  // The dialog renders into a portal (outside render()'s container), and this
  // suite has no auto-cleanup, so earlier tests' modals linger in the body.
  // Scope to the most recently mounted modal (the one this test rendered) to
  // avoid matching error/data nodes left over from those earlier renders.
  const modals = await screen.findAllByTestId("ai-analytics-modal");
  const view = within(modals[modals.length - 1]);

  // Error state is shown first (mount fetch rejected).
  expect(await view.findByText(/couldn.t load/i)).toBeTruthy();

  // Clicking "Try again" re-runs that tab's fetch, which now resolves.
  fireEvent.click(view.getByRole("button", { name: /try again/i }));

  // Section data renders (the Queries metric + its value from the resolved
  // stats), and this modal's error message is gone — the retry contract.
  expect(await view.findByText(/Queries/i)).toBeTruthy();
  expect(view.getByText("5")).toBeTruthy(); // queries value from the resolved mock
  await waitFor(() => expect(view.queryByText(/couldn.t load/i)).toBeNull());
});

it("does not throw or warn when closed before the fetch resolves", async () => {
  const { getAlfredUsageStats } = await import("@/api");
  // The shared mock may have been reset by the retry test above; restore a
  // resolving default so the mount fetch returns a thenable (not undefined).
  getAlfredUsageStats.mockReset();
  getAlfredUsageStats.mockResolvedValue({ queries: 5, tools: { totalCalls: 3, byTool: [], distinctTools: 0 }, byModel: {}, cacheHitRate: 0.5 });

  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  const { unmount } = render(<AiAnalyticsModal open onClose={() => {}} />);
  // Unmount before the in-flight section fetches resolve; the alive-ref guard
  // must drop the late setState instead of warning/throwing.
  unmount();
  await Promise.resolve();
  await Promise.resolve();
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
