import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo capability status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns explicit fictional metadata without reaching the private endpoint", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_EA_DEMO", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getCapabilities } = await import("../api.ts");

    const response = await getCapabilities(true);

    expect(response.capabilities).toHaveLength(9);
    expect(response.capabilities.find(({ id }) => id === "gmail_realtime")?.state).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
