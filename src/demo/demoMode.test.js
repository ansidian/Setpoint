import { afterEach, describe, expect, it, vi } from "vitest";

async function importApiWithDemoMode(value) {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", value);
  return import("../api.js");
}

describe("demo mode API network guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps auth local and blocks API fetches before network in demo mode", async () => {
    const fetch = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { sendBeacon });

    const api = await importApiWithDemoMode("1");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.login("anything")).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.getCurrentDashboard()).resolves.toMatchObject({ fetchedAt: expect.any(String) });
    await expect(api.settleArrivalGrace()).rejects.toMatchObject({
      code: "DEMO_API_UNHANDLED",
    });
    await expect(api.suspendService()).rejects.toMatchObject({
      code: "DEMO_API_UNHANDLED",
    });

    api.settleArrivalGraceOnExit();

    expect(fetch).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("keeps normal API fetch behavior outside demo mode", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ authenticated: true }),
    });
    vi.stubGlobal("fetch", fetch);

    const api = await importApiWithDemoMode("");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true });

    expect(fetch).toHaveBeenCalledWith("/api/auth/check", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Requested-With": "EADashboard",
      }),
    }));
  });
});
