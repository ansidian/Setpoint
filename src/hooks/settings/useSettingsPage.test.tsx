import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getCapabilities: vi.fn(),
  getInstanceCredentials: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- the hook's stable state facade is exercised with the authenticated browser-to-server HTTP adapter faked at its imported network seam.
vi.mock("@/api", () => ({
  getAccounts: mockApi.getAccounts,
  getCapabilities: mockApi.getCapabilities,
  getInstanceCredentials: mockApi.getInstanceCredentials,
  getSettings: mockApi.getSettings,
  updateSettings: mockApi.updateSettings,
}));

const { default: useSettingsPage } = await import("./useSettingsPage");

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  vi.useFakeTimers();
  mockApi.getAccounts.mockResolvedValue({ accounts: [] });
  mockApi.getCapabilities.mockResolvedValue({ generatedAt: "2026-07-18T00:00:00.000Z", capabilities: [] });
  mockApi.getInstanceCredentials.mockResolvedValue({
    credentials: [],
    rootKey: { configured: true, valid: true, fingerprint: "demo", decryptability: "ok" },
  });
  mockApi.getSettings.mockResolvedValue({});
  mockApi.updateSettings.mockReset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSettingsPage debounced auto-save", () => {
  it("keeps account and preference settings available when capability status fails", async () => {
    mockApi.getAccounts.mockResolvedValue({ accounts: [{ id: "gmail-1", type: "gmail" }] });
    mockApi.getSettings.mockResolvedValue({ weather_location: "Pasadena, CA" });
    mockApi.getCapabilities.mockRejectedValue(new Error("status unavailable"));

    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.settings).toMatchObject({ weather_location: "Pasadena, CA" });
    expect(result.current.capabilities).toEqual([]);
  });

  it("degrades credential-backed row detail when metadata fails without blocking Settings", async () => {
    mockApi.getSettings.mockResolvedValue({ weather_location: "Pasadena, CA" });
    mockApi.getInstanceCredentials.mockRejectedValue(new Error("metadata unavailable"));

    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.loading).toBe(false);
    expect(result.current.settings).toMatchObject({ weather_location: "Pasadena, CA" });
    expect(result.current.credentialMetadata).toBeNull();
    expect(result.current.connections.find(({ id }) => id === "openai")?.state).toBeNull();
  });

  it("refreshes connection settings and capability evidence without running provider tests", async () => {
    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockApi.getSettings.mockResolvedValueOnce({ actual_budget_configured: true });
    mockApi.getCapabilities.mockResolvedValueOnce({
      generatedAt: "2026-07-19T18:00:00.000Z",
      capabilities: [{ id: "finances", state: "ready" }],
    });

    await act(async () => { await result.current.refreshConnections(); });

    // test-architecture: allow-boundary-interaction -- refreshed state cannot prove the browser requested the server's explicit capability-cache bypass required by the Settings refresh contract.
    expect(mockApi.getCapabilities).toHaveBeenLastCalledWith(true);
    expect(result.current.settings).toMatchObject({ actual_budget_configured: true });
    expect(result.current.capabilities).toEqual([{ id: "finances", state: "ready" }]);
  });

  it("re-queues a rejected payload so unrelated coalesced fields are not dropped", async () => {
    mockApi.updateSettings
      .mockRejectedValueOnce(new Error("400")) // first flush fails
      .mockResolvedValueOnce({}); // retry succeeds

    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); }); // settle the mount fetch

    // First field change → debounce → flush rejects.
    act(() => result.current.patch({ triage_mode: "auto" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // A later, unrelated field change should flush WITH the re-queued field,
    // not drop it — the buggy code cleared pendingRef before the failed await.
    act(() => result.current.patch({ lookback_hours: 12 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // test-architecture: allow-boundary-interaction -- only the second outbound Settings PUT payload proves a rejected field is re-queued and coalesced with the newer edit.
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(2, {
      triage_mode: "auto",
      lookback_hours: 12,
    });
  });
});
