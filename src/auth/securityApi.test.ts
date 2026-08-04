import { afterEach, describe, expect, it, vi } from "vitest";

describe("security API demo boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("rejects identity mutations before any network request in demo mode", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { recoverOwnerAccess, stepUpWithPassword } = await import("./securityApi");

    await expect(recoverOwnerAccess("recovery-code", "new-password"))
      .rejects.toThrow("DEMO_API_UNHANDLED");
    await expect(stepUpWithPassword("password"))
      .rejects.toThrow("DEMO_API_UNHANDLED");
    // test-architecture: allow-boundary-interaction -- a rejected result cannot prove recovery credentials stayed inside the demo browser; the network boundary must remain untouched.
    expect(fetch).not.toHaveBeenCalled();
  });
});
