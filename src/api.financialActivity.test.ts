import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo financial activity transport", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  it("opens exact records and keeps retired import history read-only without a provider", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    vi.stubGlobal("fetch", () => { throw new Error("Demo must not reach the network"); });
    const api = await import("./api");
    expect((await api.listFinancialActivity({ view: "needs_attention", source: "paypal" })).total).toBe(0);
    const saved = (await api.listFinancialActivity({ source: "paypal" })).items.find(item => item.status === "dismissed")!;
    expect(saved.reference.owner).toBe("import");
    expect(await api.getFinancialActivity(saved.reference)).toMatchObject({ id: saved.id, status: "dismissed", actions: { complete: false, retry: false, correct: false } });
    const managed = await api.listFinancialActivity({ source: "managed" });
    expect(new Set(managed.items.map((item) => item.status))).toEqual(new Set(["completed", "processing", "needs_attention"]));
  });
});
