import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualMetadata } from "./actualMetadata";

vi.mock("../api", () => ({
  getActualMetadata: vi.fn(),
}));

const { getActualMetadata } = await import("../api");
const { ensureMetadataLoaded, invalidateActualMetadata } = await import("./actualMetadata");
const getActualMetadataMock = vi.mocked(getActualMetadata);

const response = (payeeName: string) => ({
  accounts: [{ id: "a1", name: "Checking" }],
  payees: [{ id: "p1", name: payeeName }],
  categories: [{ group_name: "Bills", categories: [{ id: "c1", name: "Utilities" }] }],
});

function loadMetadata(): Promise<ActualMetadata> {
  return new Promise((resolve) => ensureMetadataLoaded(resolve));
}

describe("actualMetadata singleton", () => {
  beforeEach(() => {
    invalidateActualMetadata();
    getActualMetadataMock.mockReset();
  });

  it("fetches once and serves the cached result afterwards", async () => {
    getActualMetadataMock.mockResolvedValue(response("Edison"));

    const first = await loadMetadata();
    const second = await loadMetadata();

    expect(getActualMetadataMock).toHaveBeenCalledTimes(1);
    expect(first.payees).toEqual([{ id: "p1", name: "Edison" }]);
    expect(second).toBe(first);
    expect(first.categories).toEqual([{ id: "c1", name: "Utilities", group: "Bills" }]);
  });

  it("refetches after invalidation and serves the new metadata", async () => {
    getActualMetadataMock.mockResolvedValueOnce(response("Edison"));
    await loadMetadata();

    invalidateActualMetadata();
    getActualMetadataMock.mockResolvedValueOnce(response("New Payee"));
    const refreshed = await loadMetadata();

    expect(getActualMetadataMock).toHaveBeenCalledTimes(2);
    expect(refreshed.payees).toEqual([{ id: "p1", name: "New Payee" }]);
  });

  it("does not let a fetch that started before invalidation repopulate the cache", async () => {
    let resolveFetch: ((value: ReturnType<typeof response>) => void) | undefined;
    getActualMetadataMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

    const staleLoad = loadMetadata();
    invalidateActualMetadata();
    resolveFetch!(response("Stale Payee"));
    await staleLoad;

    getActualMetadataMock.mockResolvedValueOnce(response("Fresh Payee"));
    const next = await loadMetadata();

    expect(getActualMetadataMock).toHaveBeenCalledTimes(2);
    expect(next.payees).toEqual([{ id: "p1", name: "Fresh Payee" }]);
  });
});
