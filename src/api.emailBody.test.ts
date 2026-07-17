import { afterEach, describe, expect, it, vi } from "vitest";

async function importApi() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "");
  return import("./api");
}

function okJson(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("email body TTL cache eviction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("serves a cached body without re-fetching for the same uid", async () => {
    const fetch = vi.fn().mockResolvedValue(okJson({ html: "<p>hi</p>" }));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.getEmailBody("uid-1");
    await api.getEmailBody("uid-1");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts the least-recently-inserted uid once the cap is exceeded so it re-fetches", async () => {
    const fetch = vi.fn().mockImplementation((url) => okJson({ url }));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    // Fill the cache past its 50-entry cap. The first uid inserted (uid-0)
    // becomes the oldest and is evicted once size exceeds the cap.
    for (let i = 0; i < 51; i += 1) {
      await api.getEmailBody(`uid-${i}`);
    }
    expect(fetch).toHaveBeenCalledTimes(51);

    // uid-0 was evicted → re-opening it re-fetches.
    await api.getEmailBody("uid-0");
    expect(fetch).toHaveBeenCalledTimes(52);

    // A still-cached recent uid does not re-fetch.
    await api.getEmailBody("uid-50");
    expect(fetch).toHaveBeenCalledTimes(52);
  });

  it("sweeps expired entries on insert", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetch = vi.fn().mockImplementation((url) => okJson({ url }));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.getEmailBody("stale-uid");
    expect(api.peekEmailBody("stale-uid")).toEqual({ url: "/api/briefing/email/stale-uid" });

    // Advance past the 5-minute TTL, then insert a different uid to trigger the
    // sweep. The expired entry should be gone.
    vi.setSystemTime(5 * 60 * 1000 + 1);
    await api.getEmailBody("fresh-uid");
    expect(api.peekEmailBody("stale-uid")).toBe(null);
  });
});
