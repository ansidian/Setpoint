import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getCapabilities: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/api", () => ({
  getAccounts: mockApi.getAccounts,
  getCapabilities: mockApi.getCapabilities,
  getSettings: mockApi.getSettings,
  updateSettings: mockApi.updateSettings,
}));

const { default: useSettingsPage } = await import("./useSettingsPage");

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  vi.useFakeTimers();
  mockApi.getAccounts.mockResolvedValue({ accounts: [] });
  mockApi.getCapabilities.mockResolvedValue({ generatedAt: "2026-07-18T00:00:00.000Z", capabilities: [] });
  mockApi.getSettings.mockResolvedValue({});
  mockApi.updateSettings.mockReset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSettingsPage debounced auto-save", () => {
  it("loads shared capability truth with settings and accounts", async () => {
    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    expect(mockApi.getCapabilities).toHaveBeenCalledTimes(1);
    expect(result.current.capabilities).toEqual([]);
  });

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

  it("re-queues a rejected payload so unrelated coalesced fields are not dropped", async () => {
    mockApi.updateSettings
      .mockRejectedValueOnce(new Error("400")) // first flush fails
      .mockResolvedValueOnce({}); // retry succeeds

    const { result } = renderHook(() => useSettingsPage(), { wrapper });
    await act(async () => { await Promise.resolve(); }); // settle the mount fetch

    // First field change → debounce → flush rejects.
    act(() => result.current.patch({ triage_mode: "auto" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(1, { triage_mode: "auto" });

    // A later, unrelated field change should flush WITH the re-queued field,
    // not drop it — the buggy code cleared pendingRef before the failed await.
    act(() => result.current.patch({ lookback_hours: 12 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(2, {
      triage_mode: "auto",
      lookback_hours: 12,
    });
  });
});
