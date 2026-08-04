import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualMetadata } from "./actualMetadata";
const { ensureMetadataLoaded, invalidateActualMetadata } = await import("./actualMetadata");

const response = (payeeName: string) => ({
  accounts: [{ id: "a1", name: "Checking" }],
  payees: [{ id: "p1", name: payeeName }],
  categories: [{ group_name: "Bills", categories: [{ id: "c1", name: "Utilities" }] }],
});

function loadMetadata(): Promise<ActualMetadata> {
  return new Promise((resolve) => ensureMetadataLoaded(resolve));
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

describe("actualMetadata singleton", () => {
  beforeEach(() => {
    invalidateActualMetadata();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches once and serves the cached result afterwards", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", () => { fetchCount += 1; return Promise.resolve(ok(response("Edison"))); });

    const first = await loadMetadata();
    const second = await loadMetadata();

    expect(fetchCount).toBe(1);
    expect(first.payees).toEqual([{ id: "p1", name: "Edison" }]);
    expect(second).toBe(first);
    expect(first.categories).toEqual([{ id: "c1", name: "Utilities", group: "Bills" }]);
  });

  it("refetches after invalidation and serves the new metadata", async () => {
    const responses = [response("Edison"), response("New Payee")];
    let fetchCount = 0;
    vi.stubGlobal("fetch", () => Promise.resolve(ok(responses[fetchCount++]!)));
    await loadMetadata();

    invalidateActualMetadata();
    const refreshed = await loadMetadata();

    expect(fetchCount).toBe(2);
    expect(refreshed.payees).toEqual([{ id: "p1", name: "New Payee" }]);
  });

  it("does not let a fetch that started before invalidation repopulate the cache", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    let fetchCount = 0;
    vi.stubGlobal("fetch", () => {
      fetchCount += 1;
      if (fetchCount === 1) return new Promise<Response>((resolve) => { resolveFetch = resolve; });
      return Promise.resolve(ok(response("Fresh Payee")));
    });

    const staleLoad = loadMetadata();
    invalidateActualMetadata();
    resolveFetch!(ok(response("Stale Payee")));
    await staleLoad;

    const next = await loadMetadata();

    expect(fetchCount).toBe(2);
    expect(next.payees).toEqual([{ id: "p1", name: "Fresh Payee" }]);
  });
});
