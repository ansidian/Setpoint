import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
  getActualMetadata: vi.fn(),
}));

const { getActualMetadata } = await import("../api.js");
const { ensureMetadataLoaded, invalidateActualMetadata } = await import("./actualMetadata.js");

const response = (payeeName) => ({
  accounts: [{ id: "a1", name: "Checking" }],
  payees: [{ id: "p1", name: payeeName }],
  categories: [{ group_name: "Bills", categories: [{ id: "c1", name: "Utilities" }] }],
});

function loadMetadata() {
  return new Promise((resolve) => ensureMetadataLoaded(resolve));
}

describe("actualMetadata singleton", () => {
  beforeEach(() => {
    invalidateActualMetadata();
    getActualMetadata.mockReset();
  });

  it("fetches once and serves the cached result afterwards", async () => {
    getActualMetadata.mockResolvedValue(response("Edison"));

    const first = await loadMetadata();
    const second = await loadMetadata();

    expect(getActualMetadata).toHaveBeenCalledTimes(1);
    expect(first.payees).toEqual([{ id: "p1", name: "Edison" }]);
    expect(second).toBe(first);
    expect(first.categories).toEqual([{ id: "c1", name: "Utilities", group: "Bills" }]);
  });

  it("refetches after invalidation and serves the new metadata", async () => {
    getActualMetadata.mockResolvedValueOnce(response("Edison"));
    await loadMetadata();

    invalidateActualMetadata();
    getActualMetadata.mockResolvedValueOnce(response("New Payee"));
    const refreshed = await loadMetadata();

    expect(getActualMetadata).toHaveBeenCalledTimes(2);
    expect(refreshed.payees).toEqual([{ id: "p1", name: "New Payee" }]);
  });

  it("does not let a fetch that started before invalidation repopulate the cache", async () => {
    let resolveFetch;
    getActualMetadata.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

    const staleLoad = loadMetadata();
    invalidateActualMetadata();
    resolveFetch(response("Stale Payee"));
    await staleLoad;

    getActualMetadata.mockResolvedValueOnce(response("Fresh Payee"));
    const next = await loadMetadata();

    expect(getActualMetadata).toHaveBeenCalledTimes(2);
    expect(next.payees).toEqual([{ id: "p1", name: "Fresh Payee" }]);
  });
});
