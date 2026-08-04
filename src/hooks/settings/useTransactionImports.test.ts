// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getTransactionImportMappings: vi.fn(),
  listTransactionImportRuns: vi.fn(),
  getTransactionImportRun: vi.fn(),
  updateTransactionImportMapping: vi.fn(),
  startTransactionImportScan: vi.fn(),
  commitTransactionImportItems: vi.fn(),
  retryTransactionImportItem: vi.fn(),
  dismissTransactionImportItem: vi.fn(),
}));
// test-architecture: allow-boundary-mock -- the hook's race and polling state machine runs intact while its authenticated browser-to-server HTTP boundary is faked.
vi.mock("@/api", () => api);

const { default: useTransactionImports } = await import("./useTransactionImports");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const paypalMapping = {
  source: "paypal" as const,
  mode: "observe" as const,
  actualAccountId: "account-1",
  actualCategoryId: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  api.getTransactionImportMappings.mockResolvedValue([]);
  api.listTransactionImportRuns.mockResolvedValue({ runs: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useTransactionImports", () => {
  it("does not allow a stale initial response to overwrite a newer refresh", async () => {
    const firstMappings = deferred<never[]>();
    const firstRuns = deferred<{ runs: never[] }>();
    api.getTransactionImportMappings
      .mockReturnValueOnce(firstMappings.promise)
      .mockResolvedValueOnce([paypalMapping]);
    api.listTransactionImportRuns
      .mockReturnValueOnce(firstRuns.promise)
      .mockResolvedValueOnce({ runs: [] });

    const { result } = renderHook(() => useTransactionImports());
    await act(async () => result.current.refresh());
    expect(result.current.mappings).toEqual([paypalMapping]);

    await act(async () => {
      firstMappings.resolve([]);
      firstRuns.resolve({ runs: [] });
      await Promise.resolve();
    });
    expect(result.current.mappings).toEqual([paypalMapping]);
  });

  it("polls only while a run or item is active", async () => {
    vi.useFakeTimers();
    const activeRun = {
      id: "run-1",
      trigger: "historical_scan" as const,
      status: "running" as const,
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon" as const],
      startDate: "2026-07-01",
      endDate: "2026-07-22",
      cursor: {},
      counts: { discovered: 1, parsed: 0, review: 0, queued: 0, added: 0, updated: 0, duplicate: 0, failed: 0 },
      attempts: 1,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    api.listTransactionImportRuns.mockResolvedValue({ runs: [activeRun] });
    api.getTransactionImportRun.mockResolvedValue({ ...activeRun, items: [] });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    const { result } = renderHook(() => useTransactionImports());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // test-architecture: allow-boundary-interaction -- active polling is itself an outbound timer-to-server contract; hook state cannot prove the second HTTP refresh was admitted after 3 seconds.
    expect(api.listTransactionImportRuns).toHaveBeenCalledTimes(2);
  });
});
