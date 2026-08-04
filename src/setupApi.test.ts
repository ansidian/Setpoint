import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

async function importSetupApi(demo = false) {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", demo ? "1" : "");
  return import("./setupApi.ts");
}

describe("owner setup API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts the write-only setup token, password, and confirmed browser origin to the claim endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ claimed: true, authenticated: true }));
    vi.stubGlobal("fetch", fetch);
    const api = await importSetupApi();

    await api.claimOwner("deployment-setup-token", "new-owner-password", "https://setpoint.example.com");

    // test-architecture: allow-boundary-interaction -- only the outbound fetch contract proves the write-only setup token, password, and confirmed origin reach the exact owner-claim endpoint and body.
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/setup/claim",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          setupToken: "deployment-setup-token",
          password: "new-owner-password",
          canonicalOrigin: "https://setpoint.example.com",
        }),
      }),
    );
  });

  it("keeps demo setup inert without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = await importSetupApi(true);

    await expect(api.getSetupStatus()).resolves.toEqual({ claimed: true });
    await expect(api.claimOwner("deployment-setup-token", "must-not-leave-browser", "https://demo.example.com")).rejects.toThrow("DEMO_API_UNHANDLED");
    // test-architecture: allow-boundary-interaction -- successful inert demo results cannot prove setup secrets were never sent across the browser network boundary.
    expect(fetch).not.toHaveBeenCalled();
  });
});
