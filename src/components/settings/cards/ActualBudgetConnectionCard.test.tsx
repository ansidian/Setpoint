import type { SetStateAction } from "react";
import type { SettingsState } from "../settingsTypes";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getActualCacheStatus: vi.fn(),
  hydrateActualBudgetCache: vi.fn(),
  removeActualBudgetConnection: vi.fn(),
  saveActualBudgetConnection: vi.fn(),
  testActualBudget: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
}));

vi.mock("@/api", () => ({
  getActualCacheStatus: mockApi.getActualCacheStatus,
  hydrateActualBudgetCache: mockApi.hydrateActualBudgetCache,
  removeActualBudgetConnection: mockApi.removeActualBudgetConnection,
  saveActualBudgetConnection: mockApi.saveActualBudgetConnection,
  testActualBudget: mockApi.testActualBudget,
}));
vi.mock("@/auth/securityApi", () => mockSecurity);

const { default: ActualBudgetConnectionCard } = await import("./ActualBudgetConnectionCard");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard(initialSettings: SettingsState, onRefreshConnections = vi.fn(async () => {})) {
  let currentSettings = initialSettings;
  function Harness({ settings }: { settings: SettingsState }) {
    return <ActualBudgetConnectionCard settings={settings} onRefreshConnections={onRefreshConnections} />;
  }
  const utils = render(<Harness settings={currentSettings} />);
  return {
    ...utils,
    setSettings(next: SetStateAction<SettingsState>) {
      currentSettings = typeof next === "function" ? next(currentSettings) : next;
      utils.rerender(<Harness settings={currentSettings} />);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.saveActualBudgetConnection.mockResolvedValue({ success: true, budgetFound: true });
  mockApi.removeActualBudgetConnection.mockResolvedValue({ success: true });
  mockApi.testActualBudget.mockResolvedValue({ success: true });
  mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
});

describe("ActualBudgetConnectionCard cache-status request-id guard", () => {
  it("saves and verifies a candidate atomically while keeping connection checks explicit", async () => {
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false });
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    });

    fireEvent.change(await screen.findByDisplayValue("sync-1"), { target: { value: "sync-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
    await waitFor(() => expect(mockApi.saveActualBudgetConnection).toHaveBeenCalledWith({
      serverURL: "https://actual.example.com",
      syncId: "sync-2",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    await waitFor(() => expect(mockApi.testActualBudget).toHaveBeenCalled());
  });

  it("leaves a blank write-only password unchanged when saving other fields", async () => {
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false });
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    });

    fireEvent.change(await screen.findByDisplayValue("sync-1"), { target: { value: "sync-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    await waitFor(() => expect(mockApi.saveActualBudgetConnection).toHaveBeenCalledWith({
      serverURL: "https://actual.example.com",
      syncId: "sync-2",
    }));
  });

  it("keeps a failed candidate available for correction without replacing the saved state", async () => {
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false });
    mockApi.saveActualBudgetConnection.mockRejectedValueOnce(new Error("Candidate rejected"));
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    });

    fireEvent.change(await screen.findByDisplayValue("sync-1"), { target: { value: "bad-sync" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    expect(await screen.findByText(/candidate rejected/i)).toBeTruthy();
    expect((screen.getByDisplayValue("bad-sync") as HTMLInputElement).value).toBe("bad-sync");
    expect(screen.getByRole("button", { name: "Save & verify" })).toBeTruthy();
  });

  it("preserves the full candidate while password step-up retries the save", async () => {
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false });
    mockApi.saveActualBudgetConnection
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce({ success: true, budgetFound: true });
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    });

    const syncId = await screen.findByDisplayValue("sync-1") as HTMLInputElement;
    fireEvent.change(syncId, { target: { value: "sync-2" } });
    const password = screen.getByPlaceholderText("Actual Budget password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "actual-private-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(syncId.value).toBe("sync-2");
    expect(password.value).toBe("actual-private-password");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(mockApi.saveActualBudgetConnection).toHaveBeenCalledTimes(2));
    expect(mockApi.saveActualBudgetConnection).toHaveBeenLastCalledWith({
      serverURL: "https://actual.example.com",
      syncId: "sync-2",
      password: "actual-private-password",
    });
    expect(mockSecurity.stepUpWithPassword).toHaveBeenCalledWith("owner-password");
    await waitFor(() => expect(password.value).toBe(""));
  });

  it("keeps cache hydration explicit after relocation into Connections", async () => {
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false, message: "Cache missing" });
    mockApi.hydrateActualBudgetCache.mockResolvedValue({ budgetId: "budget-1" });
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    });

    expect((await screen.findAllByText("Cache missing")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate Cache" }));
    await waitFor(() => expect(mockApi.hydrateActualBudgetCache).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Cache ready")).toBeTruthy();
  });

  it("names the destructive effect, confirms impact, and refreshes shared state", async () => {
    const onRefreshConnections = vi.fn(async () => {});
    mockApi.getActualCacheStatus.mockResolvedValue({ hydrated: false });
    renderCard({
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    }, onRefreshConnections);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Actual credentials" }));
    expect(screen.getByText(/finance sync and transaction actions will stop/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Actual credentials" }));

    await waitFor(() => expect(mockApi.removeActualBudgetConnection).toHaveBeenCalledTimes(1));
    expect(onRefreshConnections).toHaveBeenCalledTimes(1);
  });

  it("does not let a late hydrate resolution clobber a newer cache-status check", async () => {
    const configured = {
      actual_budget_url: "https://actual.example.com",
      actual_budget_sync_id: "sync-1",
      actual_budget_configured: true,
    };

    // First auto-effect status check resolves "hydrated".
    mockApi.getActualCacheStatus.mockResolvedValueOnce({ hydrated: true });

    const hydrate = deferred<{ budgetId: string }>();
    mockApi.hydrateActualBudgetCache.mockReturnValueOnce(hydrate.promise);

    // Second auto-effect status check (fired by a settings change) is deferred so
    // it stays the newest in-flight request when the stale hydrate resolves.
    const secondStatus = deferred<{ hydrated: boolean; message: string }>();
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
