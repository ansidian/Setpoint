import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getActualCacheStatus: vi.fn(),
  hydrateActualBudgetCache: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/api", () => ({
  getActualCacheStatus: mockApi.getActualCacheStatus,
  hydrateActualBudgetCache: mockApi.hydrateActualBudgetCache,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
}));

const { default: ActualBudgetConnectionCard } = await import("./ActualBudgetConnectionCard.jsx");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard(initialSettings) {
  let setSettings;
  function Harness() {
    const [settings, setState] = useState(initialSettings);
    setSettings = setState;
    return <ActualBudgetConnectionCard settings={settings} />;
  }
  const utils = render(<Harness />);
  return { ...utils, setSettings: (next) => setSettings(next) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.testActualBudget.mockResolvedValue({ success: true });
  mockApi.updateSettings.mockResolvedValue({});
});

describe("ActualBudgetConnectionCard cache-status request-id guard", () => {
  it("does not let a late hydrate resolution clobber a newer cache-status check", async () => {
    const configured = {
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    };

    // First auto-effect status check resolves "hydrated".
    mockApi.getActualCacheStatus.mockResolvedValueOnce({ hydrated: true });

    const hydrate = deferred();
    mockApi.hydrateActualBudgetCache.mockReturnValueOnce(hydrate.promise);

    // Second auto-effect status check (fired by a settings change) is deferred so
    // it stays the newest in-flight request when the stale hydrate resolves.
    const secondStatus = deferred();
    mockApi.getActualCacheStatus.mockReturnValueOnce(secondStatus.promise);

    const { setSettings } = renderCard(configured);

    // First status check settles to "Cache ready".
    await screen.findByText("Cache ready");

    // Start a manual hydrate; leave its promise pending.
    fireEvent.click(screen.getByText("Hydrate Cache"));
    await screen.findByText("Hydrating...");

    // A newer cache-status check supersedes the hydrate by re-firing the auto-effect.
    act(() => {
      setSettings({ ...configured, actual_budget_url: "https://actual.example.com/v2" });
    });
    await waitFor(() => {
      expect(mockApi.getActualCacheStatus).toHaveBeenCalledTimes(2);
    });

    // The newer status check settles FIRST -> pill is "Cache missing".
    await act(async () => {
      secondStatus.resolve({ hydrated: false, message: "Actual local budget cache not found" });
      await Promise.resolve();
    });
    await screen.findByText("Cache missing");

    // The stale hydrate resolves LAST. Without the guard its "ok" write would clobber
    // the already-settled newer check and flash "Cache ready"; the guard must drop it.
    await act(async () => {
      hydrate.resolve({ budgetId: "stale-budget" });
      await Promise.resolve();
    });

    expect(screen.queryByText("Cache ready")).toBeNull();
    expect(screen.getByText("Cache missing")).toBeTruthy();
  });
});
