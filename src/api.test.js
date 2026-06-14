import { afterEach, describe, expect, it, vi } from "vitest";

// Fresh module per test so api.js's module-level prefetch prime starts clean.
// Mirrors src/demo/demoMode.test.js's importApiWithDemoMode helper.
async function importApi() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "");
  return import("./api.js");
}

function jsonOk(payload) {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(payload) };
}

function currentCalls(fetch) {
  return fetch.mock.calls.filter(([path]) => path === "/api/dashboard/current");
}

describe("getCurrentDashboard auth-gated prefetch prime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("collapses the prefetch and the mount load into a single /current request", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonOk({ fetchedAt: "t1" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    const loaded = await api.getCurrentDashboard();

    expect(loaded).toEqual({ fetchedAt: "t1" });
    expect(currentCalls(fetch)).toHaveLength(1);
  });

  it("sends loads after the first to the network (the prime is single-use)", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    await api.getCurrentDashboard(); // consumes the prime
    await api.getCurrentDashboard(); // a later load (poll/reload) must hit the network

    expect(currentCalls(fetch)).toHaveLength(2);
  });

  it("coalesces repeated prefetch calls into one in-flight request", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    api.prefetchCurrentDashboard();

    expect(currentCalls(fetch)).toHaveLength(1);
  });

  it("fetches fresh when the prime has expired before the load", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    vi.useFakeTimers();
    api.prefetchCurrentDashboard();
    vi.advanceTimersByTime(11_000); // past the prime TTL
    await api.getCurrentDashboard();

    expect(currentCalls(fetch)).toHaveLength(2);
  });

  it("drops the prime when the prefetch fails so the load fetches fresh", async () => {
    const fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: "boom" }),
      }))
      .mockImplementation(() => Promise.resolve(jsonOk({ fetchedAt: "ok" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    // Let the failed prefetch settle so its catch drops the prime before the load.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = await api.getCurrentDashboard();

    expect(data).toEqual({ fetchedAt: "ok" });
    expect(currentCalls(fetch)).toHaveLength(2);
  });
});
