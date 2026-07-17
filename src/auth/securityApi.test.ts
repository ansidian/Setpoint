import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/demo/config", () => ({ isDemoMode: () => true }));

const { recoverOwnerAccess, stepUpWithPassword } = await import("./securityApi");

describe("security API demo boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects identity mutations before any network request in demo mode", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(recoverOwnerAccess("recovery-code", "new-password"))
      .rejects.toThrow("DEMO_API_UNHANDLED");
    await expect(stepUpWithPassword("password"))
      .rejects.toThrow("DEMO_API_UNHANDLED");
    expect(fetch).not.toHaveBeenCalled();
  });
});
